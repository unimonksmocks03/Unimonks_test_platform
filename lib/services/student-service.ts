import { SessionStatus } from '@prisma/client'

import { MAX_PAID_TOTAL_ATTEMPTS } from '@/lib/config/platform-policy'
import { prisma } from '@/lib/prisma'
import {
    mapQuestionReferences,
    QUESTION_REFERENCE_LINK_SELECT,
} from '@/lib/utils/question-references'
import { sanitizeReferenceText } from '@/lib/utils/reference-sanitizer'

/**
 * Student-scoped service.
 * All queries are strictly scoped to the requesting student's own data.
 */

const COMPLETED_SESSION_STATUSES = new Set<SessionStatus>([
    'SUBMITTED',
    'TIMED_OUT',
    'FORCE_SUBMITTED',
])

type AttemptSessionRecord = {
    id: string
    attemptNumber: number
    status: SessionStatus
    score: number | null
    totalMarks: number
    percentage: number | null
    startedAt: Date
    submittedAt: Date | null
}

function isCompletedStatus(status: SessionStatus) {
    return COMPLETED_SESSION_STATUSES.has(status)
}

function toAttemptSummary(session: AttemptSessionRecord) {
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
    const completedAttempts = attemptHistory.filter((attempt) => isCompletedStatus(attempt.status))

    if (completedAttempts.length === 0) {
        return null
    }

    return [...completedAttempts].sort((left, right) => {
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

function buildAttemptSummary(sessions: AttemptSessionRecord[]) {
    const attemptHistory = [...sessions]
        .sort((left, right) => left.attemptNumber - right.attemptNumber)
        .map(toAttemptSummary)

    const attemptsUsed = attemptHistory.length
    const attemptsRemaining = Math.max(0, MAX_PAID_TOTAL_ATTEMPTS - attemptsUsed)
    const latestAttempt = attemptHistory[attemptHistory.length - 1] ?? null
    const hasInProgressSession = attemptHistory.some((attempt) => attempt.status === 'IN_PROGRESS')

    return {
        attemptsUsed,
        attemptsRemaining,
        canStartAttempt: hasInProgressSession || attemptsRemaining > 0,
        hasInProgressSession,
        latestAttempt,
        bestAttempt: getBestAttempt(attemptHistory),
        attemptHistory,
    }
}

function toStudentTestCard(test: {
    id: string
    title: string
    description: string | null
    durationMinutes: number
    _count: { questions: number }
    assignments: Array<{
        batch: {
            id: string
            name: string
            code: string
        } | null
    }>
    sessions: AttemptSessionRecord[]
}) {
    return {
        id: test.id,
        title: test.title,
        description: test.description,
        durationMinutes: test.durationMinutes,
        questionCount: test._count.questions,
        assignedBatches: test.assignments
            .map((assignment) => assignment.batch)
            .filter((batch): batch is NonNullable<typeof batch> => batch !== null),
        ...buildAttemptSummary(test.sessions),
    }
}

async function getAssignedTestsWithBatches(studentId: string) {
    const enrollments = await prisma.batchStudent.findMany({
        where: { studentId },
        select: {
            batchId: true,
            batch: { select: { name: true, code: true } },
        },
    })

    const batchIds = enrollments.map((enrollment) => enrollment.batchId)
    const assignmentFilters = batchIds.length > 0
        ? [
            { batchId: { in: batchIds } },
            { studentId },
        ]
        : [
            { studentId },
        ]

    const tests = await prisma.test.findMany({
        where: {
            status: 'PUBLISHED',
            assignments: {
                some: {
                    OR: assignmentFilters,
                },
            },
        },
        select: {
            id: true,
            title: true,
            description: true,
            durationMinutes: true,
            _count: { select: { questions: true } },
            assignments: {
                where: batchIds.length > 0
                    ? { batchId: { in: batchIds } }
                    : { batchId: null },
                select: {
                    batch: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                        },
                    },
                },
            },
            sessions: {
                where: { studentId },
                orderBy: { attemptNumber: 'asc' },
                select: {
                    id: true,
                    attemptNumber: true,
                    status: true,
                    score: true,
                    totalMarks: true,
                    percentage: true,
                    startedAt: true,
                    submittedAt: true,
                },
            },
        },
        orderBy: { updatedAt: 'desc' },
    })

    return {
        tests: tests.map(toStudentTestCard),
        batches: enrollments.map((enrollment) => ({
            id: enrollment.batchId,
            name: enrollment.batch.name,
            code: enrollment.batch.code,
        })),
    }
}

// ── Dashboard Data ──
export async function getDashboard(studentId: string) {
    const [{ tests, batches }, recentAttempts, scoreHistory] = await Promise.all([
        getAssignedTestsWithBatches(studentId),
        prisma.testSession.findMany({
            where: {
                studentId,
                status: { in: [...COMPLETED_SESSION_STATUSES] },
            },
            select: {
                id: true,
                attemptNumber: true,
                status: true,
                score: true,
                totalMarks: true,
                percentage: true,
                submittedAt: true,
                test: { select: { id: true, title: true } },
                aiFeedback: { select: { id: true, overallTag: true } },
            },
            orderBy: [
                { submittedAt: 'desc' },
                { attemptNumber: 'desc' },
            ],
            take: 5,
        }),
        prisma.testSession.findMany({
            where: {
                studentId,
                status: { in: [...COMPLETED_SESSION_STATUSES] },
            },
            select: { percentage: true },
        }),
    ])

    const completedAttempts = scoreHistory.length
    const avgScore = completedAttempts > 0
        ? scoreHistory.reduce((sum, session) => sum + (session.percentage ?? 0), 0) / completedAttempts
        : 0
    const bestScore = completedAttempts > 0
        ? Math.max(...scoreHistory.map((session) => session.percentage ?? 0))
        : 0

    return {
        tests,
        recentAttempts: recentAttempts.map((attempt) => ({
            sessionId: attempt.id,
            testId: attempt.test.id,
            testTitle: attempt.test.title,
            attemptNumber: attempt.attemptNumber,
            status: attempt.status,
            score: attempt.score,
            totalMarks: attempt.totalMarks,
            percentage: attempt.percentage,
            submittedAt: attempt.submittedAt,
            hasFeedback: !!attempt.aiFeedback,
            overallTag: attempt.aiFeedback?.overallTag,
        })),
        stats: {
            completedAttempts,
            avgScore: Math.round(avgScore * 100) / 100,
            bestScore: Math.round(bestScore * 100) / 100,
            activeAssignments: tests.filter((test) => test.canStartAttempt).length,
        },
        batches,
    }
}

// ── Assigned Tests ──
export async function getAssignedTests(studentId: string) {
    const { tests } = await getAssignedTestsWithBatches(studentId)

    return { tests }
}

// ── Get Result (ownership-verified) ──
export async function getResult(studentId: string, sessionId: string) {
    const session = await prisma.testSession.findUnique({
        where: { id: sessionId },
        select: {
            id: true,
            studentId: true,
            attemptNumber: true,
            status: true,
            score: true,
            totalMarks: true,
            percentage: true,
            answers: true,
            submittedAt: true,
            startedAt: true,
            tabSwitchCount: true,
            test: {
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
                            sharedContext: true,
                            options: true,
                            explanation: true,
                            difficulty: true,
                            topic: true,
                            referenceLinks: {
                                orderBy: { order: 'asc' },
                                select: QUESTION_REFERENCE_LINK_SELECT,
                            },
                        },
                    },
                    sessions: {
                        where: { studentId },
                        orderBy: { attemptNumber: 'asc' },
                        select: {
                            id: true,
                            attemptNumber: true,
                            status: true,
                            score: true,
                            totalMarks: true,
                            percentage: true,
                            startedAt: true,
                            submittedAt: true,
                        },
                    },
                },
            },
            aiFeedback: {
                select: {
                    strengths: true,
                    weaknesses: true,
                    actionPlan: true,
                    questionExplanations: true,
                    overallTag: true,
                    generatedAt: true,
                },
            },
        },
    })

    if (!session) return { error: true, code: 'NOT_FOUND', message: 'Test session not found' }
    if (session.studentId !== studentId) return { error: true, code: 'FORBIDDEN', message: 'Access denied' }

    const attemptSummary = buildAttemptSummary(session.test.sessions)

    return {
        session: {
            id: session.id,
            attemptNumber: session.attemptNumber,
            status: session.status,
            score: session.score,
            totalMarks: session.totalMarks,
            percentage: session.percentage,
            answers: session.answers,
            submittedAt: session.submittedAt,
            startedAt: session.startedAt,
            tabSwitchCount: session.tabSwitchCount,
        },
        test: {
            id: session.test.id,
            title: session.test.title,
            durationMinutes: session.test.durationMinutes,
            questions: session.test.questions.map((question) => ({
                ...question,
                sharedContext: sanitizeReferenceText(question.sharedContext),
                references: mapQuestionReferences(question.referenceLinks),
            })),
        },
        attemptSummary,
        feedback: session.aiFeedback
            ? {
                strengths: session.aiFeedback.strengths,
                weaknesses: session.aiFeedback.weaknesses,
                actionPlan: session.aiFeedback.actionPlan,
                questionExplanations: session.aiFeedback.questionExplanations,
                overallTag: session.aiFeedback.overallTag,
                generatedAt: session.aiFeedback.generatedAt,
            }
            : null,
    }
}

// ── Get Feedback Status (ownership-verified, lightweight) ──
export async function getFeedbackStatus(studentId: string, sessionId: string) {
    const session = await prisma.testSession.findUnique({
        where: { id: sessionId },
        select: {
            id: true,
            studentId: true,
            status: true,
            submittedAt: true,
            aiFeedback: {
                select: {
                    id: true,
                    overallTag: true,
                    generatedAt: true,
                },
            },
        },
    })

    if (!session) return { error: true, code: 'NOT_FOUND', message: 'Test session not found' }
    if (session.studentId !== studentId) return { error: true, code: 'FORBIDDEN', message: 'Access denied' }

    return {
        sessionId: session.id,
        sessionStatus: session.status,
        submittedAt: session.submittedAt,
        hasFeedback: !!session.aiFeedback,
        feedback: session.aiFeedback
            ? {
                id: session.aiFeedback.id,
                overallTag: session.aiFeedback.overallTag,
                generatedAt: session.aiFeedback.generatedAt,
            }
            : null,
    }
}
