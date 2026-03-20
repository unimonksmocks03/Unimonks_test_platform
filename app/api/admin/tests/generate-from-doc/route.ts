import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

import { withAuth } from '@/lib/middleware/auth-guard'
import { generateAdminTestFromDocument } from '@/lib/services/test-service'
import { mapTestServiceError } from '@/app/api/admin/tests/_lib/route-helpers'
import { Role } from '@prisma/client'

export const maxDuration = 60

// POST /api/admin/tests/generate-from-doc — import a document into a draft test
async function postHandler(
    req: NextRequest,
    ctx: { userId: string; role: Role }
) {
    let formData: FormData

    try {
        formData = await req.formData()
    } catch {
        return NextResponse.json(
            { error: true, code: 'BAD_REQUEST', message: 'Invalid form data' },
            { status: 400 },
        )
    }

    const fileEntry = formData.get('file')
    if (!(fileEntry instanceof File)) {
        return NextResponse.json(
            { error: true, code: 'BAD_REQUEST', message: 'No file provided' },
            { status: 400 },
        )
    }

    const titleEntry = formData.get('title')
    const countEntry = formData.get('count')
    const requestedCount = typeof countEntry === 'string' && countEntry.trim()
        ? Number.parseInt(countEntry, 10)
        : undefined

    const result = await generateAdminTestFromDocument({
        adminId: ctx.userId,
        file: fileEntry,
        title: typeof titleEntry === 'string' ? titleEntry : undefined,
        requestedCount,
        ipAddress: req.headers.get('x-forwarded-for'),
    })

    if ('error' in result) {
        return mapTestServiceError(result)
    }

    return NextResponse.json(result, { status: 201 })
}

export const POST = withAuth(postHandler, ['ADMIN'])
