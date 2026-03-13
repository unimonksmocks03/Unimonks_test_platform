import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
import { withAuth } from '@/lib/middleware/auth-guard'
import { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getScheduledTestLifecycle, purgeExpiredFinishedTests } from '@/lib/services/test-lifecycle'

// GET /api/teacher/dashboard — get dashboard stats and allocated batches
async function getHandler(req: NextRequest, ctx: { userId: string; role: Role }) {
    await purgeExpiredFinishedTests({ teacherId: ctx.userId })

    // 1. Get teacher status
    const teacher = await prisma.user.findUnique({
        where: { id: ctx.userId },
        select: { status: true }
    })

    if (!teacher) {
        return NextResponse.json({ error: true, code: 'NOT_FOUND', message: 'Teacher not found' }, { status: 404 })
    }

    // 2. Get allocated batches
    const batches = await prisma.batch.findMany({
        where: { teacherId: ctx.userId },
        select: {
            id: true,
            name: true,
            code: true,
            status: true,
            _count: { select: { students: true } }
        },
        orderBy: { createdAt: 'desc' }
    })

    // 3. Get test stats
    const tests = await prisma.test.findMany({
        where: { teacherId: ctx.userId },
        select: {
            status: true,
            scheduledAt: true,
            durationMinutes: true,
            _count: {
                select: {
                    sessions: { where: { status: { in: ['SUBMITTED', 'TIMED_OUT', 'FORCE_SUBMITTED'] } } }
                }
            }
        }
    })

    const activePublishedTests = tests.filter((test) => {
        if (test.status !== 'PUBLISHED') return false
        return !getScheduledTestLifecycle(test).isFinished
    })

    const testStats = {
        total: tests.length,
        published: activePublishedTests.length,
        drafts: tests.filter(t => t.status === 'DRAFT').length,
        totalAttempts: tests.reduce((sum, t) => sum + t._count.sessions, 0)
    }

    return NextResponse.json({
        status: teacher.status,
        batches: batches.map(b => ({
            id: b.id,
            name: b.name,
            code: b.code,
            status: b.status,
            studentCount: b._count.students
        })),
        testStats
    })
}

export const GET = withAuth(getHandler, ['TEACHER'])
