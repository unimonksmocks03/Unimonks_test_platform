import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const prismaMock = {
    user: {
        findUnique: vi.fn(),
    },
    documentImportJob: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
    },
}

const generateAdminTestFromDocumentMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
    prisma: prismaMock,
}))

vi.mock('@/lib/services/test-service', () => ({
    generateAdminTestFromDocument: generateAdminTestFromDocumentMock,
}))

const servicePromise = import('../../../lib/services/import-job-service')

function createFile(name = 'history.docx', type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return new File(['Mock upload'], name, { type })
}

beforeEach(() => {
    vi.clearAllMocks()

    prismaMock.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        role: 'ADMIN',
        status: 'ACTIVE',
    })
})

afterEach(() => {
    vi.useRealTimers()
})

test('createDocumentImportJob stores queued job metadata and file bytes', async () => {
    prismaMock.documentImportJob.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'job-1',
        status: 'QUEUED',
        fileName: data.fileName,
        message: data.message,
        errorCode: null,
        errorMessage: null,
        testId: null,
        result: null,
        createdAt: new Date('2026-04-13T10:00:00.000Z'),
        updatedAt: new Date('2026-04-13T10:00:00.000Z'),
        startedAt: null,
        completedAt: null,
    }))

    const { createDocumentImportJob } = await servicePromise
    const result = await createDocumentImportJob({
        adminId: 'admin-1',
        file: createFile(),
        title: 'AI Test - History',
        requestedCount: 50,
    })

    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(prismaMock.documentImportJob.create).toHaveBeenCalledTimes(1)
    const createCall = prismaMock.documentImportJob.create.mock.calls[0][0]
    expect(createCall.data).toMatchObject({
        adminId: 'admin-1',
        fileName: 'history.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileSize: 11,
        requestedTitle: 'AI Test - History',
        requestedCount: 50,
        message: 'Import queued. Processing will start shortly.',
    })
    expect(createCall.data.fileData).toBeInstanceOf(Buffer)
    expect(result.job.status).toBe('QUEUED')
})

test('createDocumentImportJob rejects inactive admins', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'admin-2',
        role: 'ADMIN',
        status: 'INACTIVE',
    })

    const { createDocumentImportJob } = await servicePromise
    const result = await createDocumentImportJob({
        adminId: 'admin-2',
        file: createFile(),
    })

    expect(result).toMatchObject({
        error: true,
        code: 'INACTIVE_ADMIN',
    })
    expect(prismaMock.documentImportJob.create).not.toHaveBeenCalled()
})

test('processDocumentImportJob returns noop for already completed jobs', async () => {
    prismaMock.documentImportJob.findUnique.mockResolvedValueOnce({
        id: 'job-done',
        adminId: 'admin-1',
        status: 'SUCCEEDED',
        fileName: 'history.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileSize: 11,
        fileData: null,
        requestedTitle: 'Done',
        requestedCount: 50,
        message: 'Import completed successfully.',
        errorCode: null,
        errorMessage: null,
        testId: 'test-9',
        result: { test: { id: 'test-9' } },
        createdAt: new Date('2026-04-13T10:00:00.000Z'),
        updatedAt: new Date('2026-04-13T10:00:04.000Z'),
        startedAt: new Date('2026-04-13T10:00:01.000Z'),
        completedAt: new Date('2026-04-13T10:00:04.000Z'),
    })

    const { processDocumentImportJob } = await servicePromise
    const result = await processDocumentImportJob('job-done')

    expect(result.kind).toBe('noop')
    expect(prismaMock.documentImportJob.update).not.toHaveBeenCalled()
    expect(generateAdminTestFromDocumentMock).not.toHaveBeenCalled()
})

