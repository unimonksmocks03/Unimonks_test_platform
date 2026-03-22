import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

import { z } from 'zod'

import { withAuth } from '@/lib/middleware/auth-guard'
import { listAdminLeads } from '@/lib/services/lead-admin-service'

const LeadQuerySchema = z.object({
    search: z.string().optional(),
    reviewed: z.enum(['all', 'reviewed', 'unreviewed']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
})

async function getHandler(req: NextRequest) {
    const url = new URL(req.url)
    const parsed = LeadQuerySchema.safeParse({
        search: url.searchParams.get('search') || undefined,
        reviewed: url.searchParams.get('reviewed') || undefined,
        page: url.searchParams.get('page') || undefined,
        limit: url.searchParams.get('limit') || undefined,
    })

    if (!parsed.success) {
        return NextResponse.json(
            { error: true, code: 'VALIDATION_ERROR', message: 'Invalid query params', details: parsed.error.issues },
            { status: 400 },
        )
    }

    const result = await listAdminLeads(parsed.data)
    return NextResponse.json(result)
}

export const GET = withAuth(getHandler, ['ADMIN'])
