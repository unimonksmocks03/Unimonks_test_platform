import { prisma } from '@/lib/prisma'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

export const FINISHED_TEST_RETENTION_HOURS = 24
const FINISHED_TEST_RETENTION_MS = FINISHED_TEST_RETENTION_HOURS * HOUR_MS

type ScheduledTestLike = {
    scheduledAt: Date | string | null
    durationMinutes: number
}

type PurgeOptions = {
    teacherId?: string
    now?: Date
}

function toDate(value: Date | string): Date {
    return value instanceof Date ? value : new Date(value)
}

export function getScheduledTestLifecycle(test: ScheduledTestLike, now = new Date()) {
    const scheduledAt = test.scheduledAt ? toDate(test.scheduledAt) : null
    const scheduledEndAt = scheduledAt
        ? new Date(scheduledAt.getTime() + test.durationMinutes * MINUTE_MS)
        : null
    const retentionExpiresAt = scheduledEndAt
        ? new Date(scheduledEndAt.getTime() + FINISHED_TEST_RETENTION_MS)
        : null

    return {
        scheduledAt,
        scheduledEndAt,
        retentionExpiresAt,
        isFinished: scheduledEndAt ? scheduledEndAt.getTime() <= now.getTime() : false,
        isPastRetention: retentionExpiresAt ? retentionExpiresAt.getTime() <= now.getTime() : false,
    }
}

export async function hardDeleteTestsById(testIds: string[]) {
    const uniqueIds = [...new Set(testIds.filter(Boolean))]

    if (uniqueIds.length === 0) {
        return { deletedCount: 0 }
    }

    const [, , , , deletedTests] = await prisma.$transaction([
        prisma.aIFeedback.deleteMany({
            where: { testSession: { testId: { in: uniqueIds } } },
        }),
        prisma.testSession.deleteMany({
            where: { testId: { in: uniqueIds } },
        }),
        prisma.testAssignment.deleteMany({
            where: { testId: { in: uniqueIds } },
        }),
        prisma.question.deleteMany({
            where: { testId: { in: uniqueIds } },
        }),
        prisma.test.deleteMany({
            where: { id: { in: uniqueIds } },
        }),
    ])

    return { deletedCount: deletedTests.count }
}

export async function hardDeleteTestById(testId: string) {
    return hardDeleteTestsById([testId])
}

export async function purgeExpiredFinishedTests(options: PurgeOptions = {}) {
    const now = options.now ?? new Date()

    const candidates = await prisma.test.findMany({
        where: {
            status: 'PUBLISHED',
            scheduledAt: { not: null },
            ...(options.teacherId ? { teacherId: options.teacherId } : {}),
        },
        select: {
            id: true,
            title: true,
            scheduledAt: true,
            durationMinutes: true,
            sessions: {
                where: { status: 'IN_PROGRESS' },
                select: { id: true },
                take: 1,
            },
        },
    })

    const expired = candidates.filter((test) => {
        const lifecycle = getScheduledTestLifecycle(test, now)
        const hasActiveSessions = test.sessions.length > 0
        return lifecycle.isPastRetention && !hasActiveSessions
    })

    if (expired.length === 0) {
        return { deletedCount: 0, deletedIds: [] as string[], deletedTitles: [] as string[] }
    }

    const deleteResult = await hardDeleteTestsById(expired.map((test) => test.id))

    return {
        deletedCount: deleteResult.deletedCount,
        deletedIds: expired.map((test) => test.id),
        deletedTitles: expired.map((test) => test.title),
    }
}
