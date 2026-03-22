import { NextRequest, NextResponse } from 'next/server'

import {
    getPublicLeadIdFromRequest,
    mapPublicServiceError,
    validationError,
} from '@/app/api/public/_lib/route-helpers'
import { getPublicFreeResult } from '@/lib/services/free-test-service'
import { PublicSessionParamSchema } from '@/lib/validations/public-test.schema'

export const dynamic = 'force-dynamic'

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ sessionId: string }> },
) {
    const params = await context.params
    const parsedParams = PublicSessionParamSchema.safeParse(params)

    if (!parsedParams.success) {
        return validationError('Invalid route params', parsedParams.error)
    }

    const leadId = getPublicLeadIdFromRequest(request)

    if (!leadId) {
        return NextResponse.json(
            {
                error: true,
                code: 'LEAD_ACCESS_REQUIRED',
                message: 'Re-enter your details to view this free mock result.',
            },
            { status: 401 },
        )
    }

    const result = await getPublicFreeResult(leadId, parsedParams.data.sessionId)

    if ('error' in result) {
        return mapPublicServiceError(result)
    }

    return NextResponse.json(result)
}
