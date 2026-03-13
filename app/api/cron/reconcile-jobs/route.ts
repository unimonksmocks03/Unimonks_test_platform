import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { reconcileSessionsAndFeedback } from '@/lib/services/maintenance-service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
    if (!isAuthorizedCronRequest(req)) {
        return NextResponse.json(
            { error: true, code: 'FORBIDDEN', message: 'Unauthorized cron request' },
            { status: 403 }
        )
    }

    const result = await reconcileSessionsAndFeedback()

    return NextResponse.json({
        ok: true,
        ...result,
    })
}
