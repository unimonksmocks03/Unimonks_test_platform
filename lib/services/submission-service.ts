import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

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
    // 1. Verify test is PUBLISHED
    const test = await prisma.test.findUnique({
        where: { id: testId },
        select: {
            id: true,
            title: true,
            status: true,
            durationMinutes: true,
            settings: true,
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

    if (!test) return { error: true, code: 'NOT_FOUND', message: 'Test not found' }
    if (test.status !== 'PUBLISHED') return { error: true, code: 'NOT_PUBLISHED', message: 'Test is not available' }

    // 2. Verify student is assigned (via batch or direct assignment)
    const batchEnrollments = await prisma.batchStudent.findMany({
        where: { studentId },
        select: { batchId: true },
    })
    const studentBatchIds = new Set(batchEnrollments.map(e => e.batchId))

    const isAssigned = test.assignments.some(a =>
        a.studentId === studentId || (a.batchId && studentBatchIds.has(a.batchId))
    )
    if (!isAssigned) return { error: true, code: 'FORBIDDEN', message: 'You are not assigned to this test' }

    // 3. Check for existing session — resume if IN_PROGRESS, reject if completed
    const existingSession = await prisma.testSession.findFirst({
        where: { testId, studentId },
        orderBy: { startedAt: 'desc' },
    })

    if (existingSession) {
        if (existingSession.status === 'IN_PROGRESS') {
            // Resume existing session
            const timeRemaining = Math.max(0, Math.floor(
                (existingSession.serverDeadline.getTime() - Date.now()) / 1000
            ))

            if (timeRemaining <= 0) {
                // Deadline passed — force submit
                const result = await submitTest(studentId, existingSession.id, true)
                return { error: true, code: 'TIMED_OUT', message: 'Test time has expired', result }
            }

            // Strip correct answers from questions
            const safeQuestions = stripCorrectAnswers(test.questions, test.settings)
            return {
                sessionId: existingSession.id,
                questions: safeQuestions,
                serverDeadline: existingSession.serverDeadline.toISOString(),
                durationMinutes: test.durationMinutes,
                answers: existingSession.answers as unknown as AnswerEntry[] || [],
                resumed: true,
            }
        }

        // Already completed
        return { error: true, code: 'ALREADY_COMPLETED', message: 'You have already completed this test' }
    }

    // 4. Create new session
    const now = new Date()
    const deadline = new Date(now.getTime() + test.durationMinutes * 60 * 1000)

    const session = await prisma.testSession.create({
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

    // 5. Strip correct answers + explanation before sending to client
    const safeQuestions = stripCorrectAnswers(test.questions, test.settings)

    return {
        sessionId: session.id,
        questions: safeQuestions,
        serverDeadline: deadline.toISOString(),
        durationMinutes: test.durationMinutes,
        answers: [],
        resumed: false,
    }
}

// ── Save Answer (per-question auto-save) ──
export async function saveAnswer(
    studentId: string,
    sessionId: string,
    questionId: string,
    optionId: string | null
) {
    const session = await prisma.testSession.findUnique({ where: { id: sessionId } })

    if (!session) return { error: true, code: 'NOT_FOUND', message: 'Session not found' }
    if (session.studentId !== studentId) return { error: true, code: 'FORBIDDEN', message: 'Access denied' }
    if (session.status !== 'IN_PROGRESS') return { error: true, code: 'SESSION_ENDED', message: 'Test session has ended' }

    // Check server deadline
    if (session.serverDeadline.getTime() < Date.now()) {
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

    await prisma.testSession.update({
        where: { id: sessionId },
        data: { answers: answers as unknown as Prisma.InputJsonValue },
    })

    const answeredCount = answers.filter(a => a.optionId !== null).length

    return { saved: true, answeredCount }
}

// ── Save Batch Answers (periodic bulk sync from client localStorage) ──
export async function saveBatchAnswers(
    studentId: string,
    sessionId: string,
    incoming: { questionId: string; optionId: string | null; answeredAt?: string }[]
) {
    const session = await prisma.testSession.findUnique({ where: { id: sessionId } })

    if (!session) return { error: true, code: 'NOT_FOUND', message: 'Session not found' }
    if (session.studentId !== studentId) return { error: true, code: 'FORBIDDEN', message: 'Access denied' }
    if (session.status !== 'IN_PROGRESS') return { error: true, code: 'SESSION_ENDED', message: 'Test session has ended' }

    // Check server deadline
    if (session.serverDeadline.getTime() < Date.now()) {
        return { error: true, code: 'DEADLINE_PASSED', message: 'Test time has expired' }
    }

    // Merge incoming answers into existing
    const answers = (session.answers as unknown as AnswerEntry[] | null) || []

    for (const item of incoming) {
        const entry: AnswerEntry = {
            questionId: item.questionId,
            optionId: item.optionId,
            answeredAt: item.answeredAt || new Date().toISOString(),
        }
        const existingIdx = answers.findIndex(a => a.questionId === item.questionId)
        if (existingIdx >= 0) {
            answers[existingIdx] = { ...answers[existingIdx], ...entry }
        } else {
            answers.push(entry)
        }
    }

    await prisma.testSession.update({
        where: { id: sessionId },
        data: { answers: answers as unknown as Prisma.InputJsonValue },
    })

    const answeredCount = answers.filter(a => a.optionId !== null).length

    return { saved: true, answeredCount, syncedCount: incoming.length }
}

// ── Submit Test & Instant Grading ──
export async function submitTest(studentId: string, sessionId: string, force?: boolean) {
    const session = await prisma.testSession.findUnique({
        where: { id: sessionId },
        include: {
            test: {
                include: {
                    questions: { orderBy: { order: 'asc' } },
                },
            },
        },
    })

    if (!session) return { error: true, code: 'NOT_FOUND', message: 'Session not found' }
    if (session.studentId !== studentId) return { error: true, code: 'FORBIDDEN', message: 'Access denied' }
    if (session.status !== 'IN_PROGRESS') return { error: true, code: 'ALREADY_SUBMITTED', message: 'Test already submitted' }

    // Check deadline (with 30s grace for network latency) — skip if force
    if (!force) {
        const graceMs = 30 * 1000
        if (session.serverDeadline.getTime() + graceMs < Date.now()) {
            return { error: true, code: 'DEADLINE_PASSED', message: 'Test time has expired' }
        }
    }

    // Grade answers
    const answers = (session.answers as unknown as AnswerEntry[] | null) || []
    const questions = session.test.questions
    let score = 0

    for (const answer of answers) {
        if (!answer.optionId) continue
        const question = questions.find(q => q.id === answer.questionId)
        if (!question) continue

        // Options can be in array format or legacy object format
        const opts = question.options as unknown
        let correctOptionId: string | null = null

        if (Array.isArray(opts)) {
            const correctOpt = (opts as Array<{ id: string; isCorrect: boolean }>).find(o => o.isCorrect)
            correctOptionId = correctOpt?.id || null
        } else if (typeof opts === 'object' && opts !== null) {
            // Legacy format: { A: "text", B: "text", correct: "B" }
            correctOptionId = (opts as Record<string, string>).correct || null
        }

        if (correctOptionId && answer.optionId === correctOptionId) {
            score++
        }
    }

    const totalMarks = questions.length
    const percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 10000) / 100 : 0
    const timeTakenMs = Date.now() - session.startedAt.getTime()
    const timeTakenSeconds = Math.floor(timeTakenMs / 1000)

    // Determine status
    const newStatus = force
        ? (session.serverDeadline.getTime() < Date.now() ? 'TIMED_OUT' : 'FORCE_SUBMITTED')
        : 'SUBMITTED'

    await prisma.testSession.update({
        where: { id: sessionId },
        data: {
            status: newStatus,
            submittedAt: new Date(),
            score,
            totalMarks,
            percentage,
        },
    })

    return {
        score,
        totalMarks,
        percentage,
        timeTaken: timeTakenSeconds,
        status: newStatus,
    }
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
