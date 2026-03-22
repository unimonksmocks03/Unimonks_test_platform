import { NextRequest, NextResponse } from 'next/server'

import {
    getPublicLeadIdFromRequest,
    invalidJsonBody,
    mapPublicServiceError,
    validationError,
} from '@/app/api/public/_lib/route-helpers'
import { savePublicFreeBatchAnswers } from '@/lib/services/free-test-service'
import { PublicBatchAnswerSchema, PublicSessionParamSchema } from '@/lib/validations/public-test.schema'

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

    const parsedBody = PublicBatchAnswerSchema.safeParse(body)

    if (!parsedBody.success) {
        return validationError('Invalid answer payload', parsedBody.error)
    }

    const result = await savePublicFreeBatchAnswers(
        leadId,
        parsedParams.data.sessionId,
        parsedBody.data.answers,
    )

    if ('error' in result) {
        return mapPublicServiceError(result)
    }

    return NextResponse.json(result)
}