test('processDocumentImportJob marks jobs without file bytes as failed', async () => {
    prismaMock.documentImportJob.findUnique.mockResolvedValueOnce({
        id: 'job-missing-file',
        adminId: 'admin-1',
        status: 'QUEUED',
        fileName: 'missing.pdf',
        mimeType: 'application/pdf',
        fileSize: 11,
        fileData: null,
        requestedTitle: 'Broken',
        requestedCount: 50,
        message: null,
        errorCode: null,
        errorMessage: null,
        testId: null,
        result: null,
        createdAt: new Date('2026-04-13T10:00:00.000Z'),
        updatedAt: new Date('2026-04-13T10:00:00.000Z'),
        startedAt: null,
        completedAt: null,
    })
    prismaMock.documentImportJob.update.mockResolvedValueOnce({
        id: 'job-missing-file',
        status: 'FAILED',
        fileName: 'missing.pdf',
        message: 'Import source file is no longer available for processing.',
        errorCode: 'BAD_REQUEST',
        errorMessage: 'Import source file is missing from the queued job.',
        testId: null,
        result: null,
        createdAt: new Date('2026-04-13T10:00:00.000Z'),
        updatedAt: new Date('2026-04-13T10:00:02.000Z'),
        startedAt: null,
        completedAt: new Date('2026-04-13T10:00:02.000Z'),
    })

    const { processDocumentImportJob } = await servicePromise
    const result = await processDocumentImportJob('job-missing-file')

    expect(result.kind).toBe('failed')
    expect(prismaMock.documentImportJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
            where: { id: 'job-missing-file' },
            data: expect.objectContaining({
                status: 'FAILED',
                errorCode: 'BAD_REQUEST',
            }),
        }),
    )
    expect(generateAdminTestFromDocumentMock).not.toHaveBeenCalled()
})

test('processDocumentImportJob stores succeeded result payload and clears file bytes', async () => {
    prismaMock.documentImportJob.findUnique.mockResolvedValueOnce({
        id: 'job-1',
        adminId: 'admin-1',
        status: 'QUEUED',
        fileName: 'history.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileSize: 11,
        fileData: Buffer.from('Mock upload'),
        requestedTitle: 'AI Test - History',
        requestedCount: 50,
        message: null,
        errorCode: null,
        errorMessage: null,
        testId: null,
        result: null,
        createdAt: new Date('2026-04-13T10:00:00.000Z'),
        updatedAt: new Date('2026-04-13T10:00:00.000Z'),
        startedAt: null,
        completedAt: null,
    })
    prismaMock.documentImportJob.update
        .mockResolvedValueOnce({
            id: 'job-1',
            status: 'PROCESSING',
            fileName: 'history.docx',
            message: 'Import is being processed in the background.',
            errorCode: null,
            errorMessage: null,
            testId: null,
            result: null,
            createdAt: new Date('2026-04-13T10:00:00.000Z'),
            updatedAt: new Date('2026-04-13T10:00:01.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            completedAt: null,
        })
        .mockResolvedValueOnce({
            id: 'job-1',
            status: 'SUCCEEDED',
            fileName: 'history.docx',
            message: 'Import completed successfully.',
            errorCode: null,
            errorMessage: null,
            testId: 'test-1',
            result: { test: { id: 'test-1' }, questionsGenerated: 50 },
            createdAt: new Date('2026-04-13T10:00:00.000Z'),
            updatedAt: new Date('2026-04-13T10:00:04.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            completedAt: new Date('2026-04-13T10:00:04.000Z'),
        })

    generateAdminTestFromDocumentMock.mockResolvedValue({
        test: { id: 'test-1', title: 'AI Test - History', reviewStatus: null },
        strategy: 'EXTRACTED',
        extractedQuestions: 50,
        generationTarget: null,
        questionsGenerated: 50,
        failedCount: 0,
        cost: null,
        importDiagnostics: {
            warning: null,
        },
    })

    const { processDocumentImportJob } = await servicePromise
    const result = await processDocumentImportJob('job-1')

    expect(result.kind).toBe('succeeded')
    expect(generateAdminTestFromDocumentMock).toHaveBeenCalledTimes(1)
    expect(prismaMock.documentImportJob.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
            where: { id: 'job-1' },
            data: expect.objectContaining({
                status: 'SUCCEEDED',
                testId: 'test-1',
                fileData: null,
            }),
        }),
    )
})

