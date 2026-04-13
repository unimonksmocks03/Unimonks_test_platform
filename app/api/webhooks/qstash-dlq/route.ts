import { NextRequest, NextResponse } from 'next/server'
import { Receiver } from '@upstash/qstash'
import { getQStashEnv } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const qstashEnv = getQStashEnv()

const receiver = qstashEnv.mode === 'local'
    ? null
    : new Receiver({
        currentSigningKey: qstashEnv.currentSigningKey,
        nextSigningKey: qstashEnv.nextSigningKey,
    })

/**
 * POST /api/webhooks/qstash-dlq
 *
 * Dead Letter Queue handler — called by QStash when a job permanently fails
 * (after all retries are exhausted).
 *
 * Logs the failure to AuditLog for observability and alerting.
 * Always returns 200 so QStash doesn't retry the DLQ callback itself.
 */
export async function POST(req: NextRequest) {
    // 1. Verify QStash signature (skip in local dev)
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

    // 2. Parse the failure payload
    const messageId = req.headers.get('upstash-message-id') || 'unknown'
    const targetUrl = req.headers.get('upstash-target-url') || 'unknown'
    const retryCount = req.headers.get('upstash-retried') || '0'

    let payload: Record<string, unknown> = {}
    try {
        payload = JSON.parse(body)
    } catch {
        // Body may not be valid JSON
    }

    const reqLogger = logger.child({ webhook: 'qstash-dlq', messageId, targetUrl, retryCount, payload })
    reqLogger.error('Job permanently failed')

    // 3. Try to resolve a userId from the payload for AuditLog.
    //    QStash failure callbacks forward the original request body,
    //    so we can extract sessionId and look up the student.
    try {
        let userId: string | null = null

        const sessionId = payload.sessionId as string | undefined
        if (sessionId) {
            const session = await prisma.testSession.findUnique({
                where: { id: sessionId },
                select: { studentId: true },
            })
            userId = session?.studentId ?? null
        }

        const jobId = payload.jobId as string | undefined
        if (!userId && jobId) {
            const job = await prisma.documentImportJob.findUnique({
                where: { id: jobId },
                select: { adminId: true },
            })
            userId = job?.adminId ?? null
        }

        if (userId) {
            await prisma.auditLog.create({
                data: {
                    userId,
                    action: 'QSTASH_DLQ',
                    metadata: JSON.parse(JSON.stringify({
                        messageId,
                        targetUrl,
                        retryCount: parseInt(retryCount, 10),
                        payload,
                        failedAt: new Date().toISOString(),
                    })),
                },
            })
            reqLogger.info({ userId }, 'Logged to AuditLog')
        } else {
            // No user context — logged to console only (Vercel Logs)
            reqLogger.warn('Could not resolve userId — logged to console only')
        }
    } catch (err) {
        // Don't let DB errors cause the DLQ handler to fail
        reqLogger.error({ err }, 'Failed to write AuditLog')
    }

    // Always return 200 — DLQ handlers should never trigger retries
    return NextResponse.json({ logged: true, messageId })
}
