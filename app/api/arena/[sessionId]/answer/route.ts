import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/middleware/auth-guard'
import { redis } from '@/lib/redis'
import { saveAnswer } from '@/lib/services/submission-service'

const ANSWER_RATE_KEY = (sid: string) => `arena:rate:${sid}`
const ANSWER_RATE_MAX = 2 // max 2 saves per second per session

// POST /api/arena/[sessionId]/answer — Save an answer (auto-save)
export const POST = withAuth(async (req: NextRequest, { userId, params }) => {
    const sessionId = params?.sessionId
    if (!sessionId) {
        return NextResponse.json({ error: true, code: 'VALIDATION_ERROR', message: 'sessionId is required' }, { status: 400 })
    }

    // Rate limit: max 2 answer saves per second per session
    const rateKey = ANSWER_RATE_KEY(sessionId)
    const count = await redis.incr(rateKey)
    if (count === 1) await redis.expire(rateKey, 1) // 1 second window
    if (count > ANSWER_RATE_MAX) {
        return NextResponse.json({ error: true, code: 'RATE_LIMITED', message: 'Too many saves. Slow down.' }, { status: 429 })
    }

    const body = await req.json()
    const { questionId, optionId } = body

    if (!questionId || typeof questionId !== 'string') {
        return NextResponse.json({ error: true, code: 'VALIDATION_ERROR', message: 'questionId is required' }, { status: 400 })
    }

    // Validate optionId format (must be a string or null, prevent tampering)
    if (optionId !== null && optionId !== undefined && typeof optionId !== 'string') {
        return NextResponse.json({ error: true, code: 'VALIDATION_ERROR', message: 'Invalid optionId format' }, { status: 400 })
    }

    const result = await saveAnswer(userId, sessionId, questionId, optionId ?? null)

    if ('error' in result && result.error) {
        const statusMap: Record<string, number> = {
            NOT_FOUND: 404,
            FORBIDDEN: 403,
            SESSION_ENDED: 400,
            DEADLINE_PASSED: 410,
        }
        return NextResponse.json(result, { status: statusMap[result.code as string] || 400 })
    }

    return NextResponse.json(result)
}, ['STUDENT'])

