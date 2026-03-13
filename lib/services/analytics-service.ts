import { prisma } from '@/lib/prisma'

/**
 * Analytics service for admin overview and test-level analytics.
 */

// ── Admin Overview Stats ──
export async function getAdminOverview() {
    const [
        usersByRole,
        testsByStatus,
        totalSessions,
        activeSessions,
        avgResult,
    ] = await Promise.all([
        prisma.user.groupBy({
            by: ['role'],
            _count: true,
            where: { status: 'ACTIVE' },
        }),
        prisma.test.groupBy({
            by: ['status'],
            _count: true,
        }),
        prisma.testSession.count({
            where: { status: { in: ['SUBMITTED', 'TIMED_OUT', 'FORCE_SUBMITTED'] } },
        }),
        prisma.testSession.count({
            where: { status: 'IN_PROGRESS' },
        }),
        prisma.testSession.aggregate({
            _avg: { percentage: true },
            where: { status: { in: ['SUBMITTED', 'TIMED_OUT', 'FORCE_SUBMITTED'] } },
        }),
    ])

    const userCounts: Record<string, number> = {}
    usersByRole.forEach((g) => { userCounts[g.role] = g._count })

    const testCounts: Record<string, number> = {}
    testsByStatus.forEach((g) => { testCounts[g.status] = g._count })

    return {
        users: {
            total: Object.values(userCounts).reduce((a, b) => a + b, 0),
            admin: userCounts.ADMIN || 0,
            teacher: userCounts.TEACHER || 0,
            student: userCounts.STUDENT || 0,
        },
        tests: {
            total: Object.values(testCounts).reduce((a, b) => a + b, 0),
            draft: testCounts.DRAFT || 0,
            published: testCounts.PUBLISHED || 0,
            archived: testCounts.ARCHIVED || 0,
        },
        sessions: {
            completed: totalSessions,
            active: activeSessions,
        },
        avgScore: Math.round((avgResult._avg.percentage ?? 0) * 100) / 100,
    }
}

// ── Test-Level Analytics (used by both admin and teacher) ──
export async function getTestAnalytics(testId: string) {
    const test = await prisma.test.findUnique({
        where: { id: testId },
        include: {
            questions: { orderBy: { order: 'asc' } },
            sessions: {
                where: { status: { in: ['SUBMITTED', 'TIMED_OUT', 'FORCE_SUBMITTED'] } },
                include: {
                    student: { select: { id: true, name: true, email: true } },
                },
                orderBy: { percentage: 'desc' },
            },
        },
    })

    if (!test) return { error: true, code: 'NOT_FOUND', message: 'Test not found' }

    const sessions = test.sessions
    const scores = sessions.map((s) => s.percentage ?? 0)

    // Score distribution (buckets: 0-20, 21-40, 41-60, 61-80, 81-100)
    const distribution = [0, 0, 0, 0, 0]
    scores.forEach((s) => {
        if (s <= 20) distribution[0]++
        else if (s <= 40) distribution[1]++
        else if (s <= 60) distribution[2]++
        else if (s <= 80) distribution[3]++
        else distribution[4]++
    })

    const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
    const sorted = [...scores].sort((a, b) => a - b)
    const median = sorted.length > 0
        ? sorted.length % 2 === 0
            ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
            : sorted[Math.floor(sorted.length / 2)]
        : 0

    // Per-question stats
    const questionStats = test.questions.map((q) => {
        let correct = 0
        let total = 0
        const optionCounts: Record<string, number> = {}

        const opts = q.options as Array<{ id: string; text: string; isCorrect: boolean }>
        const correctOpt = opts.find((o) => o.isCorrect)
        // Initialize all option counts to 0
        opts.forEach((o) => { optionCounts[o.id] = 0 })

        sessions.forEach((s) => {
            // Answers can be in array format [{questionId, optionId}] or legacy object format {questionId: optionId}
            const rawAnswers = s.answers as unknown
            let selectedOptionId: string | null = null

            if (Array.isArray(rawAnswers)) {
                // Current format: [{questionId, optionId, answeredAt}]
                const entry = (rawAnswers as Array<{ questionId: string; optionId: string | null }>)
                    .find(a => a.questionId === q.id)
                selectedOptionId = entry?.optionId ?? null
            } else if (rawAnswers && typeof rawAnswers === 'object') {
                // Legacy format: {questionId: optionId}
                selectedOptionId = (rawAnswers as Record<string, string>)[q.id] ?? null
            }

            if (selectedOptionId) {
                total++
                if (correctOpt && selectedOptionId === correctOpt.id) correct++
                optionCounts[selectedOptionId] = (optionCounts[selectedOptionId] || 0) + 1
            }
        })

        // Find the most-selected wrong option
        let mostSelectedWrong: { id: string; text: string; count: number } | null = null
        opts.filter(o => !o.isCorrect).forEach(o => {
            const count = optionCounts[o.id] || 0
            if (count > 0 && (!mostSelectedWrong || count > mostSelectedWrong.count)) {
                mostSelectedWrong = { id: o.id, text: o.text, count }
            }
        })

        return {
            questionId: q.id,
            order: q.order,
            stem: q.stem.substring(0, 80) + (q.stem.length > 80 ? '...' : ''),
            difficulty: q.difficulty,
            topic: q.topic,
            correctRate: total > 0 ? Math.round((correct / total) * 100) : 0,
            totalAttempts: total,
            optionBreakdown: opts.map(o => ({ id: o.id, text: o.text.substring(0, 40), count: optionCounts[o.id] || 0, isCorrect: o.isCorrect })),
            mostSelectedWrongOption: mostSelectedWrong,
        }
    })

    return {
        overview: {
            totalAttempts: sessions.length,
            avgScore: Math.round(avg * 100) / 100,
            median: Math.round(median * 100) / 100,
            passRate: scores.length > 0
                ? Math.round((scores.filter((s) => s >= 40).length / scores.length) * 100)
                : 0,
            distribution: {
                '0-20': distribution[0],
                '21-40': distribution[1],
                '41-60': distribution[2],
                '61-80': distribution[3],
                '81-100': distribution[4],
            },
        },
        topStudents: sessions.slice(0, 5).map((s) => ({
            id: s.student.id,
            name: s.student.name,
            score: s.score,
            percentage: s.percentage,
        })),
        bottomStudents: sessions.slice(-5).reverse().map((s) => ({
            id: s.student.id,
            name: s.student.name,
            score: s.score,
            percentage: s.percentage,
        })),
        questionStats,
    }
}
