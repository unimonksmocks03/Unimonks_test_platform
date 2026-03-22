import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

import { withAuth } from '@/lib/middleware/auth-guard'
import { assignAdminTest } from '@/lib/services/test-service'
import { AssignTestSchema } from '@/lib/validations/test.schema'
import {
    invalidJsonBody,
    mapTestServiceError,
    missingRouteParam,
    validationError,
} from '@/app/api/admin/tests/_lib/route-helpers'
import { Role } from '@prisma/client'

// POST /api/admin/tests/[id]/assign — replace draft batch assignments
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

    const parsed = AssignTestSchema.safeParse(body)
    if (!parsed.success) {
        return validationError('Invalid input', parsed.error)
    }

    const result = await assignAdminTest(ctx.userId, testId, parsed.data)
    if ('error' in result) {
        return mapTestServiceError(result)
    }

    return NextResponse.json(result, { status: 201 })
}

export const POST = withAuth(postHandler, ['ADMIN'])
