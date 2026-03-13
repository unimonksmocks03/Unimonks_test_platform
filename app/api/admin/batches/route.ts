import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
import { withAuth } from '@/lib/middleware/auth-guard'
import { BatchQuerySchema, CreateBatchSchema } from '@/lib/validations/batch.schema'
import { listBatches, createBatch } from '@/lib/services/batch-service'
import { prisma } from '@/lib/prisma'
import { Role } from '@prisma/client'

// GET /api/admin/batches — list batches
async function getHandler(req: NextRequest) {
    const url = new URL(req.url)
    const parsed = BatchQuerySchema.safeParse({
        search: url.searchParams.get('search') || undefined,
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

    const result = await listBatches(parsed.data)
    return NextResponse.json(result)
}

// POST /api/admin/batches — create batch
async function postHandler(req: NextRequest, ctx: { userId: string; role: Role }) {
    const body = await req.json()
    const parsed = CreateBatchSchema.safeParse(body)

    if (!parsed.success) {
        return NextResponse.json(
            { error: true, code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.issues },
            { status: 400 }
        )
    }

    const result = await createBatch(parsed.data)

    if ('error' in result) {
        const statusCode = result.code === 'DUPLICATE_CODE' ? 409 : result.code === 'INVALID_TEACHER' ? 400 : 400
        return NextResponse.json(result, { status: statusCode })
    }

    await prisma.auditLog.create({
        data: {
            userId: ctx.userId,
            action: 'BATCH_CREATED',
            metadata: { batchId: result.batch.id, code: result.batch.code },
            ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
        },
    })

    return NextResponse.json(result, { status: 201 })
}

export const GET = withAuth(getHandler, ['ADMIN'])
export const POST = withAuth(postHandler, ['ADMIN'])
