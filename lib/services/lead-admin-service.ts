import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { normalizeEmail, normalizeOptionalPhone } from '@/lib/utils/contact-normalization'

export type LeadQueueReviewedFilter = 'all' | 'reviewed' | 'unreviewed'

export type LeadQueueQuery = {
    search?: string
    reviewed?: LeadQueueReviewedFilter
    page?: number
    limit?: number
}

type ListableLead = {
    id: string
    name: string
    email: string | null
    phone: string | null
    isReviewed: boolean
    reviewedAt: Date | null
    createdAt: Date
    testSessions: Array<{
        id: string
        status: string
        score: number | null
        totalMarks: number
        percentage: number | null
        startedAt: Date
        submittedAt: Date | null
        test: {
            id: string
            title: string
        }
    }>
}

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

function normalizeLeadQueueQuery(query: LeadQueueQuery) {
    return {
        search: query.search?.trim() || undefined,
        reviewed: query.reviewed ?? 'all',
        page: Number.isFinite(query.page) ? Math.max(DEFAULT_PAGE, Number(query.page)) : DEFAULT_PAGE,
        limit: Number.isFinite(query.limit)
            ? Math.min(MAX_LIMIT, Math.max(1, Number(query.limit)))
            : DEFAULT_LIMIT,
    }
}

async function getRegisteredStudentNormalizedEmails(): Promise<string[]> {
    const students = await prisma.user.findMany({
        where: { role: 'STUDENT' },
        select: { email: true },
    })

    return [...new Set<string>(students.map((student) => normalizeEmail(student.email)))]
}

function buildLeadQueueWhere(
    query: ReturnType<typeof normalizeLeadQueueQuery>,
    registeredStudentEmails: string[],
): Prisma.LeadWhereInput {
    const filters: Prisma.LeadWhereInput[] = []

    if (query.reviewed === 'reviewed') {
        filters.push({ isReviewed: true })
    } else if (query.reviewed === 'unreviewed') {
        filters.push({ isReviewed: false })
    }

    if (query.search) {
        const normalizedSearch = query.search.toLowerCase()
        const normalizedPhoneSearch = normalizeOptionalPhone(query.search)

        filters.push({
            OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
                { emailNormalized: { contains: normalizedSearch } },
                { phone: { contains: query.search, mode: 'insensitive' } },
                ...(normalizedPhoneSearch
                    ? [{ phoneNormalized: { contains: normalizedPhoneSearch } }]
                    : []),
            ],
        })
    }

    if (registeredStudentEmails.length > 0) {
        filters.push({
            OR: [
                { emailNormalized: null },
                { emailNormalized: { notIn: registeredStudentEmails } },
            ],
        })
    }

    if (filters.length === 0) {
        return {}
    }

    if (filters.length === 1) {
        return filters[0]
    }

    return { AND: filters }
}

function toLeadQueueItem(lead: ListableLead) {
    const latestSession = lead.testSessions[0] ?? null

    return {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        createdAt: lead.createdAt,
        isReviewed: lead.isReviewed,
        reviewedAt: lead.reviewedAt,
        sourceTest: latestSession
            ? {
                id: latestSession.test.id,
                title: latestSession.test.title,
            }
            : null,
        latestSession: latestSession
            ? {
                id: latestSession.id,
                status: latestSession.status,
                score: latestSession.score,
                totalMarks: latestSession.totalMarks,
                percentage: latestSession.percentage,
                startedAt: latestSession.startedAt,
                submittedAt: latestSession.submittedAt,
            }
            : null,
    }
}

export async function listAdminLeads(query: LeadQueueQuery) {
    const normalizedQuery = normalizeLeadQueueQuery(query)
    const registeredStudentEmails = await getRegisteredStudentNormalizedEmails()
    const where = buildLeadQueueWhere(normalizedQuery, registeredStudentEmails)
    const skip = (normalizedQuery.page - 1) * normalizedQuery.limit

    const [leads, total] = await Promise.all([
        prisma.lead.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take: normalizedQuery.limit,
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                isReviewed: true,
                reviewedAt: true,
                createdAt: true,
                testSessions: {
                    orderBy: { startedAt: 'desc' },
                    take: 1,
                    select: {
                        id: true,
                        status: true,
                        score: true,
                        totalMarks: true,
                        percentage: true,
                        startedAt: true,
                        submittedAt: true,
                        test: {
                            select: {
                                id: true,
                                title: true,
                            },
                        },
                    },
                },
            },
        }),
        prisma.lead.count({ where }),
    ])

    return {
        leads: leads.map(toLeadQueueItem),
        total,
        page: normalizedQuery.page,
        totalPages: Math.max(1, Math.ceil(total / normalizedQuery.limit)),
    }
}

export async function updateLeadReviewState(input: {
    adminId: string
    leadId: string
    isReviewed: boolean
    ipAddress?: string | null
}) {
    const existing = await prisma.lead.findUnique({
        where: { id: input.leadId },
        select: {
            id: true,
            isReviewed: true,
            reviewedAt: true,
        },
    })

    if (!existing) {
        return { error: true, code: 'NOT_FOUND', message: 'Lead not found' } as const
    }

    if (existing.isReviewed === input.isReviewed) {
        return {
            lead: {
                id: existing.id,
                isReviewed: existing.isReviewed,
                reviewedAt: existing.reviewedAt,
            },
        }
    }

    const reviewedAt = input.isReviewed ? new Date() : null

    const lead = await prisma.$transaction(async (tx) => {
        const updatedLead = await tx.lead.update({
            where: { id: input.leadId },
            data: {
                isReviewed: input.isReviewed,
                reviewedAt,
            },
            select: {
                id: true,
                isReviewed: true,
                reviewedAt: true,
            },
        })

        await tx.auditLog.create({
            data: {
                userId: input.adminId,
                action: input.isReviewed ? 'LEAD_REVIEWED' : 'LEAD_UNREVIEWED',
                metadata: {
                    leadId: input.leadId,
                    previousState: existing.isReviewed,
                    nextState: input.isReviewed,
                },
                ipAddress: input.ipAddress ?? 'unknown',
            },
        })

        return updatedLead
    })

    return { lead }
}

export async function getLeadQueueMetrics() {
    const registeredStudentEmails = await getRegisteredStudentNormalizedEmails()
    const allLeadsWhere = buildLeadQueueWhere(
        normalizeLeadQueueQuery({ reviewed: 'all' }),
        registeredStudentEmails,
    )
    const unreviewedLeadsWhere = buildLeadQueueWhere(
        normalizeLeadQueueQuery({ reviewed: 'unreviewed' }),
        registeredStudentEmails,
    )

    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)

    const [actionableTotal, unreviewedTotal, reviewedToday] = await Promise.all([
        prisma.lead.count({ where: allLeadsWhere }),
        prisma.lead.count({ where: unreviewedLeadsWhere }),
        prisma.lead.count({
            where: {
                AND: [
                    allLeadsWhere,
                    {
                        reviewedAt: {
                            gte: startOfToday,
                        },
                    },
                ],
            },
        }),
    ])

    return {
        actionableTotal,
        unreviewedTotal,
        reviewedToday,
    }
}
