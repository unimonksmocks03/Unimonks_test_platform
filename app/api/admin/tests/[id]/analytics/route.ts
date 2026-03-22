import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

import { withAuth } from '@/lib/middleware/auth-guard'
import { getTestAnalytics } from '@/lib/services/analytics-service'
import { Role } from '@prisma/client'

async function getHandler(
    _req: NextRequest,
    ctx: { userId: string; role: Role; params?: Record<string, string> },
) {
    const testId = ctx.params?.id

    if (!testId) {
        return NextResponse.json(
            { error: true, code: 'BAD_REQUEST', message: 'Test ID required' },
            { status: 400 },
        )
    }

    const result = await getTestAnalytics(testId)

    if ('error' in result) {
        return NextResponse.json(result, { status: 404 })
    }

    return NextResponse.json(result)
}

export const GET = withAuth(getHandler, ['ADMIN'])
