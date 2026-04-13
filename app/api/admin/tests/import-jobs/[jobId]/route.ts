import { NextRequest, NextResponse } from 'next/server'

import { withAuth } from '@/lib/middleware/auth-guard'
import { missingRouteParam } from '@/app/api/admin/tests/_lib/route-helpers'
import { getDocumentImportJob } from '@/lib/services/import-job-service'
import { Role } from '@prisma/client'

export const dynamic = 'force-dynamic'

async function getHandler(
    _req: NextRequest,
    ctx: { userId: string; role: Role; params?: Record<string, string> },
) {
    const jobId = ctx.params?.jobId
    if (!jobId) {
        return missingRouteParam('Import job id is required.')
    }

    const result = await getDocumentImportJob(ctx.userId, jobId)
    if ('error' in result) {
        const status = (() => {
            switch (result.code) {
                case 'FORBIDDEN':
                case 'INACTIVE_ADMIN':
                    return 403
                case 'NOT_FOUND':
                    return 404
                case 'BAD_REQUEST':
                default:
                    return 400
            }
        })()

        return NextResponse.json(result, { status })
    }

    return NextResponse.json(result)
}

export const GET = withAuth(getHandler, ['ADMIN'])
