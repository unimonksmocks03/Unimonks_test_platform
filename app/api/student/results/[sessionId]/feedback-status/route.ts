import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
import { withAuth } from '@/lib/middleware/auth-guard'
import { getFeedbackStatus } from '@/lib/services/student-service'
import { Role } from '@prisma/client'

async function getHandler(
    req: NextRequest,
    ctx: { userId: string; role: Role; params?: Record<string, string> }
) {
    const sessionId = ctx.params?.sessionId
    if (!sessionId) {
        return NextResponse.json(
            { error: true, code: 'BAD_REQUEST', message: 'Session ID required' },
            { status: 400 }
        )
    }

    const result = await getFeedbackStatus(ctx.userId, sessionId)
    if ('error' in result) {
        const statusCode = result.code === 'FORBIDDEN' ? 403 : 404
        return NextResponse.json(result, { status: statusCode })
    }

    return NextResponse.json(result, {
        headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
    })
}

export const GET = withAuth(getHandler, ['STUDENT'])
