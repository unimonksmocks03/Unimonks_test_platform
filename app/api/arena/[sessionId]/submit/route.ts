import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/middleware/auth-guard'
import { submitTest } from '@/lib/services/submission-service'
import { enqueueAIFeedback } from '@/lib/queue/qstash'

// POST /api/arena/[sessionId]/submit — Submit test & get instant grade
export const POST = withAuth(async (req: NextRequest, { userId, params }) => {
    const sessionId = params?.sessionId
    if (!sessionId) {
        return NextResponse.json({ error: true, code: 'VALIDATION_ERROR', message: 'sessionId is required' }, { status: 400 })
    }

    const body = await req.json().catch(() => ({}))
    const answers = Array.isArray(body?.answers) ? body.answers : undefined

    if (answers) {
        for (const answer of answers) {
            if (!answer.questionId || typeof answer.questionId !== 'string') {
                return NextResponse.json({ error: true, code: 'VALIDATION_ERROR', message: 'Each answer must have a questionId string' }, { status: 400 })
            }
            if (answer.optionId !== null && answer.optionId !== undefined && typeof answer.optionId !== 'string') {
                return NextResponse.json({ error: true, code: 'VALIDATION_ERROR', message: 'optionId must be a string or null' }, { status: 400 })
            }
        }
    }

    const result = await submitTest(userId, sessionId, false, answers)

    if ('error' in result && result.error) {
        const statusMap: Record<string, number> = {
            NOT_FOUND: 404,
            FORBIDDEN: 403,
            ALREADY_SUBMITTED: 409,
            DEADLINE_PASSED: 410,
        }
        return NextResponse.json(result, { status: statusMap[result.code as string] || 400 })
    }

    // Enqueue AI feedback generation (non-blocking, async via QStash)
    try {
        await enqueueAIFeedback(sessionId)
    } catch (err) {
        console.warn('[SUBMIT] Could not enqueue AI feedback:', err)
    }

    return NextResponse.json(result)
}, ['STUDENT'])
