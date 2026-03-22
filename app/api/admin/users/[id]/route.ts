import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
import { withAuth } from '@/lib/middleware/auth-guard'
import { UpdateUserSchema } from '@/lib/validations/user.schema'
import { updateUser, deleteUser } from '@/lib/services/user-service'
import { prisma } from '@/lib/prisma'
import { Role } from '@prisma/client'

// PATCH /api/admin/users/[id] — update a user
async function patchHandler(
    req: NextRequest,
    ctx: { userId: string; role: Role; params?: Record<string, string> }
) {
    const id = ctx.params?.id
    if (!id) {
        return NextResponse.json({ error: true, code: 'BAD_REQUEST', message: 'User ID is required' }, { status: 400 })
    }

    const body = await req.json()
    const parsed = UpdateUserSchema.safeParse(body)

    if (!parsed.success) {
        return NextResponse.json(
            { error: true, code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.issues },
            { status: 400 }
        )
    }

    const result = await updateUser(ctx.role, id, parsed.data)

    if ('error' in result) {
        const statusCode =
            result.code === 'NOT_FOUND'
                ? 404
                : result.code === 'DUPLICATE_EMAIL'
                    ? 409
                    : result.code === 'OWNER_ADMIN_REQUIRED'
                        ? 403
                        : 400
        return NextResponse.json(result, { status: statusCode })
    }

    return NextResponse.json(result)
}

// DELETE /api/admin/users/[id] — soft delete a user
async function deleteHandler(
    req: NextRequest,
    ctx: { userId: string; role: Role; params?: Record<string, string> }
) {
    const id = ctx.params?.id
    if (!id) {
        return NextResponse.json({ error: true, code: 'BAD_REQUEST', message: 'User ID is required' }, { status: 400 })
    }

    const result = await deleteUser(ctx.role, id)

    if ('error' in result) {
        const statusCode =
            result.code === 'NOT_FOUND'
                ? 404
                : result.code === 'OWNER_ADMIN_REQUIRED'
                    ? 403
                    : 400
        return NextResponse.json(result, { status: statusCode })
    }

    // Audit log
    await prisma.auditLog.create({
        data: {
            userId: ctx.userId,
            action: 'USER_DELETED',
            metadata: { deletedUserId: id },
            ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
        },
    })

    return NextResponse.json(result)
}

export const PATCH = withAuth(patchHandler, ['ADMIN'])

export const DELETE = withAuth(deleteHandler, ['ADMIN'])
