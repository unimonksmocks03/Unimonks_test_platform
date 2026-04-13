import { Prisma, Role, UserStatus } from '@prisma/client'
import type { DocumentImportJobStatus } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { generateAdminTestFromDocument } from '@/lib/services/test-service'

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
    fileName: string
    message: string | null
    errorCode: string | null
    errorMessage: string | null
    testId: string | null
    result: Prisma.JsonValue | null
    createdAt: Date
    updatedAt: Date
    startedAt: Date | null
    completedAt: Date | null
}

const DOCUMENT_IMPORT_JOB_STATUS = {
    QUEUED: 'QUEUED',
    PROCESSING: 'PROCESSING',
    SUCCEEDED: 'SUCCEEDED',
    FAILED: 'FAILED',
} as const satisfies Record<DocumentImportJobStatus, DocumentImportJobStatus>

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
    return prisma.documentImportJob.update({
        where: { id: jobId },
        data: {
            status: DOCUMENT_IMPORT_JOB_STATUS.FAILED,
            message: input.message,
            errorCode: input.errorCode,
            errorMessage: input.errorMessage,
            result: input.result === undefined
                ? undefined
                : input.result === Prisma.JsonNull
                    ? Prisma.JsonNull
                    : toInputJsonValue(input.result),
            completedAt: new Date(),
            ...(input.clearFileData === false ? {} : { fileData: null }),
        },
        select: {
            id: true,
            status: true,
            fileName: true,
            message: true,
            errorCode: true,
            errorMessage: true,
            testId: true,
            result: true,
            createdAt: true,
            updatedAt: true,
            startedAt: true,
            completedAt: true,
        },
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
    fileName: string
    message: string | null
    errorCode: string | null
    errorMessage: string | null
    testId: string | null
    result: Prisma.JsonValue | null
    createdAt: Date
    updatedAt: Date
    startedAt: Date | null
    completedAt: Date | null
}): DocumentImportJobSummary {
    return {
        id: job.id,
        status: job.status,
        fileName: job.fileName,
        message: job.message,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        testId: job.testId,
        result: job.result,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        startedAt: job.startedAt,
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
            fileName,
            mimeType: input.file.type || 'application/octet-stream',
            fileSize: input.file.size,
            fileData,
            requestedTitle: input.title?.trim() || null,
            requestedCount: input.requestedCount ?? null,
            message: 'Import queued. Processing will start shortly.',
        },
        select: {
            id: true,
            status: true,
            fileName: true,
            message: true,
            errorCode: true,
            errorMessage: true,
            testId: true,
            result: true,
            createdAt: true,
            updatedAt: true,
            startedAt: true,
            completedAt: true,
        },
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
            id: true,
            adminId: true,
            status: true,
            fileName: true,
            message: true,
            errorCode: true,
            errorMessage: true,
            testId: true,
            result: true,
            createdAt: true,
            updatedAt: true,
            startedAt: true,
            completedAt: true,
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

export async function processDocumentImportJob(jobId: string): Promise<ProcessDocumentImportJobResult> {
    const job = await prisma.documentImportJob.findUnique({
        where: { id: jobId },
        select: {
            id: true,
            adminId: true,
            status: true,
            fileName: true,
            mimeType: true,
            fileSize: true,
            fileData: true,
            requestedTitle: true,
            requestedCount: true,
            message: true,
            errorCode: true,
            errorMessage: true,
            testId: true,
            result: true,
            createdAt: true,
            updatedAt: true,
            startedAt: true,
            completedAt: true,
        },
    })

    if (!job) {
        throw new Error(`Document import job ${jobId} not found`)
    }

    if (
        job.status === DOCUMENT_IMPORT_JOB_STATUS.SUCCEEDED
        || job.status === DOCUMENT_IMPORT_JOB_STATUS.FAILED
    ) {
        return {
            kind: 'noop',
            job: mapJob(job),
            reason: `Job already ${job.status.toLowerCase()}.`,
        }
    }

    if (!job.fileData) {
        const failed = await updateDocumentImportJobFailure(job.id, {
            message: 'Import source file is no longer available for processing.',
            errorCode: 'BAD_REQUEST',
            errorMessage: 'Import source file is missing from the queued job.',
            clearFileData: false,
        })

        return { kind: 'failed', job: mapJob(failed) }
    }

    await prisma.documentImportJob.update({
        where: { id: job.id },
        data: {
            status: DOCUMENT_IMPORT_JOB_STATUS.PROCESSING,
            message: 'Import is being processed in the background.',
            errorCode: null,
            errorMessage: null,
            startedAt: job.startedAt ?? new Date(),
        },
        select: {
            id: true,
            status: true,
            fileName: true,
            message: true,
            errorCode: true,
            errorMessage: true,
            testId: true,
            result: true,
            createdAt: true,
            updatedAt: true,
            startedAt: true,
            completedAt: true,
        },
    })

    const file = new File([new Uint8Array(job.fileData)], job.fileName, {
        type: job.mimeType,
    })

    try {
        const result = await raceDocumentImportJobTimeout(generateAdminTestFromDocument({
            adminId: job.adminId,
            file,
            title: job.requestedTitle,
            requestedCount: job.requestedCount,
            ipAddress: null,
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

        const payload = toInputJsonValue({
            test: result.test,
            strategy: result.strategy,
            extractedQuestions: result.extractedQuestions,
            generationTarget: result.generationTarget,
            questionsGenerated: result.questionsGenerated,
            failedCount: result.failedCount,
            cost: result.cost ?? null,
            importDiagnostics: result.importDiagnostics,
        })

        const succeeded = await prisma.documentImportJob.update({
            where: { id: job.id },
            data: {
                status: DOCUMENT_IMPORT_JOB_STATUS.SUCCEEDED,
                message: result.importDiagnostics.warning
                    ? 'Import completed with warnings. Review before publishing.'
                    : 'Import completed successfully.',
                errorCode: null,
                errorMessage: null,
                testId: result.test.id,
                result: payload,
                completedAt: new Date(),
                fileData: null,
            },
            select: {
                id: true,
                status: true,
                fileName: true,
                message: true,
                errorCode: true,
                errorMessage: true,
                testId: true,
                result: true,
                createdAt: true,
                updatedAt: true,
                startedAt: true,
                completedAt: true,
            },
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
