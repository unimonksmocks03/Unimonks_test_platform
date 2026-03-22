import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

import { withAuth } from '@/lib/middleware/auth-guard'
import { deleteAdminTest, getAdminTest, updateAdminTest } from '@/lib/services/test-service'
import { UpdateTestSchema } from '@/lib/validations/test.schema'
import {
    invalidJsonBody,
    mapTestServiceError,
    missingRouteParam,
    validationError,
} from '@/app/api/admin/tests/_lib/route-helpers'
import { Role } from '@prisma/client'

// GET /api/admin/tests/[id] — fetch one test for the admin builder
async function getHandler(
    _req: NextRequest,
    ctx: { userId: string; role: Role; params?: Record<string, string> }
) {
    const id = ctx.params?.id
    if (!id) {
        return missingRouteParam('Test ID required')
    }

    const result = await getAdminTest(id)
    if ('error' in result) {
        return mapTestServiceError(result)
    }

    return NextResponse.json(result)
}

// PATCH /api/admin/tests/[id] — update a draft or publish/archive a test
async function patchHandler(
    req: NextRequest,
    ctx: { userId: string; role: Role; params?: Record<string, string> }
) {
    const id = ctx.params?.id
    if (!id) {
        return missingRouteParam('Test ID required')
    }

    let body: unknown

    try {
        body = await req.json()
    } catch {
        return invalidJsonBody()
    }

    const parsed = UpdateTestSchema.safeParse(body)
    if (!parsed.success) {
        return validationError('Invalid input', parsed.error)
    }

    const result = await updateAdminTest(ctx.userId, id, parsed.data)
    if ('error' in result) {
        return mapTestServiceError(result)
    }

    return NextResponse.json(result)
}

// DELETE /api/admin/tests/[id] — explicit hard delete for admin
async function deleteHandler(
    _req: NextRequest,
    ctx: { userId: string; role: Role; params?: Record<string, string> }
) {
    const id = ctx.params?.id
    if (!id) {
        return missingRouteParam('Test ID required')
    }

    const result = await deleteAdminTest(ctx.userId, id)
    if ('error' in result) {
        return mapTestServiceError(result)
    }

    return NextResponse.json(result)
}

export const GET = withAuth(getHandler, ['ADMIN'])
export const PATCH = withAuth(patchHandler, ['ADMIN'])
export const DELETE = withAuth(deleteHandler, ['ADMIN'])
