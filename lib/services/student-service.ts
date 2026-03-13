import { prisma } from '@/lib/prisma'
import { getScheduledTestLifecycle } from '@/lib/services/test-lifecycle'

/**
 * Student-scoped service.
 * All queries are strictly scoped to the requesting student's own data.
 */

// ── Dashboard Data ──
export async function getDashboard(studentId: string) {
    // Get student's batch IDs
    const enrollments = await prisma.batchStudent.findMany({
        where: { studentId },
        select: {
            batchId: true,
            batch: { select: { name: true, code: true } },
        },
    })
    const batchIds = enrollments.map((e) => e.batchId)

    // Upcoming tests: assigned via batch or direct, PUBLISHED status
    const upcomingTests = await prisma.test.findMany({
        where: {
            status: 'PUBLISHED',
            assignments: {
                some: {
                    OR: [
                        { batchId: { in: batchIds.length > 0 ? batchIds : ['none'] } },
                        { studentId },
                    ],
                },
            },
            // Exclude tests student has already completed
            sessions: { none: { studentId, status: { in: ['SUBMITTED', 'TIMED_OUT', 'FORCE_SUBMITTED'] } } },
        },
        select: {
            id: true,
            title: true,
            description: true,
            durationMinutes: true,
            scheduledAt: true,
            teacher: { select: { name: true } },
            _count: { select: { questions: true } },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 25,
    })

    // Recent results (last 5 completed)
    const recentResults = await prisma.testSession.findMany({
        where: {
            studentId,
            status: { in: ['SUBMITTED', 'TIMED_OUT', 'FORCE_SUBMITTED'] },
        },
        select: {
            id: true,
            score: true,
            totalMarks: true,
            percentage: true,
            submittedAt: true,
            test: { select: { id: true, title: true } },
            aiFeedback: { select: { id: true, overallTag: true } },
        },
        orderBy: { submittedAt: 'desc' },
        take: 5,
    })

    // Student stats
    const sessions = await prisma.testSession.findMany({
        where: {
            studentId,
            status: { in: ['SUBMITTED', 'TIMED_OUT', 'FORCE_SUBMITTED'] },
        },
        select: { percentage: true },
    })

    const totalTests = sessions.length
    const avgScore = totalTests > 0 ? sessions.reduce((sum, s) => sum + (s.percentage ?? 0), 0) / totalTests : 0
    const bestScore = totalTests > 0 ? Math.max(...sessions.map((s) => s.percentage ?? 0)) : 0

    return {
        upcoming: upcomingTests.map((t) => ({
            ...(() => {
                const lifecycle = getScheduledTestLifecycle(t)
                return {
                    isFinished: lifecycle.isFinished,
                }
            })(),
            id: t.id,
            title: t.title,
            description: t.description,
            durationMinutes: t.durationMinutes,
            scheduledAt: t.scheduledAt,
            teacherName: t.teacher.name,
            questionCount: t._count.questions,
        })).filter((t) => !t.isFinished).slice(0, 10),
        recent: recentResults.map((r) => ({
            sessionId: r.id,
            testId: r.test.id,
            testTitle: r.test.title,
            score: r.score,
            totalMarks: r.totalMarks,
            percentage: r.percentage,
            submittedAt: r.submittedAt,
            hasFeedback: !!r.aiFeedback,
            overallTag: r.aiFeedback?.overallTag,
        })),
        stats: {
            totalTests,
            avgScore: Math.round(avgScore * 100) / 100,
            bestScore: Math.round(bestScore * 100) / 100,
        },
        batches: enrollments.map((e) => ({
            id: e.batchId,
            name: e.batch.name,
            code: e.batch.code,
        })),
    }
}

// ── Assigned Tests ──
export async function getAssignedTests(studentId: string) {
    const enrollments = await prisma.batchStudent.findMany({
        where: { studentId },
        select: { batchId: true },
    })
    const batchIds = enrollments.map((e) => e.batchId)

    const tests = await prisma.test.findMany({
        where: {
            status: 'PUBLISHED',
            assignments: {
                some: {
                    OR: [
                        { batchId: { in: batchIds.length > 0 ? batchIds : ['none'] } },
                        { studentId },
                    ],
                },
            },
        },
        select: {
            id: true,
            title: true,
            description: true,
            durationMinutes: true,
            scheduledAt: true,
            teacher: { select: { name: true } },
            _count: { select: { questions: true } },
            sessions: {
                where: { studentId },
                select: { id: true, status: true, score: true, percentage: true, submittedAt: true },
            },
        },
        orderBy: { createdAt: 'desc' },
    })

    return {
        tests: tests.map((t) => {
            const lifecycle = getScheduledTestLifecycle(t)
            const session = t.sessions[0]
            return {
                id: t.id,
                title: t.title,
                description: t.description,
                durationMinutes: t.durationMinutes,
                scheduledAt: t.scheduledAt,
                teacherName: t.teacher.name,
                questionCount: t._count.questions,
                attempted: !!session,
                isFinished: lifecycle.isFinished,
                session: session
                    ? {
                        id: session.id,
                        status: session.status,
                        score: session.score,
                        percentage: session.percentage,
                        submittedAt: session.submittedAt,
                    }
                    : null,
            }
        }).filter((t) => !t.isFinished),
    }
}

// ── Get Result (ownership-verified) ──
export async function getResult(studentId: string, sessionId: string) {
    const session = await prisma.testSession.findUnique({
        where: { id: sessionId },
        include: {
            test: {
                select: {
                    id: true,
                    title: true,
                    durationMinutes: true,
                    questions: { orderBy: { order: 'asc' } },
                },
            },
            aiFeedback: true,
        },
    })

    if (!session) return { error: true, code: 'NOT_FOUND', message: 'Test session not found' }
    if (session.studentId !== studentId) return { error: true, code: 'FORBIDDEN', message: 'Access denied' }

    return {
        session: {
            id: session.id,
            status: session.status,
            score: session.score,
            totalMarks: session.totalMarks,
            percentage: session.percentage,
            answers: session.answers,
            submittedAt: session.submittedAt,
            tabSwitchCount: session.tabSwitchCount,
        },
        test: session.test,
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
