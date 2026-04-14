import { Prisma, Role, UserStatus } from '@prisma/client'
import type {
    DocumentImportDecision,
    DocumentImportJobStage,
    DocumentImportJobStatus,
    DocumentImportLane,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { enqueueDocumentImportReferenceEnrichment } from '@/lib/queue/qstash'
import {
    enrichImportedTestReferencesAfterDraft,
    generateAdminTestFromDocument,
} from '@/lib/services/test-service'

type ImportJobServiceErrorCode =
    | 'BAD_REQUEST'
    | 'FORBIDDEN'
    | 'INACTIVE_ADMIN'
    | 'NOT_FOUND'
    | 'QUEUE_FAILED'

export type ImportJobServiceError = {
    error: true
    code: ImportJobServiceErrorCode
    message: string
    details?: Record<string, unknown>
}

export type DocumentImportJobSummary = {
    id: string
    status: DocumentImportJobStatus
    stage: DocumentImportJobStage
    stageStartedAt: Date | null
    currentStageElapsedMs: number | null
    lane: DocumentImportLane | null
    routingMode: string | null
    selectedStrategy: string | null
    resultStrategy: string | null
    decision: DocumentImportDecision | null
    tokenCostUsd: number | null
    totalElapsedMs: number | null
    fileName: string
    message: string | null
    progressMessage: string | null
    errorCode: string | null
    errorMessage: string | null
    testId: string | null
    result: Prisma.JsonValue | null
    createdAt: Date
    updatedAt: Date
    startedAt: Date | null
    lastHeartbeatAt: Date | null
    completedAt: Date | null
}

const DOCUMENT_IMPORT_JOB_STATUS = {
    QUEUED: 'QUEUED',
    PROCESSING: 'PROCESSING',
    SUCCEEDED: 'SUCCEEDED',
    FAILED: 'FAILED',
} as const satisfies Record<DocumentImportJobStatus, DocumentImportJobStatus>

const DOCUMENT_IMPORT_JOB_STAGE = {
    QUEUED: 'QUEUED',
    PROCESSING_CLASSIFICATION: 'PROCESSING_CLASSIFICATION',
    PROCESSING_EXACT: 'PROCESSING_EXACT',
    CREATING_DRAFT: 'CREATING_DRAFT',
    ENRICHING_REFERENCES: 'ENRICHING_REFERENCES',
    VERIFYING: 'VERIFYING',
    SUCCEEDED: 'SUCCEEDED',
    FAILED: 'FAILED',
} as const satisfies Record<DocumentImportJobStage, DocumentImportJobStage>

const DOCUMENT_IMPORT_JOB_SUMMARY_SELECT = {
    id: true,
    status: true,
    stage: true,
    stageStartedAt: true,
    lane: true,
    routingMode: true,
    selectedStrategy: true,
    resultStrategy: true,
    decision: true,
    tokenCostUsd: true,
    totalElapsedMs: true,
    fileName: true,
    message: true,
    progressMessage: true,
    errorCode: true,
    errorMessage: true,
    testId: true,
    result: true,
    createdAt: true,
    updatedAt: true,
    startedAt: true,
    lastHeartbeatAt: true,
    completedAt: true,
} as const satisfies Prisma.DocumentImportJobSelect

const DOCUMENT_IMPORT_JOB_TIMEOUT_MS = 210_000
const STALE_PROCESSING_JOB_TIMEOUT_MS = DOCUMENT_IMPORT_JOB_TIMEOUT_MS + 60_000

class DocumentImportJobTimeoutError extends Error {
    constructor(message = 'Document import timed out before completion.') {
        super(message)
        this.name = 'DocumentImportJobTimeoutError'
    }
}

export type CreateDocumentImportJobInput = {
    adminId: string
    file: File
    title?: string | null
    requestedCount?: number | null
}

type ProcessDocumentImportJobResult =
    | { kind: 'noop'; job: DocumentImportJobSummary; reason: string }
    | { kind: 'failed'; job: DocumentImportJobSummary }
    | { kind: 'succeeded'; job: DocumentImportJobSummary }

type DocumentImportJobPhase = 'PRIMARY' | 'REFERENCE_ENRICHMENT'

function serviceError(
    code: ImportJobServiceErrorCode,
    message: string,
    details?: Record<string, unknown>,
): ImportJobServiceError {
    return {
        error: true,
        code,
        message,
        details,
    }
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue
}

function isStaleProcessingJob(startedAt: Date | null | undefined, now = Date.now()) {
    if (!startedAt) {
        return false
    }

    return now - startedAt.getTime() >= STALE_PROCESSING_JOB_TIMEOUT_MS
}

function isPdfImportJob(job: { fileName: string; mimeType: string | null }) {
    return job.mimeType === 'application/pdf' || job.fileName.toLowerCase().endsWith('.pdf')
}

function toElapsedMs(startedAt: Date | null | undefined, completedAt = new Date()) {
    if (!startedAt) {
        return null
    }

    return Math.max(0, completedAt.getTime() - startedAt.getTime())
}

type DocumentImportJobLogLevel = 'info' | 'warn' | 'error'

function logDocumentImportJob(
    level: DocumentImportJobLogLevel,
    event: string,
    fields: Record<string, unknown>,
) {
    const payload = Object.entries(fields)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value)}`)
        .join(' ')
    const message = `[DOCUMENT-IMPORT] ${event}${payload ? ` ${payload}` : ''}`

    if (level === 'error') {
        console.error(message)
        return
    }

    if (level === 'warn') {
        console.warn(message)
        return
    }

    console.info(message)
}

type UpdateDocumentImportJobStageInput = {
    jobId: string
    status?: DocumentImportJobStatus
    stage: DocumentImportJobStage
    message: string
    progressMessage?: string | null
    lane?: DocumentImportLane | null
    routingMode?: string | null
    selectedStrategy?: string | null
    resultStrategy?: string | null
    decision?: DocumentImportDecision | null
    tokenCostUsd?: number | null
    testId?: string | null
    result?: unknown
    errorCode?: string | null
    errorMessage?: string | null
    clearFileData?: boolean
    completedAt?: Date | null
    startedAt?: Date | null
}

async function updateDocumentImportJobStage(input: UpdateDocumentImportJobStageInput) {
    const now = new Date()
    const existing = await prisma.documentImportJob.findUnique({
        where: { id: input.jobId },
        select: {
            id: true,
            startedAt: true,
        },
    })

    const startedAt = input.startedAt ?? existing?.startedAt ?? now
    const completedAt = input.completedAt ?? null
    const totalElapsedMs = completedAt ? toElapsedMs(startedAt, completedAt) : toElapsedMs(startedAt, now)

    const updated = await prisma.documentImportJob.update({
        where: { id: input.jobId },
        data: {
            status: input.status,
            stage: input.stage,
            stageStartedAt: now,
            message: input.message,
            progressMessage: input.progressMessage ?? input.message,
            ...(input.lane === undefined ? {} : { lane: input.lane }),
            ...(input.routingMode === undefined ? {} : { routingMode: input.routingMode }),
            ...(input.selectedStrategy === undefined ? {} : { selectedStrategy: input.selectedStrategy }),
            ...(input.resultStrategy === undefined ? {} : { resultStrategy: input.resultStrategy }),
            ...(input.decision === undefined ? {} : { decision: input.decision }),
            ...(input.tokenCostUsd === undefined ? {} : { tokenCostUsd: input.tokenCostUsd }),
            ...(totalElapsedMs === null ? {} : { totalElapsedMs }),
            ...(input.testId === undefined ? {} : { testId: input.testId }),
            result: input.result === undefined
                ? undefined
                : input.result === Prisma.JsonNull
                    ? Prisma.JsonNull
                    : toInputJsonValue(input.result),
            ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
            ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
            startedAt,
            lastHeartbeatAt: now,
            completedAt,
            ...(input.clearFileData === undefined ? {} : { fileData: input.clearFileData ? null : undefined }),
        },
        select: DOCUMENT_IMPORT_JOB_SUMMARY_SELECT,
    })

    logDocumentImportJob(
        input.status === DOCUMENT_IMPORT_JOB_STATUS.FAILED ? 'error' : 'info',
        'stage-transition',
        {
            jobId: updated.id,
            status: updated.status,
            stage: updated.stage,
            lane: updated.lane,
            routingMode: updated.routingMode,
            selectedStrategy: updated.selectedStrategy,
            resultStrategy: updated.resultStrategy,
            decision: updated.decision,
            tokenCostUsd: updated.tokenCostUsd,
            totalElapsedMs: updated.totalElapsedMs,
            message: updated.message,
        },
    )

    return updated
}

async function updateDocumentImportJobFailure(
    jobId: string,
    input: {
        message: string
        errorCode: string
        errorMessage: string
        result?: unknown
        clearFileData?: boolean
    },
) {
    return updateDocumentImportJobStage({
        jobId,
        status: DOCUMENT_IMPORT_JOB_STATUS.FAILED,
        stage: DOCUMENT_IMPORT_JOB_STAGE.FAILED,
        message: input.message,
        progressMessage: input.message,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        result: input.result,
        completedAt: new Date(),
        clearFileData: input.clearFileData === false ? false : true,
    })
}

async function raceDocumentImportJobTimeout<T>(
    promise: Promise<T>,
    timeoutMs = DOCUMENT_IMPORT_JOB_TIMEOUT_MS,
) {
    let timedOut = false
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    promise.catch((error) => {
        if (timedOut) {
            console.warn('[DOCUMENT-IMPORT] Timed-out job promise rejected after timeout:', error)
        }
    })

    try {
        return await Promise.race<T>([
            promise,
            new Promise<T>((_, reject) => {
                timeoutHandle = setTimeout(() => {
                    timedOut = true
                    reject(new DocumentImportJobTimeoutError())
                }, timeoutMs)
            }),
        ])
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle)
        }
    }
}

async function ensureActiveAdmin(adminId: string) {
    const admin = await prisma.user.findUnique({
        where: { id: adminId },
        select: {
            id: true,
            role: true,
            status: true,
        },
    })

    if (!admin || (admin.role !== Role.ADMIN && admin.role !== Role.SUB_ADMIN)) {
        return serviceError('FORBIDDEN', 'Only admin operators can manage document imports.')
    }

    if (admin.status !== UserStatus.ACTIVE) {
        return serviceError('INACTIVE_ADMIN', 'Only active admin operators can manage document imports.')
    }

    return admin
}

function mapJob(job: {
    id: string
    status: DocumentImportJobStatus
    stage: DocumentImportJobStage
    stageStartedAt: Date | null
    lane: DocumentImportLane | null
    routingMode: string | null
    selectedStrategy: string | null
    resultStrategy: string | null
    decision: DocumentImportDecision | null
    tokenCostUsd: number | null
    totalElapsedMs: number | null
    fileName: string
    message: string | null
    progressMessage: string | null
    errorCode: string | null
    errorMessage: string | null
    testId: string | null
    result: Prisma.JsonValue | null
    createdAt: Date
    updatedAt: Date
    startedAt: Date | null
    lastHeartbeatAt: Date | null
    completedAt: Date | null
}): DocumentImportJobSummary {
    const now = Date.now()
    const currentStageElapsedMs = job.stageStartedAt
        ? Math.max(0, now - job.stageStartedAt.getTime())
        : null

    return {
        id: job.id,
        status: job.status,
        stage: job.stage,
        stageStartedAt: job.stageStartedAt,
        currentStageElapsedMs,
        lane: job.lane,
        routingMode: job.routingMode,
        selectedStrategy: job.selectedStrategy,
        resultStrategy: job.resultStrategy,
        decision: job.decision,
        tokenCostUsd: job.tokenCostUsd,
        totalElapsedMs: job.totalElapsedMs ?? (
            job.startedAt
                ? Math.max(0, (job.completedAt ?? new Date(now)).getTime() - job.startedAt.getTime())
                : currentStageElapsedMs
        ),
        fileName: job.fileName,
        message: job.message,
        progressMessage: job.progressMessage,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        testId: job.testId,
        result: job.result,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        startedAt: job.startedAt,
        lastHeartbeatAt: job.lastHeartbeatAt,
        completedAt: job.completedAt,
    }
}

export async function createDocumentImportJob(input: CreateDocumentImportJobInput) {
    const admin = await ensureActiveAdmin(input.adminId)
    if ('error' in admin) {
        return admin
    }

    const fileName = input.file.name?.trim()
    if (!fileName) {
        return serviceError('BAD_REQUEST', 'A file is required to create an import job.')
    }

    const fileData = Buffer.from(await input.file.arrayBuffer())
    const job = await prisma.documentImportJob.create({
        data: {
            adminId: admin.id,
            stage: DOCUMENT_IMPORT_JOB_STAGE.QUEUED,
            stageStartedAt: new Date(),
            fileName,
            mimeType: input.file.type || 'application/octet-stream',
            fileSize: input.file.size,
            fileData,
            requestedTitle: input.title?.trim() || null,
            requestedCount: input.requestedCount ?? null,
            message: 'Import queued. Processing will start shortly.',
            progressMessage: 'Import queued. Processing will start shortly.',
            lastHeartbeatAt: new Date(),
        },
        select: DOCUMENT_IMPORT_JOB_SUMMARY_SELECT,
    })

    logDocumentImportJob('info', 'job-created', {
        jobId: job.id,
        adminId: admin.id,
        fileName,
        mimeType: input.file.type || 'application/octet-stream',
        fileSize: input.file.size,
        requestedCount: input.requestedCount ?? null,
    })

    return { job: mapJob(job) }
}

export async function getDocumentImportJob(adminId: string, jobId: string) {
    const admin = await ensureActiveAdmin(adminId)
    if ('error' in admin) {
        return admin
    }

    const job = await prisma.documentImportJob.findUnique({
        where: { id: jobId },
        select: {
            ...DOCUMENT_IMPORT_JOB_SUMMARY_SELECT,
            adminId: true,
        },
    })

    if (!job) {
        return serviceError('NOT_FOUND', 'Import job not found.')
    }

    if (job.adminId !== admin.id && admin.role !== Role.ADMIN) {
        return serviceError('FORBIDDEN', 'You can only view your own import jobs.')
    }

    if (
        job.status === DOCUMENT_IMPORT_JOB_STATUS.PROCESSING
        && isStaleProcessingJob(job.startedAt)
    ) {
        logDocumentImportJob('warn', 'stale-job-reconciled', {
            jobId: job.id,
            status: job.status,
            stage: job.stage,
            startedAt: job.startedAt?.toISOString() ?? null,
        })
        const failed = await updateDocumentImportJobFailure(job.id, {
            message: 'Import timed out during background processing.',
            errorCode: 'TIMEOUT',
            errorMessage: 'The background import worker exceeded the allowed execution window.',
        })

        return {
            job: mapJob(failed),
        }
    }

    return {
        job: mapJob(job),
    }
}

export async function markDocumentImportJobQueueFailed(jobId: string, message: string) {
    const job = await updateDocumentImportJobFailure(jobId, {
        message,
        errorCode: 'QUEUE_FAILED',
        errorMessage: message,
    })

    return mapJob(job)
}

export async function markDocumentImportJobUnhandledFailure(jobId: string, error: unknown) {
    const message = error instanceof Error ? error.message : 'Unexpected import processing error.'
    const job = await updateDocumentImportJobFailure(jobId, {
        message: 'Import failed during background processing.',
        errorCode: error instanceof DocumentImportJobTimeoutError ? 'TIMEOUT' : 'GENERATION_FAILED',
        errorMessage: message,
    })

    return mapJob(job)
}

export async function processDocumentImportJob(
    jobId: string,
    phase: DocumentImportJobPhase = 'PRIMARY',
): Promise<ProcessDocumentImportJobResult> {
    const job = await prisma.documentImportJob.findUnique({
        where: { id: jobId },
        select: {
            ...DOCUMENT_IMPORT_JOB_SUMMARY_SELECT,
            adminId: true,
            mimeType: true,
            fileSize: true,
            fileData: true,
            requestedTitle: true,
            requestedCount: true,
        },
    })

    if (!job) {
        throw new Error(`Document import job ${jobId} not found`)
    }

    if (phase === 'PRIMARY' && (
        job.status === DOCUMENT_IMPORT_JOB_STATUS.SUCCEEDED
        || job.status === DOCUMENT_IMPORT_JOB_STATUS.FAILED
    )) {
        logDocumentImportJob('info', 'worker-noop', {
            jobId: job.id,
            phase,
            status: job.status,
            stage: job.stage,
            reason: `Job already ${job.status.toLowerCase()}.`,
        })
        return {
            kind: 'noop',
            job: mapJob(job),
            reason: `Job already ${job.status.toLowerCase()}.`,
        }
    }

    if (
        phase === 'REFERENCE_ENRICHMENT'
        && (
            job.status === DOCUMENT_IMPORT_JOB_STATUS.FAILED
            || job.stage !== DOCUMENT_IMPORT_JOB_STAGE.ENRICHING_REFERENCES
        )
    ) {
        logDocumentImportJob('info', 'worker-noop', {
            jobId: job.id,
            phase,
            status: job.status,
            stage: job.stage,
            reason: job.status === DOCUMENT_IMPORT_JOB_STATUS.FAILED
                ? 'Job already failed.'
                : 'Reference enrichment is not pending for this job.',
        })
        return {
            kind: 'noop',
            job: mapJob(job),
            reason: job.status === DOCUMENT_IMPORT_JOB_STATUS.FAILED
                ? 'Job already failed.'
                : 'Reference enrichment is not pending for this job.',
        }
    }

    if (!job.fileData) {
        if (phase === 'REFERENCE_ENRICHMENT') {
            const finalized = await prisma.documentImportJob.update({
                where: { id: job.id },
                data: {
                    stage: DOCUMENT_IMPORT_JOB_STAGE.SUCCEEDED,
                    message: 'Import completed successfully.',
                    progressMessage: 'Reference enrichment skipped because no source file bytes remained.',
                    errorCode: 'REFERENCE_SOURCE_MISSING',
                    errorMessage: 'Deferred reference enrichment could not run because the queued file bytes were unavailable.',
                    lastHeartbeatAt: new Date(),
                    completedAt: new Date(),
                },
                select: DOCUMENT_IMPORT_JOB_SUMMARY_SELECT,
            })

            return { kind: 'succeeded', job: mapJob(finalized) }
        }

        const failed = await updateDocumentImportJobFailure(job.id, {
            message: 'Import source file is no longer available for processing.',
            errorCode: 'BAD_REQUEST',
            errorMessage: 'Import source file is missing from the queued job.',
            clearFileData: false,
        })

        return { kind: 'failed', job: mapJob(failed) }
    }

    const file = new File([new Uint8Array(job.fileData)], job.fileName, {
        type: job.mimeType,
    })

    logDocumentImportJob('info', 'worker-start', {
        jobId: job.id,
        phase,
        status: job.status,
        stage: job.stage,
        fileName: job.fileName,
        mimeType: job.mimeType,
    })

    if (phase === 'REFERENCE_ENRICHMENT') {
        if (!job.testId) {
            const finalized = await updateDocumentImportJobStage({
                jobId: job.id,
                status: DOCUMENT_IMPORT_JOB_STATUS.SUCCEEDED,
                stage: DOCUMENT_IMPORT_JOB_STAGE.SUCCEEDED,
                message: 'Draft created. Reference enrichment completed with warnings.',
                progressMessage: 'Reference enrichment skipped because no draft test id was available.',
                errorCode: 'REFERENCE_TEST_MISSING',
                errorMessage: 'Deferred reference enrichment could not run because the draft test id was missing from the import job.',
                clearFileData: true,
                completedAt: new Date(),
            })

            return { kind: 'succeeded', job: mapJob(finalized) }
        }

        await updateDocumentImportJobStage({
            jobId: job.id,
            status: DOCUMENT_IMPORT_JOB_STATUS.SUCCEEDED,
            stage: DOCUMENT_IMPORT_JOB_STAGE.ENRICHING_REFERENCES,
            message: 'Draft created. Reference enrichment is running in the background.',
            progressMessage: 'Enriching shared references, tables, and diagram context.',
        })

        try {
            const enrichment = await raceDocumentImportJobTimeout(
                enrichImportedTestReferencesAfterDraft({
                    adminId: job.adminId,
                    testId: job.testId,
                    file,
                    fileName: job.fileName,
                }),
                90_000,
            )

            if ('error' in enrichment) {
                const finalized = await updateDocumentImportJobStage({
                    jobId: job.id,
                    status: DOCUMENT_IMPORT_JOB_STATUS.SUCCEEDED,
                    stage: DOCUMENT_IMPORT_JOB_STAGE.SUCCEEDED,
                    message: 'Draft created. Reference enrichment completed with warnings.',
                    progressMessage: enrichment.message,
                    errorCode: enrichment.code,
                    errorMessage: enrichment.message,
                    clearFileData: true,
                    completedAt: new Date(),
                })

                return { kind: 'succeeded', job: mapJob(finalized) }
            }

            const finalized = await updateDocumentImportJobStage({
                jobId: job.id,
                status: DOCUMENT_IMPORT_JOB_STATUS.SUCCEEDED,
                stage: DOCUMENT_IMPORT_JOB_STAGE.SUCCEEDED,
                message: 'Import completed successfully.',
                progressMessage: 'Reference enrichment completed successfully.',
                errorCode: null,
                errorMessage: null,
                clearFileData: true,
                completedAt: new Date(),
            })

            return { kind: 'succeeded', job: mapJob(finalized) }
        } catch (error) {
            const finalized = await updateDocumentImportJobStage({
                jobId: job.id,
                status: DOCUMENT_IMPORT_JOB_STATUS.SUCCEEDED,
                stage: DOCUMENT_IMPORT_JOB_STAGE.SUCCEEDED,
                message: 'Draft created. Reference enrichment completed with warnings.',
                progressMessage: error instanceof DocumentImportJobTimeoutError
                    ? 'Reference enrichment timed out after draft creation.'
                    : 'Reference enrichment failed after draft creation.',
                errorCode: error instanceof DocumentImportJobTimeoutError
                    ? 'REFERENCE_ENRICHMENT_TIMEOUT'
                    : 'REFERENCE_ENRICHMENT_FAILED',
                errorMessage: error instanceof Error
                    ? error.message
                    : 'Unexpected reference enrichment error.',
                clearFileData: true,
                completedAt: new Date(),
            })

            return { kind: 'succeeded', job: mapJob(finalized) }
        }
    }

    await updateDocumentImportJobStage({
        jobId: job.id,
        status: DOCUMENT_IMPORT_JOB_STATUS.PROCESSING,
        stage: DOCUMENT_IMPORT_JOB_STAGE.PROCESSING_CLASSIFICATION,
        message: 'Import is being processed in the background.',
        progressMessage: 'Classifying the document and selecting the extraction lane.',
        errorCode: null,
        errorMessage: null,
        startedAt: job.startedAt ?? new Date(),
    })

    try {
        const deferReferenceEnrichment = isPdfImportJob(job)
        const result = await raceDocumentImportJobTimeout(generateAdminTestFromDocument({
            adminId: job.adminId,
            file,
            title: job.requestedTitle,
            requestedCount: job.requestedCount,
            ipAddress: null,
            deferReferenceEnrichment,
            onProgress: async (update) => {
                await updateDocumentImportJobStage({
                    jobId: job.id,
                    status: DOCUMENT_IMPORT_JOB_STATUS.PROCESSING,
                    stage: update.stage,
                    message: update.message,
                    progressMessage: update.progressMessage,
                    lane: update.lane ?? null,
                    routingMode: update.routingMode ?? null,
                    selectedStrategy: update.selectedStrategy ?? null,
                    resultStrategy: update.resultStrategy ?? null,
                    decision: update.decision ?? null,
                    tokenCostUsd: update.tokenCostUsd ?? null,
                })
            },
        }))

        if ('error' in result) {
            const failed = await updateDocumentImportJobFailure(job.id, {
                message: result.message,
                errorCode: result.code,
                errorMessage: result.message,
                result: result.details
                    ? { error: true, details: result.details }
                    : Prisma.JsonNull,
            })

            return { kind: 'failed', job: mapJob(failed) }
        }

        let payloadObject = {
            test: result.test,
            strategy: result.strategy,
            extractedQuestions: result.extractedQuestions,
            generationTarget: result.generationTarget,
            questionsGenerated: result.questionsGenerated,
            failedCount: result.failedCount,
            cost: result.cost ?? null,
            importDiagnostics: result.importDiagnostics,
        }

        let queuedReferenceEnrichment = false
        if (deferReferenceEnrichment && result.test?.id) {
            try {
                await enqueueDocumentImportReferenceEnrichment(job.id)
                queuedReferenceEnrichment = true
            } catch (error) {
                payloadObject = {
                    ...payloadObject,
                    importDiagnostics: {
                        ...payloadObject.importDiagnostics,
                        warning: payloadObject.importDiagnostics.warning
                            ? `${payloadObject.importDiagnostics.warning} Reference enrichment could not be queued automatically.`
                            : 'Reference enrichment could not be queued automatically.',
                        referenceEnrichmentDeferred: false,
                    },
                }
            }
        }

        const succeeded = await prisma.documentImportJob.update({
            where: { id: job.id },
            data: {
                status: DOCUMENT_IMPORT_JOB_STATUS.SUCCEEDED,
                stage: queuedReferenceEnrichment
                    ? DOCUMENT_IMPORT_JOB_STAGE.ENRICHING_REFERENCES
                    : DOCUMENT_IMPORT_JOB_STAGE.SUCCEEDED,
                stageStartedAt: new Date(),
                message: queuedReferenceEnrichment
                    ? 'Draft created. Reference enrichment continues in the background.'
                    : result.importDiagnostics.warning
                        ? 'Import completed with warnings. Review before publishing.'
                        : 'Import completed successfully.',
                progressMessage: queuedReferenceEnrichment
                    ? 'Draft created. Reference enrichment continues in the background.'
                    : result.importDiagnostics.warning
                        ? 'Import completed with warnings. Review before publishing.'
                        : 'Import completed successfully.',
                errorCode: null,
                errorMessage: null,
                lane: result.importDiagnostics.lane ?? undefined,
                routingMode: result.importDiagnostics.routingMode ?? undefined,
                selectedStrategy: result.importDiagnostics.selectedStrategy ?? undefined,
                resultStrategy: result.strategy,
                decision: result.importDiagnostics.decision ?? undefined,
                tokenCostUsd: result.cost?.costUSD ?? 0,
                totalElapsedMs: toElapsedMs(job.startedAt ?? new Date()) ?? undefined,
                testId: result.test.id,
                result: toInputJsonValue(payloadObject),
                lastHeartbeatAt: new Date(),
                completedAt: new Date(),
                ...(queuedReferenceEnrichment ? {} : { fileData: null }),
            },
            select: DOCUMENT_IMPORT_JOB_SUMMARY_SELECT,
        })

        return { kind: 'succeeded', job: mapJob(succeeded) }
    } catch (error) {
        const failed = await updateDocumentImportJobFailure(job.id, {
            message: error instanceof DocumentImportJobTimeoutError
                ? 'Import timed out during background processing.'
                : 'Import failed during background processing.',
            errorCode: error instanceof DocumentImportJobTimeoutError ? 'TIMEOUT' : 'GENERATION_FAILED',
            errorMessage: error instanceof Error ? error.message : 'Unexpected import processing error.',
        })

        return { kind: 'failed', job: mapJob(failed) }
    }
}
