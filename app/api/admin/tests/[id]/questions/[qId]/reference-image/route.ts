import { NextRequest, NextResponse } from 'next/server'

import { withAuth } from '@/lib/middleware/auth-guard'
import { upsertAdminQuestionReferenceImage } from '@/lib/services/test-service'
import {
    mapTestServiceError,
    missingRouteParam,
} from '@/app/api/admin/tests/_lib/route-helpers'
import { Role } from '@prisma/client'

export const dynamic = 'force-dynamic'

async function postHandler(
    req: NextRequest,
    ctx: { userId: string; role: Role; params?: Record<string, string> },
) {
    const testId = ctx.params?.id
    const questionId = ctx.params?.qId
    if (!testId || !questionId) {
        return missingRouteParam('Test ID and question ID are required')
    }

    const formData = await req.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
        return NextResponse.json(
            {
                error: true,
                code: 'BAD_REQUEST',
                message: 'Reference image file is required.',
            },
            { status: 400 },
        )
    }

    const result = await upsertAdminQuestionReferenceImage(ctx.userId, testId, questionId, file)
    if ('error' in result) {
        return mapTestServiceError(result)
    }

    return NextResponse.json(result)
}

export const POST = withAuth(postHandler, ['ADMIN'])
