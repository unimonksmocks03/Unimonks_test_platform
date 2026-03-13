import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/middleware/auth-guard'
import { startTestSession } from '@/lib/services/submission-service'

// POST /api/arena/start — Start a test session
export const POST = withAuth(async (req: NextRequest, { userId }) => {
    const body = await req.json()
    const { testId } = body

    if (!testId) {
        return NextResponse.json(
            { error: true, code: 'VALIDATION_ERROR', message: 'testId is required' },
            { status: 400 }
        )
    }

    const result = await startTestSession(userId, testId)

    if ('error' in result && result.error) {
        const statusMap: Record<string, number> = {
            NOT_FOUND: 404,
            NOT_PUBLISHED: 400,
            NOT_STARTED: 409,
            WINDOW_CLOSED: 410,
            FORBIDDEN: 403,
            ALREADY_COMPLETED: 409,
            TIMED_OUT: 410,
        }
        return NextResponse.json(result, { status: statusMap[result.code as string] || 400 })
    }

    return NextResponse.json(result)
}, ['STUDENT'])
