import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

import { withAuth } from '@/lib/middleware/auth-guard'
import { deleteAdminQuestion, updateAdminQuestion } from '@/lib/services/test-service'
import { UpdateQuestionSchema } from '@/lib/validations/test.schema'
import {
    invalidJsonBody,
    mapTestServiceError,
    missingRouteParam,
    validationError,
} from '@/app/api/admin/tests/_lib/route-helpers'
import { Role } from '@prisma/client'

// PATCH /api/admin/tests/[id]/questions/[qId] — update a draft question
async function patchHandler(
    req: NextRequest,
    ctx: { userId: string; role: Role; params?: Record<string, string> }
) {
    const testId = ctx.params?.id
    const questionId = ctx.params?.qId
    if (!testId || !questionId) {
        return missingRouteParam('Test ID and question ID are required')
    }

    let body: unknown

    try {
        body = await req.json()
    } catch {
        return invalidJsonBody()
    }

    const parsed = UpdateQuestionSchema.safeParse(body)
    if (!parsed.success) {
        return validationError('Invalid input', parsed.error)
    }

    const result = await updateAdminQuestion(ctx.userId, testId, questionId, parsed.data)
    if ('error' in result) {
        return mapTestServiceError(result)
    }

    return NextResponse.json(result)
}

// DELETE /api/admin/tests/[id]/questions/[qId] — delete a draft question
async function deleteHandler(
    _req: NextRequest,
    ctx: { userId: string; role: Role; params?: Record<string, string> }
) {
    const testId = ctx.params?.id
    const questionId = ctx.params?.qId
    if (!testId || !questionId) {
        return missingRouteParam('Test ID and question ID are required')
    }

    const result = await deleteAdminQuestion(ctx.userId, testId, questionId)
    if ('error' in result) {
        return mapTestServiceError(result)
    }

    return NextResponse.json(result)
}

export const PATCH = withAuth(patchHandler, ['ADMIN'])
export const DELETE = withAuth(deleteHandler, ['ADMIN'])
