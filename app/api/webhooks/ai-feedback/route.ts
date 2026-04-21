import { NextRequest, NextResponse } from 'next/server'
import { Receiver } from '@upstash/qstash'
import { getQStashEnv } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import { generatePersonalizedFeedback } from '@/lib/services/ai-service'
import {
    buildSessionTestSnapshot,
    parseSessionTestSnapshot,
} from '@/lib/utils/test-session-snapshot'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Allow up to 60s for AI generation (Vercel Pro/Enterprise)

const qstashEnv = getQStashEnv()

const receiver = qstashEnv.mode === 'local'
    ? null
    : new Receiver({
        currentSigningKey: qstashEnv.currentSigningKey,
        nextSigningKey: qstashEnv.nextSigningKey,
    })

/**
 * POST /api/webhooks/ai-feedback
 *
 * Called by Upstash QStash after a test is submitted.
 * Generates personalized AI feedback for the student's session.
 *
 * Body: { sessionId: string }
 */
export async function POST(req: NextRequest) {
    // 1. Verify QStash signature (skip in local dev mode)
    const body = await req.text()

    if (receiver) {
        const signature = req.headers.get('upstash-signature')
        if (!signature) {
            return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
        }

        const isValid = await receiver.verify({ body, signature }).catch(() => false)
        if (!isValid) {
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
        }
    }

    const { sessionId } = JSON.parse(body) as { sessionId: string }
    const messageId = req.headers.get('upstash-message-id') || 'local'

    if (!sessionId) {
        // Permanent failure — don't retry
        return NextResponse.json({ error: 'sessionId required' }, { status: 200 })
    }

    console.log(`[AI-WEBHOOK] msg=${messageId} Generating feedback: session=${sessionId}`)
    const startTime = Date.now()

    try {
        // 2. Fetch session with test questions
        const session = await prisma.testSession.findUnique({
            where: { id: sessionId },
            select: {
                id: true,
                studentId: true,
                status: true,
                score: true,
                totalMarks: true,
                percentage: true,
                answers: true,
                tabSwitchCount: true,
                startedAt: true,
                submittedAt: true,
                testSnapshot: true,
                test: {
                    select: {
                        title: true,
                        description: true,
                        durationMinutes: true,
                        settings: true,
                        questions: {
                            orderBy: { order: 'asc' },
                            select: {
                                id: true,
                                order: true,
                                stem: true,
                                sharedContext: true,
                                options: true,
                                difficulty: true,
                                topic: true,
                                explanation: true,
                            },
                        },
                    },
                },
            },
        })

        if (!session) {
            console.error(`[AI-WEBHOOK] msg=${messageId} Session ${sessionId} not found`)
            // Permanent failure — return 200 so QStash doesn't retry
            return NextResponse.json({ error: 'Session not found' }, { status: 200 })
        }

        if (session.status === 'IN_PROGRESS') {
            console.error(`[AI-WEBHOOK] msg=${messageId} Session ${sessionId} not yet submitted`)
            // Permanent failure — return 200
            return NextResponse.json({ error: 'Session not yet submitted' }, { status: 200 })
        }

        // 3. Check if feedback already exists (idempotent)
        const existing = await prisma.aIFeedback.findUnique({
            where: { testSessionId: sessionId },
        })

        if (existing) {
            console.log(`[AI-WEBHOOK] msg=${messageId} Feedback already exists for session=${sessionId}, skipping`)
            return NextResponse.json({ skipped: true })
        }

        const testSnapshot = parseSessionTestSnapshot(session.testSnapshot)
            ?? buildSessionTestSnapshot(session.test)

        // 4. Generate feedback via AI
        const feedback = await generatePersonalizedFeedback(session, testSnapshot.questions)

        // 5. Store feedback
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

        // 6. Emit SSE event to the student
        try {
            const { emitToUser } = await import('@/lib/services/event-service')
            await emitToUser(session.studentId, {
                type: 'feedback:ready',
                data: { sessionId, overallTag: feedback.overallTag },
            })
        } catch (err) {
            console.warn('[AI-WEBHOOK] Could not emit SSE event:', err)
        }

        const processingTime = Date.now() - startTime
        console.log(`[AI-WEBHOOK] msg=${messageId} Feedback generated for session=${sessionId} in ${processingTime}ms`)

        return NextResponse.json({ ok: true, overallTag: feedback.overallTag, processingTime })
    } catch (err) {
        console.error(`[AI-WEBHOOK] msg=${messageId} Error generating feedback for session=${sessionId}:`, err)
        // Return 500 so QStash retries (transient failure)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
