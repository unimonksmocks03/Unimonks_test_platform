import { NextResponse } from 'next/server'
import type { ZodError } from 'zod'

import type { TestServiceError } from '@/lib/services/test-service'

export function missingRouteParam(message: string) {
    return NextResponse.json(
        { error: true, code: 'BAD_REQUEST', message },
        { status: 400 },
    )
}

export function invalidJsonBody() {
    return NextResponse.json(
        { error: true, code: 'BAD_REQUEST', message: 'Invalid JSON body' },
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

export function mapTestServiceError(error: TestServiceError) {
    const statusCode = (() => {
        switch (error.code) {
            case 'FORBIDDEN':
            case 'INACTIVE_ADMIN':
                return 403
            case 'NOT_FOUND':
                return 404
            case 'BAD_REQUEST':
            case 'PARSE_ERROR':
            case 'UNSUPPORTED_DIRECT_ASSIGNMENTS':
                return 400
            case 'GENERATION_FAILED':
                return 500
            case 'INVALID_TRANSITION':
            case 'NO_ASSIGNMENTS':
            case 'NO_QUESTIONS':
            case 'NOT_DRAFT':
            case 'NOT_EDITABLE':
                return 409
            default:
                return 400
        }
    })()

    return NextResponse.json(error, { status: statusCode })
}
