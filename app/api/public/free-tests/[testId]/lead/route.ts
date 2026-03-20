import { NextRequest, NextResponse } from 'next/server'

import {
    invalidJsonBody,
    mapPublicServiceError,
    setPublicLeadCookie,
    validationError,
} from '@/app/api/public/_lib/route-helpers'
import { captureLeadForFreeTest } from '@/lib/services/lead-capture-service'
import { PublicLeadCaptureSchema, PublicTestParamSchema } from '@/lib/validations/public-test.schema'

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

    let body: unknown

    try {
        body = await request.json()
    } catch {
        return invalidJsonBody()
    }

    const parsedBody = PublicLeadCaptureSchema.safeParse(body)

    if (!parsedBody.success) {
        return validationError('Invalid lead details', parsedBody.error)
    }

    const result = await captureLeadForFreeTest(parsedParams.data.testId, parsedBody.data)

    if ('error' in result) {
        return mapPublicServiceError(result)
    }

    const response = NextResponse.json({
        lead: result.lead,
        nextAction: result.nextAction,
        test: result.test,
    })

    return setPublicLeadCookie(response, result.accessToken)
}
