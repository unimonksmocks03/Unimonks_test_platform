import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

import { withAuth } from '@/lib/middleware/auth-guard'
import {
    createDocumentImportJob,
    markDocumentImportJobQueueFailed,
} from '@/lib/services/import-job-service'
import { enqueueDocumentImportJob } from '@/lib/queue/qstash'
import { Role } from '@prisma/client'

export const maxDuration = 300

function mapImportJobError(
    error:
        | { error: true; code: 'BAD_REQUEST'; message: string }
        | { error: true; code: 'FORBIDDEN' | 'INACTIVE_ADMIN'; message: string }
        | { error: true; code: 'NOT_FOUND' | 'QUEUE_FAILED'; message: string }
) {
    const status = (() => {
        switch (error.code) {
            case 'FORBIDDEN':
            case 'INACTIVE_ADMIN':
                return 403
            case 'NOT_FOUND':
                return 404
            case 'QUEUE_FAILED':
                return 503
            case 'BAD_REQUEST':
            default:
                return 400
        }
    })()

    return NextResponse.json(error, { status })
}

// POST /api/admin/tests/generate-from-doc — enqueue a document import job
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

    const result = await createDocumentImportJob({
        adminId: ctx.userId,
        file: fileEntry,
        title: typeof titleEntry === 'string' ? titleEntry : undefined,
        requestedCount,
    })

    if ('error' in result) {
        return mapImportJobError(result)
    }

    try {
        await enqueueDocumentImportJob(result.job.id)
    } catch (error) {
        console.error('[AI][ADMIN] Failed to enqueue document import job:', error)
        await markDocumentImportJobQueueFailed(
            result.job.id,
            'Could not queue the import job. Please try again.',
        )

        return NextResponse.json(
            {
                error: true,
                code: 'QUEUE_FAILED',
                message: 'Could not queue the import job. Please try again.',
            },
            { status: 503 },
        )
    }

    return NextResponse.json(result, { status: 202 })
}

export const POST = withAuth(postHandler, ['ADMIN'])
