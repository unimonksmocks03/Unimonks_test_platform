import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/middleware/auth-guard'
import { saveBatchAnswers } from '@/lib/services/submission-service'

// POST /api/arena/[sessionId]/batch-answer — Sync all answers in bulk
export const POST = withAuth(async (req: NextRequest, { userId, params }) => {
    const sessionId = params?.sessionId
    if (!sessionId) {
        return NextResponse.json({ error: true, code: 'VALIDATION_ERROR', message: 'sessionId is required' }, { status: 400 })
    }

    const body = await req.json()
    const { answers } = body

    if (!Array.isArray(answers)) {
        return NextResponse.json({ error: true, code: 'VALIDATION_ERROR', message: 'answers must be an array' }, { status: 400 })
    }

    // Validate each answer entry
    for (const a of answers) {
        if (!a.questionId || typeof a.questionId !== 'string') {
            return NextResponse.json({ error: true, code: 'VALIDATION_ERROR', message: 'Each answer must have a questionId string' }, { status: 400 })
        }
        if (a.optionId !== null && a.optionId !== undefined && typeof a.optionId !== 'string') {
            return NextResponse.json({ error: true, code: 'VALIDATION_ERROR', message: 'optionId must be a string or null' }, { status: 400 })
        }
    }

    const result = await saveBatchAnswers(userId, sessionId, answers)

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
