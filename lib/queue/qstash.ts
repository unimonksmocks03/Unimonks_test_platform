import { Client } from '@upstash/qstash'
import { getAppEnv, getQStashEnv } from '@/lib/env'

/**
 * Upstash QStash Client — serverless-friendly job queue.
 *
 * Instead of a persistent worker process, QStash sends HTTP POST
 * requests to our webhook endpoints. Works perfectly with Vercel serverless.
 *
 * Supports two modes:
 *
 * 1. LOCAL DEV — run `npx @upstash/qstash-cli@latest dev` on port 8080
 *    Set QSTASH_URL=http://localhost:8080 in .env
 *    No real token or signing keys needed.
 *
 * 2. PRODUCTION — use Upstash cloud
 *    Set QSTASH_TOKEN, QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY
 */

const qstashEnv = getQStashEnv()

const qstashClient = new Client({
    ...(qstashEnv.mode === 'local'
        ? { baseUrl: qstashEnv.baseUrl, token: 'dev' }
        : {
            token: qstashEnv.token,
            ...(qstashEnv.baseUrl ? { baseUrl: qstashEnv.baseUrl } : {}),
        }
    ),
})

function getBaseUrl(): string {
    return getAppEnv().NEXT_PUBLIC_APP_URL
}

function toSafeDeduplicationId(prefix: string, id: string): string {
    const normalizedId = id.replace(/[^a-zA-Z0-9_-]/g, '-')
    return `${prefix}-${normalizedId}`
}

/**
 * Enqueue an AI feedback generation job.
 *
 * - Dedup ID prevents double-enqueue if student clicks submit twice
 * - Failure callback routes dead letters to DLQ endpoint for alerting
 * - QStash retries 3× with exponential backoff on 5xx responses
 */
export async function enqueueAIFeedback(sessionId: string) {
    const baseUrl = getBaseUrl()
    return qstashClient.publishJSON({
        url: `${baseUrl}/api/webhooks/ai-feedback`,
        body: { sessionId },
        retries: 3,
        deduplicationId: toSafeDeduplicationId('ai-feedback', sessionId),
        failureCallback: `${baseUrl}/api/webhooks/qstash-dlq`,
    })
}

/**
 * Enqueue a force-submit job for an expired session.
 *
 * - Dedup ID prevents double force-submit for the same session
 * - Failure callback routes dead letters to DLQ endpoint
 */
export async function enqueueForceSubmit(sessionId: string, studentId: string, notBefore?: number) {
    const baseUrl = getBaseUrl()
    return qstashClient.publishJSON({
        url: `${baseUrl}/api/webhooks/force-submit`,
        body: { sessionId, studentId },
        retries: 3,
        ...(notBefore ? { notBefore } : {}),
        deduplicationId: toSafeDeduplicationId('force-submit', sessionId),
        failureCallback: `${baseUrl}/api/webhooks/qstash-dlq`,
    })
}

/**
 * Enqueue a document import job for background processing.
 *
 * The worker uses the jobId to load the file bytes from the database, so the
 * QStash payload stays small and deterministic.
 */
export async function enqueueDocumentImportJob(jobId: string) {
    const baseUrl = getBaseUrl()
    return qstashClient.publishJSON({
        url: `${baseUrl}/api/webhooks/document-import`,
        body: { jobId },
        retries: 3,
        deduplicationId: toSafeDeduplicationId('document-import', jobId),
        failureCallback: `${baseUrl}/api/webhooks/qstash-dlq`,
    })
}

export { qstashClient, toSafeDeduplicationId }
