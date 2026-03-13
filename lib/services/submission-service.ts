import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { enqueueForceSubmit } from '@/lib/queue/qstash'
import { getScheduledTestLifecycle } from '@/lib/services/test-lifecycle'

/**
 * Submission Service — Core arena engine.
 * Handles test sessions: start, answer, submit, grading, anti-cheat.
 */

// Answer entry stored in the TestSession.answers JSON array
interface AnswerEntry {
    questionId: string
    optionId: string | null
    markedForReview?: boolean
    answeredAt: string // ISO datetime
}

// ── Start Test Session ──
export async function startTestSession(studentId: string, testId: string) {
    const startResult = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
            'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
            studentId,
            testId
        )

        const test = await tx.test.findUnique({
            where: { id: testId },
            select: {
                id: true,
                title: true,
                status: true,
                durationMinutes: true,
                settings: true,
                scheduledAt: true,
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
                assignments: {
                    select: { batchId: true, studentId: true },
                },
            },
        })

        if (!test) return { error: true, code: 'NOT_FOUND', message: 'Test not found' } as const
        if (test.status !== 'PUBLISHED') return { error: true, code: 'NOT_PUBLISHED', message: 'Test is not available' } as const
        if (test.scheduledAt && test.scheduledAt.getTime() > Date.now()) {
            return {
                error: true,
                code: 'NOT_STARTED',
                message: `This test opens at ${test.scheduledAt.toISOString()}`,
                scheduledAt: test.scheduledAt.toISOString(),
            } as const
        }

        const batchEnrollments = await tx.batchStudent.findMany({
            where: { studentId },
            select: { batchId: true },
        })
        const studentBatchIds = new Set(batchEnrollments.map(e => e.batchId))

        const isAssigned = test.assignments.some(a =>
            a.studentId === studentId || (a.batchId && studentBatchIds.has(a.batchId))
        )
        if (!isAssigned) return { error: true, code: 'FORBIDDEN', message: 'You are not assigned to this test' } as const

        const existingSession = await tx.testSession.findFirst({
            where: { testId, studentId },
            orderBy: { startedAt: 'desc' },
        })

        if (existingSession) {
            if (existingSession.status === 'IN_PROGRESS') {
                const timeRemaining = Math.max(0, Math.floor(
                    (existingSession.serverDeadline.getTime() - Date.now()) / 1000
                ))

                if (timeRemaining <= 0) {
                    return { error: true, code: 'TIMED_OUT', message: 'Test time has expired', sessionId: existingSession.id } as const
                }

                const safeQuestions = stripCorrectAnswers(test.questions, test.settings)
                return {
                    sessionId: existingSession.id,
                    questions: safeQuestions,
                    serverDeadline: existingSession.serverDeadline.toISOString(),
                    durationMinutes: test.durationMinutes,
                    answers: existingSession.answers as unknown as AnswerEntry[] || [],
                    resumed: true,
                } as const
            }

            return { error: true, code: 'ALREADY_COMPLETED', message: 'You have already completed this test' } as const
        }

        const lifecycle = getScheduledTestLifecycle(test)
        if (lifecycle.isFinished) {
            return {
                error: true,
                code: 'WINDOW_CLOSED',
                message: 'This test has already finished and is no longer available.',
                scheduledEndAt: lifecycle.scheduledEndAt?.toISOString(),
            } as const
        }

        const now = new Date()
        const deadline = new Date(now.getTime() + test.durationMinutes * 60 * 1000)

        const session = await tx.testSession.create({
            data: {
                testId,
                studentId,
                status: 'IN_PROGRESS',
                startedAt: now,
                serverDeadline: deadline,
                answers: [] as unknown as Prisma.InputJsonValue,
                tabSwitchCount: 0,
                totalMarks: test.questions.length,
            },
        })

        const safeQuestions = stripCorrectAnswers(test.questions, test.settings)

        return {
            sessionId: session.id,
            questions: safeQuestions,
            serverDeadline: deadline.toISOString(),
            durationMinutes: test.durationMinutes,
            answers: [],
            resumed: false,
            forceSubmitNotBefore: Math.ceil(deadline.getTime() / 1000) + 1,
        } as const
    })

    if ('error' in startResult && startResult.error && startResult.code === 'TIMED_OUT' && 'sessionId' in startResult) {
        const result = await submitTest(studentId, startResult.sessionId, true)
        return { error: true, code: 'TIMED_OUT', message: 'Test time has expired', result }
    }

    if (!('error' in startResult) && !startResult.resumed && 'forceSubmitNotBefore' in startResult) {
        try {
            await enqueueForceSubmit(startResult.sessionId, studentId, startResult.forceSubmitNotBefore)
        } catch (err) {
            console.warn('[ARENA] Could not schedule force-submit:', err)
        }

        return {
            sessionId: startResult.sessionId,
            questions: startResult.questions,
            serverDeadline: startResult.serverDeadline,
            durationMinutes: startResult.durationMinutes,
            answers: startResult.answers,
            resumed: startResult.resumed,
        }
    }

    return startResult
}

