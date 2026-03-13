import { NextRequest, NextResponse } from 'next/server'
import { purgeExpiredFinishedTests } from '@/lib/services/test-lifecycle'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
    if (!isAuthorizedCronRequest(req)) {
        return NextResponse.json(
            { error: true, code: 'FORBIDDEN', message: 'Unauthorized cron request' },
            { status: 403 }
        )
    }

    const result = await purgeExpiredFinishedTests()

    return NextResponse.json({
        ok: true,
        deletedCount: result.deletedCount,
        deletedIds: result.deletedIds,
        deletedTitles: result.deletedTitles,
    })
}
