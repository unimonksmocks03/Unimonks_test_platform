import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
import { withAuth } from '@/lib/middleware/auth-guard'
import { UpdateTestSchema } from '@/lib/validations/test.schema'
import { getTest, updateTest, deleteTest } from '@/lib/services/test-service'
import { Role } from '@prisma/client'

// GET /api/teacher/tests/[id] — single test
async function getHandler(
    req: NextRequest,
    ctx: { userId: string; role: Role; params?: Record<string, string> }
) {
    const id = ctx.params?.id
    if (!id) return NextResponse.json({ error: true, code: 'BAD_REQUEST', message: 'Test ID required' }, { status: 400 })

    const result = await getTest(ctx.userId, id)
    if ('error' in result) {
        const statusCode = result.code === 'FORBIDDEN' ? 403 : 404
        return NextResponse.json(result, { status: statusCode })
    }
    return NextResponse.json(result)
}

// PATCH /api/teacher/tests/[id] — update test
async function patchHandler(
    req: NextRequest,
    ctx: { userId: string; role: Role; params?: Record<string, string> }
) {
    const id = ctx.params?.id
    if (!id) return NextResponse.json({ error: true, code: 'BAD_REQUEST', message: 'Test ID required' }, { status: 400 })

    const body = await req.json()
    const parsed = UpdateTestSchema.safeParse(body)
    if (!parsed.success) {
        return NextResponse.json(
            { error: true, code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.issues },
            { status: 400 }
        )
    }

    const result = await updateTest(ctx.userId, id, parsed.data)
    if ('error' in result) {
        const statusCode = result.code === 'FORBIDDEN' ? 403 : result.code === 'NOT_FOUND' ? 404 : 400
        return NextResponse.json(result, { status: statusCode })
    }
    return NextResponse.json(result)
}

// DELETE /api/teacher/tests/[id] — delete draft or finished published test
async function deleteHandler(
    req: NextRequest,
    ctx: { userId: string; role: Role; params?: Record<string, string> }
) {
    const id = ctx.params?.id
    if (!id) return NextResponse.json({ error: true, code: 'BAD_REQUEST', message: 'Test ID required' }, { status: 400 })

    const result = await deleteTest(ctx.userId, id)
    if ('error' in result) {
        const statusCode =
            result.code === 'FORBIDDEN'
                ? 403
                : result.code === 'NOT_FOUND'
                    ? 404
                    : result.code === 'WINDOW_OPEN' || result.code === 'ACTIVE_SESSIONS'
                        ? 409
                        : 400
        return NextResponse.json(result, { status: statusCode })
    }
    return NextResponse.json(result)
}

export const GET = withAuth(getHandler, ['TEACHER'])
export const PATCH = withAuth(patchHandler, ['TEACHER'])
export const DELETE = withAuth(deleteHandler, ['TEACHER'])