// ── Save Answer (per-question auto-save) ──
export async function saveAnswer(
    studentId: string,
    sessionId: string,
    questionId: string,
    optionId: string | null
) {
    // Use a transaction with row-level lock to prevent lost writes under contention
    return prisma.$transaction(async (tx) => {
        // Lock the row for update — prevents concurrent read-modify-write races
        const locked = await tx.$queryRawUnsafe<Array<{
            id: string; studentId: string; status: string;
            serverDeadline: Date; answers: unknown
        }>>(
            `SELECT id, "studentId", status, "serverDeadline", answers
             FROM "TestSession" WHERE id = $1 FOR UPDATE`,
            sessionId
        )

        const session = locked[0]
        if (!session) return { error: true, code: 'NOT_FOUND', message: 'Session not found' }
        if (session.studentId !== studentId) return { error: true, code: 'FORBIDDEN', message: 'Access denied' }
        if (session.status !== 'IN_PROGRESS') return { error: true, code: 'SESSION_ENDED', message: 'Test session has ended' }

        // Check server deadline
        if (new Date(session.serverDeadline).getTime() < Date.now()) {
            return { error: true, code: 'DEADLINE_PASSED', message: 'Test time has expired' }
        }

        // Upsert answer in the JSON array
        const answers = (session.answers as unknown as AnswerEntry[] | null) || []
        const existingIdx = answers.findIndex(a => a.questionId === questionId)
        const entry: AnswerEntry = {
            questionId,
            optionId,
            answeredAt: new Date().toISOString(),
        }

        if (existingIdx >= 0) {
            answers[existingIdx] = { ...answers[existingIdx], ...entry }
        } else {
            answers.push(entry)
        }

        await tx.testSession.update({
            where: { id: sessionId },
            data: { answers: answers as unknown as Prisma.InputJsonValue },
        })

        const answeredCount = answers.filter(a => a.optionId !== null).length
        return { saved: true, answeredCount }
    })
}

// ── Save Batch Answers (periodic bulk sync from client localStorage) ──
export async function saveBatchAnswers(
    studentId: string,
    sessionId: string,
    incoming: { questionId: string; optionId: string | null; answeredAt?: string }[]
) {
    return prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRawUnsafe<Array<{
            id: string; studentId: string; status: string;
            serverDeadline: Date; answers: unknown
        }>>(
            `SELECT id, "studentId", status, "serverDeadline", answers
             FROM "TestSession" WHERE id = $1 FOR UPDATE`,
            sessionId
        )

        const session = locked[0]
        if (!session) return { error: true, code: 'NOT_FOUND', message: 'Session not found' }
        if (session.studentId !== studentId) return { error: true, code: 'FORBIDDEN', message: 'Access denied' }
        if (session.status !== 'IN_PROGRESS') return { error: true, code: 'SESSION_ENDED', message: 'Test session has ended' }

        if (new Date(session.serverDeadline).getTime() < Date.now()) {
            return { error: true, code: 'DEADLINE_PASSED', message: 'Test time has expired' }
        }

        const answers = mergeAnswerEntries(
            (session.answers as unknown as AnswerEntry[] | null) || [],
            incoming
        )

        await tx.testSession.update({
            where: { id: sessionId },
            data: { answers: answers as unknown as Prisma.InputJsonValue },
        })

        const answeredCount = answers.filter(a => a.optionId !== null).length

        return { saved: true, answeredCount, syncedCount: incoming.length }
    })
}