test('processDocumentImportJob stores deterministic service failures without throwing', async () => {
    prismaMock.documentImportJob.findUnique.mockResolvedValueOnce({
        id: 'job-2',
        adminId: 'admin-1',
        status: 'QUEUED',
        fileName: 'broken.pdf',
        mimeType: 'application/pdf',
        fileSize: 11,
        fileData: Buffer.from('Mock upload'),
        requestedTitle: 'AI Test - Broken',
        requestedCount: 50,
        message: null,
        errorCode: null,
        errorMessage: null,
        testId: null,
        result: null,
        createdAt: new Date('2026-04-13T10:00:00.000Z'),
        updatedAt: new Date('2026-04-13T10:00:00.000Z'),
        startedAt: null,
        completedAt: null,
    })
    prismaMock.documentImportJob.update
        .mockResolvedValueOnce({
            id: 'job-2',
            status: 'PROCESSING',
            fileName: 'broken.pdf',
            message: 'Import is being processed in the background.',
            errorCode: null,
            errorMessage: null,
            testId: null,
            result: null,
            createdAt: new Date('2026-04-13T10:00:00.000Z'),
            updatedAt: new Date('2026-04-13T10:00:01.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            completedAt: null,
        })
        .mockResolvedValueOnce({
            id: 'job-2',
            status: 'FAILED',
            fileName: 'broken.pdf',
            message: 'Could not parse document',
            errorCode: 'PARSE_ERROR',
            errorMessage: 'Could not parse document',
            testId: null,
            result: null,
            createdAt: new Date('2026-04-13T10:00:00.000Z'),
            updatedAt: new Date('2026-04-13T10:00:04.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            completedAt: new Date('2026-04-13T10:00:04.000Z'),
        })

    generateAdminTestFromDocumentMock.mockResolvedValue({
        error: true,
        code: 'PARSE_ERROR',
        message: 'Could not parse document',
    })

    const { processDocumentImportJob } = await servicePromise
    const result = await processDocumentImportJob('job-2')

    expect(result.kind).toBe('failed')
    expect(prismaMock.documentImportJob.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
            where: { id: 'job-2' },
            data: expect.objectContaining({
                status: 'FAILED',
                errorCode: 'PARSE_ERROR',
                fileData: null,
            }),
        }),
    )
})

test('processDocumentImportJob marks timed out workers as failed instead of leaving jobs processing', async () => {
    vi.useFakeTimers()

    prismaMock.documentImportJob.findUnique.mockResolvedValueOnce({
        id: 'job-timeout',
        adminId: 'admin-1',
        status: 'QUEUED',
        fileName: 'figure.pdf',
        mimeType: 'application/pdf',
        fileSize: 11,
        fileData: Buffer.from('Mock upload'),
        requestedTitle: 'Figure import',
        requestedCount: 50,
        message: null,
        errorCode: null,
        errorMessage: null,
        testId: null,
        result: null,
        createdAt: new Date('2026-04-13T10:00:00.000Z'),
        updatedAt: new Date('2026-04-13T10:00:00.000Z'),
        startedAt: null,
        completedAt: null,
    })
    prismaMock.documentImportJob.update
        .mockResolvedValueOnce({
            id: 'job-timeout',
            status: 'PROCESSING',
            fileName: 'figure.pdf',
            message: 'Import is being processed in the background.',
            errorCode: null,
            errorMessage: null,
            testId: null,
            result: null,
            createdAt: new Date('2026-04-13T10:00:00.000Z'),
            updatedAt: new Date('2026-04-13T10:00:01.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            completedAt: null,
        })
        .mockResolvedValueOnce({
            id: 'job-timeout',
            status: 'FAILED',
            fileName: 'figure.pdf',
            message: 'Import timed out during background processing.',
            errorCode: 'TIMEOUT',
            errorMessage: 'Document import timed out before completion.',
            testId: null,
            result: null,
            createdAt: new Date('2026-04-13T10:00:00.000Z'),
            updatedAt: new Date('2026-04-13T10:03:31.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            completedAt: new Date('2026-04-13T10:03:31.000Z'),
        })

    generateAdminTestFromDocumentMock.mockImplementation(() => new Promise(() => {}))

    const { processDocumentImportJob } = await servicePromise
    const processingPromise = processDocumentImportJob('job-timeout')
    await vi.advanceTimersByTimeAsync(210_000)
    const result = await processingPromise

    expect(result.kind).toBe('failed')
    expect(prismaMock.documentImportJob.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
            where: { id: 'job-timeout' },
            data: expect.objectContaining({
                status: 'FAILED',
                errorCode: 'TIMEOUT',
                message: 'Import timed out during background processing.',
            }),
        }),
    )
})

