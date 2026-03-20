import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

import { z } from 'zod'

import { withAuth } from '@/lib/middleware/auth-guard'
import { updateLeadReviewState } from '@/lib/services/lead-admin-service'
import { Role } from '@prisma/client'

const UpdateLeadReviewSchema = z.object({
    isReviewed: z.boolean(),
})

async function patchHandler(
    req: NextRequest,
    ctx: { userId: string; role: Role; params?: Record<string, string> },
) {
    const leadId = ctx.params?.id

    if (!leadId) {
        return NextResponse.json(
            { error: true, code: 'BAD_REQUEST', message: 'Lead ID required' },
            { status: 400 },
        )
    }

    let body: unknown

    try {
        body = await req.json()
    } catch {
        return NextResponse.json(
            { error: true, code: 'BAD_REQUEST', message: 'Invalid JSON body' },
            { status: 400 },
        )
    }

    const parsed = UpdateLeadReviewSchema.safeParse(body)

    if (!parsed.success) {
        return NextResponse.json(
            { error: true, code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.issues },
            { status: 400 },
        )
    }

    const result = await updateLeadReviewState({
        adminId: ctx.userId,
        leadId,
        isReviewed: parsed.data.isReviewed,
        ipAddress: req.headers.get('x-forwarded-for'),
    })

    if ('error' in result) {
        return NextResponse.json(result, { status: 404 })
    }

    return NextResponse.json(result)
}

export const PATCH = withAuth(patchHandler, ['ADMIN'])
