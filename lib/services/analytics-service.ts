import { Role, SessionStatus } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { getLeadQueueMetrics } from '@/lib/services/lead-admin-service'

/**
 * Analytics service for admin overview and test-level analytics.
 */

const COMPLETED_SESSION_STATUSES: SessionStatus[] = ['SUBMITTED', 'TIMED_OUT', 'FORCE_SUBMITTED']

type AnalyticsSession = {
    id: string
    attemptNumber: number
    status: SessionStatus
    score: number | null
    totalMarks: number
    percentage: number | null
    answers: unknown
    startedAt: Date
    submittedAt: Date | null
    student: {
        id: string
        name: string
        email: string
    }
}

function toAttemptSummary(session: Omit<AnalyticsSession, 'answers' | 'student'>) {
    return {
        id: session.id,
        attemptNumber: session.attemptNumber,
        status: session.status,
        score: session.score,
        totalMarks: session.totalMarks,
        percentage: session.percentage,
        startedAt: session.startedAt,
        submittedAt: session.submittedAt,
    }
}

function getBestAttempt(attemptHistory: ReturnType<typeof toAttemptSummary>[]) {
    if (attemptHistory.length === 0) {
        return null
    }

    return [...attemptHistory].sort((left, right) => {
        const leftPercentage = left.percentage ?? -1
        const rightPercentage = right.percentage ?? -1

        if (rightPercentage !== leftPercentage) {
            return rightPercentage - leftPercentage
        }

        const leftScore = left.score ?? -1
        const rightScore = right.score ?? -1

        if (rightScore !== leftScore) {
            return rightScore - leftScore
        }

        return right.attemptNumber - left.attemptNumber
    })[0]
}

function buildDistribution(scores: number[]) {
    const distribution = [0, 0, 0, 0, 0]

    scores.forEach((score) => {
        if (score <= 20) distribution[0]++
        else if (score <= 40) distribution[1]++
        else if (score <= 60) distribution[2]++
        else if (score <= 80) distribution[3]++
        else distribution[4]++
    })

    return {
        '0-20': distribution[0],
        '21-40': distribution[1],
        '41-60': distribution[2],
        '61-80': distribution[3],
        '81-100': distribution[4],
    }
}

