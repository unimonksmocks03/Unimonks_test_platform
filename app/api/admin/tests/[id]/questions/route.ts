import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

import { withAuth } from '@/lib/middleware/auth-guard'
import { addAdminQuestion, getAdminQuestions } from '@/lib/services/test-service'
import { CreateQuestionSchema } from '@/lib/validations/test.schema'
import {
    invalidJsonBody,
    mapTestServiceError,
    missingRouteParam,
    validationError,
} from '@/app/api/admin/tests/_lib/route-helpers'
import { Role } from '@prisma/client'

// GET /api/admin/tests/[id]/questions — list test questions
async function getHandler(
    _req: NextRequest,
    ctx: { userId: string; role: Role; params?: Record<string, string> }
) {
    const testId = ctx.params?.id
    if (!testId) {
        return missingRouteParam('Test ID required')
    }

    const result = await getAdminQuestions(testId)
    if ('error' in result) {
        return mapTestServiceError(result)
    }

    return NextResponse.json(result)
}

// POST /api/admin/tests/[id]/questions — add a question to a draft test
async function postHandler(
    req: NextRequest,
    ctx: { userId: string; role: Role; params?: Record<string, string> }
) {
    const testId = ctx.params?.id
    if (!testId) {
        return missingRouteParam('Test ID required')
    }

    let body: unknown

    try {
        body = await req.json()
    } catch {
        return invalidJsonBody()
    }

    const parsed = CreateQuestionSchema.safeParse(body)
    if (!parsed.success) {
        return validationError('Invalid input', parsed.error)
    }

    const result = await addAdminQuestion(ctx.userId, testId, parsed.data)
    if ('error' in result) {
        return mapTestServiceError(result)
    }

    return NextResponse.json(result, { status: 201 })
}

export const GET = withAuth(getHandler, ['ADMIN'])
export const POST = withAuth(postHandler, ['ADMIN'])
