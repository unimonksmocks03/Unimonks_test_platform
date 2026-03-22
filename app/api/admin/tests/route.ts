import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

import { withAuth } from '@/lib/middleware/auth-guard'
import { createAdminTest, listAdminTests } from '@/lib/services/test-service'
import { CreateTestSchema, TestQuerySchema } from '@/lib/validations/test.schema'
import { invalidJsonBody, mapTestServiceError, validationError } from '@/app/api/admin/tests/_lib/route-helpers'
import { Role } from '@prisma/client'

// GET /api/admin/tests — list tests for admin management
async function getHandler(req: NextRequest) {
    const url = new URL(req.url)
    const parsed = TestQuerySchema.safeParse({
        search: url.searchParams.get('search') || undefined,
        status: url.searchParams.get('status') || undefined,
        page: url.searchParams.get('page') || undefined,
        limit: url.searchParams.get('limit') || undefined,
    })

    if (!parsed.success) {
        return validationError('Invalid query params', parsed.error)
    }

    const result = await listAdminTests(parsed.data)
    return NextResponse.json(result)
}

// POST /api/admin/tests — create draft test
async function postHandler(req: NextRequest, ctx: { userId: string; role: Role }) {
    let body: unknown

    try {
        body = await req.json()
    } catch {
        return invalidJsonBody()
    }

    const parsed = CreateTestSchema.safeParse(body)
    if (!parsed.success) {
        return validationError('Invalid input', parsed.error)
    }

    const result = await createAdminTest(ctx.userId, parsed.data)
    if ('error' in result) {
        return mapTestServiceError(result)
    }

    return NextResponse.json(result, { status: 201 })
}

export const GET = withAuth(getHandler, ['ADMIN'])
export const POST = withAuth(postHandler, ['ADMIN'])
