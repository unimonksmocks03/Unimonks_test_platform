import { NextRequest, NextResponse } from 'next/server'
import { Receiver } from '@upstash/qstash'
import { getQStashEnv } from '@/lib/env'
import { submitTest } from '@/lib/services/submission-service'

export const dynamic = 'force-dynamic'

const qstashEnv = getQStashEnv()

const receiver = qstashEnv.mode === 'local'
    ? null
    : new Receiver({
        currentSigningKey: qstashEnv.currentSigningKey,
        nextSigningKey: qstashEnv.nextSigningKey,
    })

/**
 * POST /api/webhooks/force-submit
 *
 * Called by Upstash QStash to force-submit an expired test session.
 *
 * Body: { sessionId: string, studentId: string }
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

    const { sessionId, studentId } = JSON.parse(body) as { sessionId: string; studentId: string }
    const messageId = req.headers.get('upstash-message-id') || 'local'

    if (!sessionId || !studentId) {
        // Permanent failure — don't retry
        return NextResponse.json({ error: 'sessionId and studentId required' }, { status: 200 })
    }

    console.log(`[FORCE-SUBMIT] msg=${messageId} Force-submitting session=${sessionId}`)

    try {
        const result = await submitTest(studentId, sessionId, true)

        if ('error' in result && result.error) {
            console.warn(`[FORCE-SUBMIT] msg=${messageId} session=${sessionId}: ${result.message}`)
            // Return 200 for expected errors (already submitted, etc.) — no retry needed
            return NextResponse.json({ handled: true, message: result.message })
        }

        console.log(`[FORCE-SUBMIT] msg=${messageId} session=${sessionId} force-submitted: ${result.score}/${result.totalMarks}`)
        return NextResponse.json({ ok: true, score: result.score, totalMarks: result.totalMarks })
    } catch (err) {
        console.error(`[FORCE-SUBMIT] msg=${messageId} Error for session=${sessionId}:`, err)
        // Return 500 so QStash retries (transient failure)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