// ── Submit Test & Instant Grading ──
export async function submitTest(
    studentId: string,
    sessionId: string,
    force?: boolean,
    incomingAnswers?: { questionId: string; optionId: string | null; answeredAt?: string }[]
) {
    return prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRawUnsafe<Array<{
            id: string
            studentId: string
            testId: string
            status: string
            startedAt: Date
            serverDeadline: Date
            answers: unknown
        }>>(
            `SELECT id, "studentId", "testId", status, "startedAt", "serverDeadline", answers
             FROM "TestSession" WHERE id = $1 FOR UPDATE`,
            sessionId
        )

        const session = locked[0]
        if (!session) return { error: true, code: 'NOT_FOUND', message: 'Session not found' }
        if (session.studentId !== studentId) return { error: true, code: 'FORBIDDEN', message: 'Access denied' }
        if (session.status !== 'IN_PROGRESS') return { error: true, code: 'ALREADY_SUBMITTED', message: 'Test already submitted' }

        if (!force) {
            const graceMs = 30 * 1000
            if (new Date(session.serverDeadline).getTime() + graceMs < Date.now()) {
                return { error: true, code: 'DEADLINE_PASSED', message: 'Test time has expired' }
            }
        }

        const test = await tx.test.findUnique({
            where: { id: session.testId },
            include: {
                questions: { orderBy: { order: 'asc' } },
            },
        })

        if (!test) return { error: true, code: 'NOT_FOUND', message: 'Test not found' }

        const answers = mergeAnswerEntries(
            (session.answers as unknown as AnswerEntry[] | null) || [],
            incomingAnswers || []
        )

        let score = 0

        for (const answer of answers) {
            if (!answer.optionId) continue
            const question = test.questions.find(q => q.id === answer.questionId)
            if (!question) continue

            const opts = question.options as unknown
            let correctOptionId: string | null = null

            if (Array.isArray(opts)) {
                const correctOpt = (opts as Array<{ id: string; isCorrect: boolean }>).find(o => o.isCorrect)
                correctOptionId = correctOpt?.id || null
            } else if (typeof opts === 'object' && opts !== null) {
                correctOptionId = (opts as Record<string, string>).correct || null
            }

            if (correctOptionId && answer.optionId === correctOptionId) {
                score++
            }
        }

        const totalMarks = test.questions.length
        const percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 10000) / 100 : 0
        const timeTakenMs = Date.now() - new Date(session.startedAt).getTime()
        const timeTakenSeconds = Math.floor(timeTakenMs / 1000)

        const newStatus = force
            ? (new Date(session.serverDeadline).getTime() < Date.now() ? 'TIMED_OUT' : 'FORCE_SUBMITTED')
            : 'SUBMITTED'

        await tx.testSession.update({
            where: { id: sessionId },
            data: {
                status: newStatus,
                submittedAt: new Date(),
                score,
                totalMarks,
                percentage,
                answers: answers as unknown as Prisma.InputJsonValue,
            },
        })

        return {
            score,
            totalMarks,
            percentage,
            timeTaken: timeTakenSeconds,
            status: newStatus,
        }
    })
}

// ── Flag Violation (Anti-Cheat) ──
export async function flagViolation(studentId: string, sessionId: string, type: string) {
    const session = await prisma.testSession.findUnique({ where: { id: sessionId } })

    if (!session) return { error: true, code: 'NOT_FOUND', message: 'Session not found' }
    if (session.studentId !== studentId) return { error: true, code: 'FORBIDDEN', message: 'Access denied' }
    if (session.status !== 'IN_PROGRESS') return { error: true, code: 'SESSION_ENDED', message: 'Test session has ended' }

    const newCount = session.tabSwitchCount + 1

    await prisma.testSession.update({
        where: { id: sessionId },
        data: { tabSwitchCount: newCount },
    })

    // Log to audit
    try {
        await prisma.auditLog.create({
            data: {
                userId: studentId,
                action: 'VIOLATION_FLAG',
                metadata: { sessionId, type, count: newCount } as unknown as Prisma.InputJsonValue,
            },
        })
    } catch {
        // Non-critical — don't fail the request
    }

    // Auto-submit if ≥ 3 violations
    let autoSubmitted = false
    if (newCount >= 3) {
        await submitTest(studentId, sessionId, true)
        autoSubmitted = true
    }

    return { warningCount: newCount, autoSubmitted }
}

