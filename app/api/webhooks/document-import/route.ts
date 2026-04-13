import { NextRequest, NextResponse } from 'next/server'
import { Receiver } from '@upstash/qstash'

import { getQStashEnv } from '@/lib/env'
import { processDocumentImportJob } from '@/lib/services/import-job-service'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const qstashEnv = getQStashEnv()

const receiver = qstashEnv.mode === 'local'
    ? null
    : new Receiver({
        currentSigningKey: qstashEnv.currentSigningKey,
        nextSigningKey: qstashEnv.nextSigningKey,
    })

export async function POST(req: NextRequest) {
    const body = await req.text()

    if (receiver) {
        const signature = req.headers.get('upstash-signature')
        if (!signature) {
            return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
        }

        const isValid = await receiver.verify({ body, signature }).catch(() => false)
        if (!isValid) {
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
        }
    }

    let parsed: { jobId?: string } = {}
    try {
        parsed = JSON.parse(body) as { jobId?: string }
    } catch {
        return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 200 })
    }

    if (!parsed.jobId) {
        return NextResponse.json({ error: 'jobId required' }, { status: 200 })
    }

    try {
        const outcome = await processDocumentImportJob(parsed.jobId)
        return NextResponse.json({
            ok: true,
            outcome: outcome.kind,
            status: outcome.job.status,
            jobId: outcome.job.id,
            reason: outcome.kind === 'noop' ? outcome.reason : undefined,
        })
    } catch (error) {
        console.error('[DOCUMENT-IMPORT] Worker failed before job state could be finalized:', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
