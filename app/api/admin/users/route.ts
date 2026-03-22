import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
import { withAuth } from '@/lib/middleware/auth-guard'
import { UserQuerySchema, CreateUserSchema } from '@/lib/validations/user.schema'
import { listUsers, createUser } from '@/lib/services/user-service'
import { prisma } from '@/lib/prisma'
import { Role } from '@prisma/client'

// GET /api/admin/users — paginated user list with search + filters
async function getHandler(req: NextRequest) {
    const url = new URL(req.url)
    const parsed = UserQuerySchema.safeParse({
        search: url.searchParams.get('search') || undefined,
        role: url.searchParams.get('role') || undefined,
        status: url.searchParams.get('status') || undefined,
        page: url.searchParams.get('page') || undefined,
        limit: url.searchParams.get('limit') || undefined,
    })

    if (!parsed.success) {
        return NextResponse.json(
            { error: true, code: 'VALIDATION_ERROR', message: 'Invalid query params', details: parsed.error.issues },
            { status: 400 }
        )
    }

    const result = await listUsers(parsed.data)
    return NextResponse.json(result)
}

// POST /api/admin/users — create a new user
async function postHandler(req: NextRequest, ctx: { userId: string; role: Role }) {
    const body = await req.json()
    const parsed = CreateUserSchema.safeParse(body)

    if (!parsed.success) {
        return NextResponse.json(
            { error: true, code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.issues },
            { status: 400 }
        )
    }

    const result = await createUser(ctx.role, parsed.data)

    if ('error' in result) {
        const statusCode =
            result.code === 'DUPLICATE_EMAIL'
                ? 409
                : result.code === 'OWNER_ADMIN_REQUIRED'
                    ? 403
                    : 400
        return NextResponse.json(result, { status: statusCode })
    }

    // Audit log
    await prisma.auditLog.create({
        data: {
            userId: ctx.userId,
            action: 'USER_CREATED',
            metadata: { createdUserId: result.user.id, role: result.user.role },
            ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
        },
    })

    return NextResponse.json(result, { status: 201 })
}

export const GET = withAuth(getHandler, ['ADMIN'])

export const POST = withAuth(postHandler, ['ADMIN'])