function buildMedian(scores: number[]) {
    if (scores.length === 0) {
        return 0
    }

    const sorted = [...scores].sort((left, right) => left - right)

    if (sorted.length % 2 === 0) {
        return (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    }

    return sorted[Math.floor(sorted.length / 2)]
}

function getSelectedOptionId(rawAnswers: unknown, questionId: string) {
    if (Array.isArray(rawAnswers)) {
        const entry = (rawAnswers as Array<{ questionId: string; optionId: string | null }>)
            .find((answer) => answer.questionId === questionId)

        return entry?.optionId ?? null
    }

    if (rawAnswers && typeof rawAnswers === 'object') {
        return (rawAnswers as Record<string, string | null>)[questionId] ?? null
    }

    return null
}

function normalizeQuestionOptions(options: unknown) {
    if (Array.isArray(options)) {
        return options as Array<{ id: string; text: string; isCorrect: boolean }>
    }

    if (options && typeof options === 'object') {
        const optionMap = options as Record<string, string>

        return ['A', 'B', 'C', 'D']
            .filter((key) => key !== 'correct' && optionMap[key])
            .map((key) => ({
                id: key,
                text: optionMap[key],
                isCorrect: key === optionMap.correct,
            }))
    }

    return []
}

function truncateText(value: string, maxLength: number) {
    return value.length > maxLength
        ? `${value.substring(0, maxLength)}...`
        : value
}

// ── Admin Overview Stats ──
export async function getAdminOverview() {
    const [
        usersByRole,
        testsByStatus,
        totalAttempts,
        activeSessions,
        avgResult,
        leadMetrics,
    ] = await Promise.all([
        prisma.user.groupBy({
            by: ['role'],
            _count: true,
            where: {
                status: 'ACTIVE',
                role: { in: ['ADMIN', 'STUDENT'] as Role[] },
            },
        }),
        prisma.test.groupBy({
            by: ['status'],
            _count: true,
        }),
        prisma.testSession.count({
            where: { status: { in: COMPLETED_SESSION_STATUSES } },
        }),
        prisma.testSession.count({
            where: { status: 'IN_PROGRESS' },
        }),
        prisma.testSession.aggregate({
            _avg: { percentage: true },
            where: { status: { in: COMPLETED_SESSION_STATUSES } },
        }),
        getLeadQueueMetrics(),
    ])

    const userCounts: Record<string, number> = {}
    usersByRole.forEach((group) => {
        userCounts[group.role] = group._count
    })

    const testCounts: Record<string, number> = {}
    testsByStatus.forEach((group) => {
        testCounts[group.status] = group._count
    })

    return {
        users: {
            admin: userCounts.ADMIN || 0,
            student: userCounts.STUDENT || 0,
        },
        tests: {
            total: Object.values(testCounts).reduce((sum, count) => sum + count, 0),
            draft: testCounts.DRAFT || 0,
            published: testCounts.PUBLISHED || 0,
            archived: testCounts.ARCHIVED || 0,
        },
        attempts: {
            total: totalAttempts,
            active: activeSessions,
        },
        leads: {
            actionable: leadMetrics.actionableTotal,
            unreviewed: leadMetrics.unreviewedTotal,
            reviewedToday: leadMetrics.reviewedToday,
        },
        avgScore: Math.round((avgResult._avg.percentage ?? 0) * 100) / 100,
    }
}

// ── Test-Level Analytics ──
export async function getTestAnalytics(testId: string) {
    const test = await prisma.test.findUnique({
        where: { id: testId },
        select: {
            id: true,
            title: true,
            durationMinutes: true,
            questions: {
                orderBy: { order: 'asc' },
                select: {
                    id: true,
                    order: true,
                    stem: true,
                    options: true,
                    difficulty: true,
                    topic: true,
                },
            },
            sessions: {
                where: { status: { in: COMPLETED_SESSION_STATUSES } },
                select: {
                    id: true,
                    attemptNumber: true,
                    status: true,
                    score: true,
                    totalMarks: true,
                    percentage: true,
                    answers: true,
                    startedAt: true,
                    submittedAt: true,
                    student: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                },
                orderBy: [
                    { studentId: 'asc' },
                    { attemptNumber: 'asc' },
                ],
            },
        },
    })

    if (!test) return { error: true, code: 'NOT_FOUND', message: 'Test not found' } as const

    const studentAttemptMap = new Map<string, AnalyticsSession[]>()
    const sessionById = new Map<string, AnalyticsSession>()

    test.sessions.forEach((session) => {
        const existingSessions = studentAttemptMap.get(session.student.id) ?? []
        existingSessions.push(session)
        studentAttemptMap.set(session.student.id, existingSessions)
        sessionById.set(session.id, session)
    })

    const studentSummaries = [...studentAttemptMap.values()]
        .map((sessions) => {
            const orderedSessions = [...sessions].sort((left, right) => left.attemptNumber - right.attemptNumber)
            const attemptHistory = orderedSessions.map((session) => toAttemptSummary(session))
            const latestAttempt = attemptHistory[attemptHistory.length - 1] ?? null

            return {
                studentId: sessions[0].student.id,
                name: sessions[0].student.name,
                email: sessions[0].student.email,
                attemptsUsed: attemptHistory.length,
                latestAttempt,
                bestAttempt: getBestAttempt(attemptHistory),
                attemptHistory,
            }
        })
        .sort((left, right) => {
            const leftPercentage = left.latestAttempt?.percentage ?? -1
            const rightPercentage = right.latestAttempt?.percentage ?? -1

            if (rightPercentage !== leftPercentage) {
                return rightPercentage - leftPercentage
            }

            return left.name.localeCompare(right.name)
        })

    const latestCompletedSessions = studentSummaries
        .map((summary) => {
            const latestAttemptId = summary.latestAttempt?.id

            if (!latestAttemptId) {
                return null
            }

            return sessionById.get(latestAttemptId) ?? null
        })
        .filter((session): session is AnalyticsSession => Boolean(session))

    const latestScores = latestCompletedSessions.map((session) => session.percentage ?? 0)
    const avg = latestScores.length > 0
        ? latestScores.reduce((sum, score) => sum + score, 0) / latestScores.length
        : 0
    const median = buildMedian(latestScores)

    const questionStats = test.questions.map((question) => {
        const options = normalizeQuestionOptions(question.options)
        const correctOption = options.find((option) => option.isCorrect)
        const latestOptionCounts: Record<string, number> = {}
        const allAttemptOptionCounts: Record<string, number> = {}

        options.forEach((option) => {
            latestOptionCounts[option.id] = 0
            allAttemptOptionCounts[option.id] = 0
        })

        let latestCorrect = 0
        let latestResponses = 0
        let allAttemptResponses = 0

        latestCompletedSessions.forEach((session) => {
            const selectedOptionId = getSelectedOptionId(session.answers, question.id)

            if (!selectedOptionId) {
                return
            }

            latestResponses++
            latestOptionCounts[selectedOptionId] = (latestOptionCounts[selectedOptionId] || 0) + 1

            if (correctOption && selectedOptionId === correctOption.id) {
                latestCorrect++
            }
        })

        test.sessions.forEach((session) => {
            const selectedOptionId = getSelectedOptionId(session.answers, question.id)

            if (!selectedOptionId) {
                return
            }

            allAttemptResponses++
            allAttemptOptionCounts[selectedOptionId] = (allAttemptOptionCounts[selectedOptionId] || 0) + 1
        })

        let mostSelectedWrongOption: { id: string; text: string; count: number } | null = null

        options
            .filter((option) => !option.isCorrect)
            .forEach((option) => {
                const count = latestOptionCounts[option.id] || 0

                if (count > 0 && (!mostSelectedWrongOption || count > mostSelectedWrongOption.count)) {
                    mostSelectedWrongOption = {
                        id: option.id,
                        text: truncateText(option.text, 40),
                        count,
                    }
                }
            })

        return {
            questionId: question.id,
            order: question.order,
            stem: truncateText(question.stem, 80),
            difficulty: question.difficulty,
            topic: question.topic,
            correctRate: latestResponses > 0 ? Math.round((latestCorrect / latestResponses) * 100) : 0,
            totalAttempts: latestResponses,
            allAttemptTotalAttempts: allAttemptResponses,
            optionBreakdown: options.map((option) => ({
                id: option.id,
                text: truncateText(option.text, 40),
                count: latestOptionCounts[option.id] || 0,
                isCorrect: option.isCorrect,
            })),
            allAttemptOptionBreakdown: options.map((option) => ({
                id: option.id,
                text: truncateText(option.text, 40),
                count: allAttemptOptionCounts[option.id] || 0,
                isCorrect: option.isCorrect,
            })),
            mostSelectedWrongOption,
        }
    })

    const latestSessionsSortedDescending = [...latestCompletedSessions].sort((left, right) => {
        const leftPercentage = left.percentage ?? -1
        const rightPercentage = right.percentage ?? -1

        if (rightPercentage !== leftPercentage) {
            return rightPercentage - leftPercentage
        }

        return right.attemptNumber - left.attemptNumber
    })

    const latestSessionsSortedAscending = [...latestSessionsSortedDescending].reverse()

    return {
        test: {
            id: test.id,
            title: test.title,
            durationMinutes: test.durationMinutes,
            questionCount: test.questions.length,
        },
        overview: {
            totalAttempts: test.sessions.length,
            uniqueStudents: latestCompletedSessions.length,
            avgScore: Math.round(avg * 100) / 100,
            median: Math.round(median * 100) / 100,
            passRate: latestScores.length > 0
                ? Math.round((latestScores.filter((score) => score >= 40).length / latestScores.length) * 100)
                : 0,
            distribution: buildDistribution(latestScores),
        },
        topStudents: latestSessionsSortedDescending.slice(0, 5).map((session) => ({
            id: session.student.id,
            name: session.student.name,
            score: session.score,
            percentage: session.percentage,
            attemptNumber: session.attemptNumber,
        })),
        bottomStudents: latestSessionsSortedAscending.slice(0, 5).map((session) => ({
            id: session.student.id,
            name: session.student.name,
            score: session.score,
            percentage: session.percentage,
            attemptNumber: session.attemptNumber,
        })),
        studentSummaries,
        questionStats,
    }
}