test('getDocumentImportJob finalizes stale processing jobs as failed on poll', async () => {
    prismaMock.documentImportJob.findUnique.mockResolvedValueOnce({
        id: 'job-stale',
        adminId: 'admin-1',
        status: 'PROCESSING',
        fileName: 'figure.pdf',
        message: 'Import is being processed in the background.',
        errorCode: null,
        errorMessage: null,
        testId: null,
        result: null,
        createdAt: new Date('2026-04-13T10:00:00.000Z'),
        updatedAt: new Date('2026-04-13T10:00:01.000Z'),
        startedAt: new Date(Date.now() - 280_000),
        completedAt: null,
    })
    prismaMock.documentImportJob.update.mockResolvedValueOnce({
        id: 'job-stale',
        status: 'FAILED',
        fileName: 'figure.pdf',
        message: 'Import timed out during background processing.',
        errorCode: 'TIMEOUT',
        errorMessage: 'The background import worker exceeded the allowed execution window.',
        testId: null,
        result: null,
        createdAt: new Date('2026-04-13T10:00:00.000Z'),
        updatedAt: new Date('2026-04-13T10:05:00.000Z'),
        startedAt: new Date(Date.now() - 280_000),
        completedAt: new Date('2026-04-13T10:05:00.000Z'),
    })

    const { getDocumentImportJob } = await servicePromise
    const result = await getDocumentImportJob('admin-1', 'job-stale')

    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.job.status).toBe('FAILED')
    expect(prismaMock.documentImportJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
            where: { id: 'job-stale' },
            data: expect.objectContaining({
                status: 'FAILED',
                errorCode: 'TIMEOUT',
            }),
        }),
    )
})

test('markDocumentImportJobUnhandledFailure records unexpected worker failures', async () => {
    prismaMock.documentImportJob.update.mockResolvedValueOnce({
        id: 'job-crash',
        status: 'FAILED',
        fileName: 'figure.pdf',
        message: 'Import failed during background processing.',
        errorCode: 'GENERATION_FAILED',
        errorMessage: 'Worker crashed',
        testId: null,
        result: null,
        createdAt: new Date('2026-04-13T10:00:00.000Z'),
        updatedAt: new Date('2026-04-13T10:00:02.000Z'),
        startedAt: new Date('2026-04-13T10:00:01.000Z'),
        completedAt: new Date('2026-04-13T10:00:02.000Z'),
    })

    const { markDocumentImportJobUnhandledFailure } = await servicePromise
    const job = await markDocumentImportJobUnhandledFailure('job-crash', new Error('Worker crashed'))

    expect(job.status).toBe('FAILED')
    expect(prismaMock.documentImportJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
            where: { id: 'job-crash' },
            data: expect.objectContaining({
                status: 'FAILED',
                errorCode: 'GENERATION_FAILED',
                errorMessage: 'Worker crashed',
            }),
        }),
    )
})
