import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'

import { getAuthEnv } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import { getPublicFreeTestIdentity } from '@/lib/services/free-test-service'
import { normalizeEmail, normalizePhone } from '@/lib/utils/contact-normalization'

const PUBLIC_LEAD_TOKEN_TYPE = 'PUBLIC_FREE_LEAD'

export const PUBLIC_LEAD_COOKIE_NAME = 'public_free_lead'
export const PUBLIC_LEAD_TOKEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

type LeadCaptureServiceErrorCode =
    | 'NOT_FOUND'
    | 'REGISTERED_STUDENT_USE_LOGIN'

export type LeadCaptureServiceError = {
    error: true
    code: LeadCaptureServiceErrorCode
    message: string
    details?: Record<string, unknown>
}

export type LeadCaptureResult = {
    lead: {
        id: string
        name: string
        email: string | null
        phone: string | null
    }
    accessToken: string
    nextAction: 'START_FREE_TEST'
    test: {
        id: string
        title: string
    }
}

type PublicLeadTokenPayload = {
    leadId: string
    type: typeof PUBLIC_LEAD_TOKEN_TYPE
    iat?: number
    exp?: number
}

type ExistingLeadContact = {
    id: string
    emailNormalized: string | null
    phoneNormalized: string | null
}

function serviceError(
    code: LeadCaptureServiceErrorCode,
    message: string,
    details?: Record<string, unknown>,
): LeadCaptureServiceError {
    return {
        error: true,
        code,
        message,
        details,
    }
}

export function resolveExistingLeadByContact(
    leads: ExistingLeadContact[],
    emailNormalized: string,
    phoneNormalized: string,
) {
    return leads.find(
        (lead) => lead.emailNormalized === emailNormalized && lead.phoneNormalized === phoneNormalized,
    ) ?? leads.find(
        (lead) => lead.emailNormalized === emailNormalized,
    ) ?? leads.find(
        (lead) => lead.phoneNormalized === phoneNormalized,
    ) ?? null
}

export function createPublicLeadAccessToken(leadId: string) {
    const signingSecret = getPublicLeadTokenSecret()

    return jwt.sign(
        {
            leadId,
            type: PUBLIC_LEAD_TOKEN_TYPE,
        } satisfies PublicLeadTokenPayload,
        signingSecret,
        {
            expiresIn: PUBLIC_LEAD_TOKEN_MAX_AGE_SECONDS,
        },
    )
}

export function getPublicLeadTokenSecret() {
    const { JWT_SECRET, JWT_REFRESH_SECRET } = getAuthEnv()

    return crypto
        .createHash('sha256')
        .update(`${JWT_SECRET}::public-free-lead::${JWT_REFRESH_SECRET}`)
        .digest('hex')
}

export function verifyPublicLeadAccessToken(token: string): { leadId: string } | null {
    try {
        const payload = jwt.verify(token, getPublicLeadTokenSecret()) as PublicLeadTokenPayload

        if (payload.type !== PUBLIC_LEAD_TOKEN_TYPE || typeof payload.leadId !== 'string') {
            return null
        }

        return {
            leadId: payload.leadId,
        }
    } catch {
        return null
    }
}

export async function captureLeadForFreeTest(
    testId: string,
    input: {
        fullName: string
        email: string
        phone: string
    },
): Promise<LeadCaptureResult | LeadCaptureServiceError> {
    const test = await getPublicFreeTestIdentity(testId)

    if (!test) {
        return serviceError('NOT_FOUND', 'This free mock is not available.')
    }

    const normalizedEmail = normalizeEmail(input.email)
    const normalizedPhone = normalizePhone(input.phone)

    const existingStudent = await prisma.user.findFirst({
        where: {
            role: 'STUDENT',
            status: 'ACTIVE',
            email: normalizedEmail,
        },
        select: {
            id: true,
        },
    })

    if (existingStudent) {
        return serviceError(
            'REGISTERED_STUDENT_USE_LOGIN',
            'This email belongs to an enrolled student. Use the login page to continue.',
            {
                loginUrl: '/login',
            },
        )
    }

    const matchingLeads = await prisma.lead.findMany({
        where: {
            OR: [
                { emailNormalized: normalizedEmail },
                { phoneNormalized: normalizedPhone },
            ],
        },
        select: {
            id: true,
            emailNormalized: true,
            phoneNormalized: true,
        },
        orderBy: [
            { isReviewed: 'asc' },
            { updatedAt: 'desc' },
        ],
        take: 10,
    })

    const existingLead = resolveExistingLeadByContact(matchingLeads, normalizedEmail, normalizedPhone)

    const lead = existingLead
        ? await prisma.lead.update({
            where: {
                id: existingLead.id,
            },
            data: {
                name: input.fullName.trim(),
                email: input.email.trim(),
                emailNormalized: normalizedEmail,
                phone: input.phone.trim(),
                phoneNormalized: normalizedPhone,
            },
        })
        : await prisma.lead.create({
            data: {
                name: input.fullName.trim(),
                email: input.email.trim(),
                emailNormalized: normalizedEmail,
                phone: input.phone.trim(),
                phoneNormalized: normalizedPhone,
            },
        })

    return {
        lead: {
            id: lead.id,
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
        },
        accessToken: createPublicLeadAccessToken(lead.id),
        nextAction: 'START_FREE_TEST',
        test: {
            id: test.id,
            title: test.title,
        },
    }
}
