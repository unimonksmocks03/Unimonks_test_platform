import { NextRequest, NextResponse } from 'next/server'
import type { ZodError } from 'zod'

import {
    PUBLIC_LEAD_COOKIE_NAME,
    PUBLIC_LEAD_TOKEN_MAX_AGE_SECONDS,
    verifyPublicLeadAccessToken,
    type LeadCaptureServiceError,
} from '@/lib/services/lead-capture-service'
import type { FreeTestServiceError } from '@/lib/services/free-test-service'

export function invalidJsonBody() {
    return NextResponse.json(
        {
            error: true,
            code: 'BAD_REQUEST',
            message: 'Invalid JSON body',
        },
        { status: 400 },
    )
}

export function validationError(message: string, error: ZodError) {
    return NextResponse.json(
        {
            error: true,
            code: 'VALIDATION_ERROR',
            message,
            details: error.issues,
        },
        { status: 400 },
    )
}

export function mapPublicServiceError(error: FreeTestServiceError | LeadCaptureServiceError) {
    const statusCode = (() => {
        switch (error.code) {
            case 'LEAD_ACCESS_REQUIRED':
                return 401
            case 'FORBIDDEN':
                return 403
            case 'NOT_FOUND':
                return 404
            case 'REGISTERED_STUDENT_USE_LOGIN':
            case 'FREE_ATTEMPT_ALREADY_USED':
            case 'SESSION_ENDED':
            case 'SESSION_IN_PROGRESS':
                return 409
            case 'DEADLINE_PASSED':
            case 'TIMED_OUT':
                return 410
            default:
                return 400
        }
    })()

    return NextResponse.json(error, { status: statusCode })
}

export function getPublicLeadIdFromRequest(request: NextRequest) {
    const token = request.cookies.get(PUBLIC_LEAD_COOKIE_NAME)?.value
    if (!token) {
        return null
    }

    return verifyPublicLeadAccessToken(token)?.leadId ?? null
}

export function setPublicLeadCookie(response: NextResponse, accessToken: string) {
    response.cookies.set(PUBLIC_LEAD_COOKIE_NAME, accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: PUBLIC_LEAD_TOKEN_MAX_AGE_SECONDS,
    })

    return response
}
