import { NextRequest, NextResponse } from 'next/server'

import {
    getPublicLeadIdFromRequest,
    mapPublicServiceError,
    validationError,
} from '@/app/api/public/_lib/route-helpers'
import { startPublicFreeTestSession } from '@/lib/services/free-test-service'
import { PublicTestParamSchema } from '@/lib/validations/public-test.schema'

export const dynamic = 'force-dynamic'

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ testId: string }> },
) {
    const params = await context.params
    const parsedParams = PublicTestParamSchema.safeParse(params)

    if (!parsedParams.success) {
        return validationError('Invalid route params', parsedParams.error)
    }

    const leadId = getPublicLeadIdFromRequest(request)

    if (!leadId) {
        return NextResponse.json(
            {
                error: true,
                code: 'LEAD_ACCESS_REQUIRED',
                message: 'Submit your details before starting a free mock.',
            },
            { status: 401 },
        )
    }

    const result = await startPublicFreeTestSession(leadId, parsedParams.data.testId)

    if ('error' in result) {
        return mapPublicServiceError(result)
    }

    return NextResponse.json(result)
}
