import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
import { withAuth } from '@/lib/middleware/auth-guard'
import { prisma } from '@/lib/prisma'

// GET /api/admin/tests — list ALL tests across all teachers
async function getHandler(req: NextRequest) {
    const url = new URL(req.url)
    const status = url.searchParams.get('status') || undefined
    const search = url.searchParams.get('search') || undefined
    const page = parseInt(url.searchParams.get('page') || '1')
    const limit = parseInt(url.searchParams.get('limit') || '50')
    const skip = (page - 1) * limit

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (search) where.title = { contains: search, mode: 'insensitive' }

    const [tests, total] = await Promise.all([
        prisma.test.findMany({
            where,
            include: {
                teacher: { select: { id: true, name: true, email: true } },
                _count: {
                    select: {
                        questions: true,
                        sessions: { where: { status: { in: ['SUBMITTED', 'TIMED_OUT', 'FORCE_SUBMITTED'] } } }
                    }
                },
            },
            orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
            skip,
            take: limit,
        }),
        prisma.test.count({ where }),
    ])

    return NextResponse.json({
        tests: tests.map(t => ({
            id: t.id,
            title: t.title,
            description: t.description,
            durationMinutes: t.durationMinutes,
            status: t.status,
            scheduledAt: t.scheduledAt,
            teacherName: t.teacher.name,
            teacherEmail: t.teacher.email,
            questionCount: t._count.questions,
            attemptCount: t._count.sessions,
            createdAt: t.createdAt,
        })),
        total,
        page,
        totalPages: Math.ceil(total / limit),
    })
}

export const GET = withAuth(getHandler, ['ADMIN'])
