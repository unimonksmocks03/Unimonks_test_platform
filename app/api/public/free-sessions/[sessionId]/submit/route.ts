import { NextRequest, NextResponse } from 'next/server'

import {
    getPublicLeadIdFromRequest,
    invalidJsonBody,
    mapPublicServiceError,
    validationError,
} from '@/app/api/public/_lib/route-helpers'
import { submitPublicFreeTest } from '@/lib/services/free-test-service'
import { PublicSessionParamSchema, PublicSubmitSchema } from '@/lib/validations/public-test.schema'

export const dynamic = 'force-dynamic'

export async function POST(
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
                message: 'Re-enter your details to continue this free mock.',
            },
            { status: 401 },
        )
    }

    let body: unknown

    try {
        body = await request.json()
    } catch {
        return invalidJsonBody()
    }

    const parsedBody = PublicSubmitSchema.safeParse(body)

    if (!parsedBody.success) {
        return validationError('Invalid submit payload', parsedBody.error)
    }

    const result = await submitPublicFreeTest(
        leadId,
        parsedParams.data.sessionId,
        false,
        parsedBody.data.answers,
    )

    if ('error' in result) {
        return mapPublicServiceError(result)
    }

    return NextResponse.json(result)
}