// ── Get Session Status ──
export async function getSessionStatus(studentId: string, sessionId: string) {
    const session = await prisma.testSession.findUnique({
        where: { id: sessionId },
        select: {
            id: true,
            studentId: true,
            status: true,
            serverDeadline: true,
            tabSwitchCount: true,
            answers: true,
            test: { select: { _count: { select: { questions: true } } } },
        },
    })

    if (!session) return { error: true, code: 'NOT_FOUND', message: 'Session not found' }
    if (session.studentId !== studentId) return { error: true, code: 'FORBIDDEN', message: 'Access denied' }

    const timeRemaining = Math.max(0, Math.floor(
        (session.serverDeadline.getTime() - Date.now()) / 1000
    ))

    const answers = (session.answers as unknown as AnswerEntry[] | null) || []
    const answeredCount = answers.filter(a => a.optionId !== null).length

    return {
        timeRemaining,
        answeredCount,
        totalQuestions: session.test._count.questions,
        tabSwitchCount: session.tabSwitchCount,
        status: session.status,
    }
}

// ── Helper: Strip correct answers from questions ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stripCorrectAnswers(questions: Array<any>, settings: unknown) {
    // Check if shuffle is enabled
    const testSettings = settings as { shuffleQuestions?: boolean } | null
    let processed = questions.map(q => {
        const opts = q.options as unknown

        let safeOptions: Array<{ id: string; text: string }>

        if (Array.isArray(opts)) {
            // New format: [{ id, text, isCorrect }] → strip isCorrect
            safeOptions = (opts as Array<{ id: string; text: string; isCorrect: boolean }>)
                .map(o => ({ id: o.id, text: o.text }))
        } else if (typeof opts === 'object' && opts !== null) {
            // Legacy format: { A: "text", B: "text", correct: "B" } → strip correct
            const obj = opts as Record<string, string>
            safeOptions = ['A', 'B', 'C', 'D']
                .filter(k => k !== 'correct' && obj[k])
                .map(k => ({ id: k, text: obj[k] }))
        } else {
            safeOptions = []
        }

        return {
            id: q.id,
            order: q.order,
            stem: q.stem,
            options: safeOptions,
            difficulty: q.difficulty,
            topic: q.topic,
        }
    })

    // Shuffle if settings say so
    if (testSettings?.shuffleQuestions) {
        processed = shuffleArray(processed)
        // Re-assign order based on new positions
        processed = processed.map((q, i) => ({ ...q, order: i + 1 }))
    }

    return processed
}

function shuffleArray<T>(arr: T[]): T[] {
    const shuffled = [...arr]
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
}

function mergeAnswerEntries(
    existing: AnswerEntry[],
    incoming: { questionId: string; optionId: string | null; answeredAt?: string }[]
) {
    const merged = [...existing]

    for (const item of incoming) {
        const entry: AnswerEntry = {
            questionId: item.questionId,
            optionId: item.optionId,
            answeredAt: item.answeredAt || new Date().toISOString(),
        }

        const incomingTime = new Date(entry.answeredAt).getTime()
        const existingIdx = merged.findIndex(a => a.questionId === item.questionId)

        if (existingIdx >= 0) {
            const existingTime = new Date(merged[existingIdx].answeredAt).getTime()
            if (Number.isFinite(existingTime) && existingTime > incomingTime) {
                continue
            }

            merged[existingIdx] = { ...merged[existingIdx], ...entry }
        } else {
            merged.push(entry)
        }
    }

    return merged
}
