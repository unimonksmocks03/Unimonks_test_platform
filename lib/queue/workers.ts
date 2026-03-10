import { Worker } from 'bullmq'
import { redis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { submitTest } from '@/lib/services/submission-service'
import { generatePersonalizedFeedback } from '@/lib/services/ai-service'

/**
 * Workers for processing submission and AI feedback queues.
 * 
 * In production, these should be started as a separate process:
 *   npx ts-node lib/queue/workers.ts
 * 
 * For development, they can be imported and initialized from a server-side module.
 */

// ── Submission Worker (concurrency: 10) ──
export const submissionWorker = new Worker(
    'test-submissions',
    async (job) => {
        const { sessionId, studentId } = job.data
        console.log(`[QUEUE] Processing submission: session=${sessionId}`)

        const startTime = Date.now()

        // Grade the submission
        const result = await submitTest(studentId, sessionId, true)

        if ('error' in result && result.error) {
            console.error(`[QUEUE] Grading failed: ${result.message}`)
            throw new Error(result.message as string)
        }

        const processingTime = Date.now() - startTime
        console.log(`[QUEUE] Graded session=${sessionId} score=${result.score}/${result.totalMarks} in ${processingTime}ms`)

        // Enqueue AI feedback (async, non-blocking)
        try {
            const { enqueueAIFeedback } = await import('@/lib/queue/ai-feedback-queue')
            await enqueueAIFeedback(sessionId)
        } catch (err) {
            console.warn('[QUEUE] Could not enqueue AI feedback:', err)
        }

        return { score: result.score, totalMarks: result.totalMarks, processingTime }
    },
    {
        connection: redis,
        concurrency: 10,
    }
)

// ── AI Feedback Worker (concurrency: 3) ──
export const aiFeedbackWorker = new Worker(
    'ai-feedback',
    async (job) => {
        const { sessionId } = job.data
        console.log(`[AI-QUEUE] Generating feedback: session=${sessionId}`)

        const startTime = Date.now()

        // Fetch session with test + questions + student answers
        const session = await prisma.testSession.findUnique({
            where: { id: sessionId },
            include: {
                test: {
                    include: { questions: { orderBy: { order: 'asc' } } },
                },
            },
        })

        if (!session) {
            throw new Error(`Session ${sessionId} not found`)
        }

        if (session.status === 'IN_PROGRESS') {
            throw new Error('Session not yet submitted')
        }

        // Check if feedback already exists
        const existingFeedback = await prisma.aIFeedback.findUnique({
            where: { testSessionId: sessionId },
        })

        if (existingFeedback) {
            console.log(`[AI-QUEUE] Feedback already exists for session=${sessionId}, skipping`)
            return { skipped: true }
        }

        // Generate feedback via AI
        const feedback = await generatePersonalizedFeedback(session, session.test.questions)

        // Store feedback
        await prisma.aIFeedback.create({
            data: {
                testSessionId: sessionId,
                strengths: feedback.strengths,
                weaknesses: feedback.weaknesses,
                actionPlan: feedback.actionPlan,
                questionExplanations: feedback.questionExplanations,
                overallTag: feedback.overallTag,
            },
        })

        const processingTime = Date.now() - startTime
        console.log(`[AI-QUEUE] Feedback generated for session=${sessionId} in ${processingTime}ms`)

        // Emit SSE event to the student
        try {
            const { emitToUser } = await import('@/lib/services/event-service')
            await emitToUser(session.studentId, {
                type: 'feedback:ready',
                data: { sessionId, overallTag: feedback.overallTag },
            })
        } catch (err) {
            console.warn('[AI-QUEUE] Could not emit SSE event:', err)
        }

        return { overallTag: feedback.overallTag, processingTime }
    },
    {
        connection: redis,
        concurrency: 3,
    }
)

// ── Timer Enforcement: Force-submit expired sessions ──
export async function forceSubmitExpiredSessions() {
    const expired = await prisma.testSession.findMany({
        where: {
            status: 'IN_PROGRESS',
            serverDeadline: { lt: new Date() },
        },
        select: { id: true, studentId: true },
    })

    if (expired.length === 0) return { processed: 0 }

    console.log(`[TIMER] Found ${expired.length} expired sessions, force-submitting...`)

    let processed = 0
    for (const session of expired) {
        try {
            await submitTest(session.studentId, session.id, true)
            processed++
        } catch (err) {
            console.error(`[TIMER] Failed to force-submit session=${session.id}:`, err)
        }
    }

    return { processed, total: expired.length }
}

// ── Error handlers ──
submissionWorker.on('failed', (job, err) => {
    console.error(`[QUEUE] Submission job ${job?.id} failed:`, err.message)
})

aiFeedbackWorker.on('failed', (job, err) => {
    console.error(`[AI-QUEUE] AI feedback job ${job?.id} failed:`, err.message)
})

submissionWorker.on('completed', (job) => {
    console.log(`[QUEUE] Submission job ${job.id} completed`)
})

aiFeedbackWorker.on('completed', (job) => {
    console.log(`[AI-QUEUE] AI feedback job ${job.id} completed`)
})
