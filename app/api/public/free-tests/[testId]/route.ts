import { NextRequest, NextResponse } from 'next/server'

import { getPublicLeadIdFromRequest, mapPublicServiceError, validationError } from '@/app/api/public/_lib/route-helpers'
import { getPublicFreeTestDetail } from '@/lib/services/free-test-service'
import { PublicTestParamSchema } from '@/lib/validations/public-test.schema'

export const dynamic = 'force-dynamic'

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ testId: string }> },
) {
    const params = await context.params
    const parsedParams = PublicTestParamSchema.safeParse(params)

    if (!parsedParams.success) {
        return validationError('Invalid route params', parsedParams.error)
    }

    const leadId = getPublicLeadIdFromRequest(request)
    const result = await getPublicFreeTestDetail(parsedParams.data.testId, leadId)

    if ('error' in result) {
        return mapPublicServiceError(result)
    }

    return NextResponse.json(result)
}
