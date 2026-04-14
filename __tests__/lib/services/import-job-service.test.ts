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
const enrichImportedTestReferencesAfterDraftMock = vi.fn()
const enqueueDocumentImportReferenceEnrichmentMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
    prisma: prismaMock,
}))

vi.mock('@/lib/services/test-service', () => ({
    generateAdminTestFromDocument: generateAdminTestFromDocumentMock,
    enrichImportedTestReferencesAfterDraft: enrichImportedTestReferencesAfterDraftMock,
}))

vi.mock('@/lib/queue/qstash', () => ({
    enqueueDocumentImportReferenceEnrichment: enqueueDocumentImportReferenceEnrichmentMock,
}))

const servicePromise = import('../../../lib/services/import-job-service')

function createFile(name = 'history.docx', type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return new File(['Mock upload'], name, { type })
}

function createJobSummary(overrides: Record<string, unknown> = {}) {
    const status = (overrides.status ?? 'QUEUED') as string
    const defaultStage = status === 'SUCCEEDED'
        ? 'SUCCEEDED'
        : status === 'FAILED'
            ? 'FAILED'
            : status === 'PROCESSING'
                ? 'PROCESSING_EXACT'
                : 'QUEUED'

    return {
        id: 'job-1',
        status,
        stage: overrides.stage ?? defaultStage,
        stageStartedAt: null,
        lane: null,
        routingMode: null,
        selectedStrategy: null,
        resultStrategy: null,
        decision: null,
        tokenCostUsd: null,
        totalElapsedMs: null,
        fileName: 'history.docx',
        message: null,
        progressMessage: null,
        errorCode: null,
        errorMessage: null,
        testId: null,
        result: null,
        createdAt: new Date('2026-04-13T10:00:00.000Z'),
        updatedAt: new Date('2026-04-13T10:00:00.000Z'),
        startedAt: null,
        lastHeartbeatAt: null,
        completedAt: null,
        ...overrides,
    }
}

beforeEach(() => {
    vi.clearAllMocks()

    prismaMock.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        role: 'ADMIN',
        status: 'ACTIVE',
    })
    enqueueDocumentImportReferenceEnrichmentMock.mockResolvedValue({ messageId: 'msg-1' })
})

afterEach(() => {
    vi.useRealTimers()
})

test('createDocumentImportJob stores queued job metadata and file bytes', async () => {
    prismaMock.documentImportJob.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => createJobSummary({
        id: 'job-1',
        status: 'QUEUED',
        stage: 'QUEUED',
        fileName: data.fileName,
        message: data.message,
        progressMessage: data.progressMessage,
        lastHeartbeatAt: new Date('2026-04-13T10:00:00.000Z'),
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
        ...createJobSummary({
        id: 'job-done',
        adminId: 'admin-1',
        status: 'SUCCEEDED',
        stage: 'SUCCEEDED',
        fileName: 'history.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileSize: 11,
        fileData: null,
        requestedTitle: 'Done',
        requestedCount: 50,
        message: 'Import completed successfully.',
        progressMessage: 'Import completed successfully.',
        errorCode: null,
        errorMessage: null,
        testId: 'test-9',
        result: { test: { id: 'test-9' } },
        startedAt: new Date('2026-04-13T10:00:01.000Z'),
        lastHeartbeatAt: new Date('2026-04-13T10:00:04.000Z'),
        completedAt: new Date('2026-04-13T10:00:04.000Z'),
    }),
    })

    const { processDocumentImportJob } = await servicePromise
    const result = await processDocumentImportJob('job-done')

    expect(result.kind).toBe('noop')
    expect(prismaMock.documentImportJob.update).not.toHaveBeenCalled()
    expect(generateAdminTestFromDocumentMock).not.toHaveBeenCalled()
})

test('processDocumentImportJob marks jobs without file bytes as failed', async () => {
    prismaMock.documentImportJob.findUnique.mockResolvedValueOnce({
        ...createJobSummary({
        id: 'job-missing-file',
        adminId: 'admin-1',
        status: 'QUEUED',
        stage: 'QUEUED',
        fileName: 'missing.pdf',
        mimeType: 'application/pdf',
        fileSize: 11,
        fileData: null,
        requestedTitle: 'Broken',
        requestedCount: 50,
    }),
    })
    prismaMock.documentImportJob.update.mockResolvedValueOnce(createJobSummary({
        id: 'job-missing-file',
        status: 'FAILED',
        stage: 'FAILED',
        fileName: 'missing.pdf',
        message: 'Import source file is no longer available for processing.',
        progressMessage: 'Import source file is no longer available for processing.',
        errorCode: 'BAD_REQUEST',
        errorMessage: 'Import source file is missing from the queued job.',
        updatedAt: new Date('2026-04-13T10:00:02.000Z'),
        lastHeartbeatAt: new Date('2026-04-13T10:00:02.000Z'),
        completedAt: new Date('2026-04-13T10:00:02.000Z'),
    }))

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
        ...createJobSummary({
        id: 'job-1',
        adminId: 'admin-1',
        status: 'QUEUED',
        stage: 'QUEUED',
        fileName: 'history.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileSize: 11,
        fileData: Buffer.from('Mock upload'),
        requestedTitle: 'AI Test - History',
        requestedCount: 50,
    }),
    })
    prismaMock.documentImportJob.update
        .mockResolvedValueOnce(createJobSummary({
            id: 'job-1',
            status: 'PROCESSING',
            stage: 'PROCESSING_EXACT',
            fileName: 'history.docx',
            message: 'Import is being processed in the background.',
            progressMessage: 'Running document extraction and validation.',
            updatedAt: new Date('2026-04-13T10:00:01.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            lastHeartbeatAt: new Date('2026-04-13T10:00:01.000Z'),
        }))
        .mockResolvedValueOnce(createJobSummary({
            id: 'job-1',
            status: 'SUCCEEDED',
            stage: 'SUCCEEDED',
            fileName: 'history.docx',
            message: 'Import completed successfully.',
            progressMessage: 'Import completed successfully.',
            testId: 'test-1',
            result: { test: { id: 'test-1' }, questionsGenerated: 50 },
            updatedAt: new Date('2026-04-13T10:00:04.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            lastHeartbeatAt: new Date('2026-04-13T10:00:04.000Z'),
            completedAt: new Date('2026-04-13T10:00:04.000Z'),
        }))

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

test('processDocumentImportJob persists progress callback diagnostics while running', async () => {
    prismaMock.documentImportJob.findUnique.mockResolvedValueOnce({
        ...createJobSummary({
            id: 'job-progress',
            adminId: 'admin-1',
            status: 'QUEUED',
            stage: 'QUEUED',
            fileName: 'history.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            fileSize: 11,
            fileData: Buffer.from('Mock upload'),
            requestedTitle: 'AI Test - History',
            requestedCount: 50,
        }),
    })
    prismaMock.documentImportJob.update
        .mockResolvedValueOnce(createJobSummary({
            id: 'job-progress',
            status: 'PROCESSING',
            stage: 'PROCESSING_CLASSIFICATION',
            fileName: 'history.docx',
            message: 'Import is being processed in the background.',
            progressMessage: 'Classifying the document and selecting the extraction lane.',
            updatedAt: new Date('2026-04-13T10:00:01.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            stageStartedAt: new Date('2026-04-13T10:00:01.000Z'),
            lastHeartbeatAt: new Date('2026-04-13T10:00:01.000Z'),
        }))
        .mockResolvedValueOnce(createJobSummary({
            id: 'job-progress',
            status: 'PROCESSING',
            stage: 'VERIFYING',
            lane: 'STABLE',
            routingMode: 'CLASSIFIER',
            selectedStrategy: 'TEXT_EXACT',
            resultStrategy: 'EXTRACTED',
            decision: 'EXACT_ACCEPTED',
            tokenCostUsd: 0.12,
            fileName: 'history.docx',
            message: 'Verification complete. Preparing the draft result.',
            progressMessage: 'Verification passed. Finalizing the draft payload.',
            updatedAt: new Date('2026-04-13T10:00:02.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            stageStartedAt: new Date('2026-04-13T10:00:02.000Z'),
            lastHeartbeatAt: new Date('2026-04-13T10:00:02.000Z'),
        }))
        .mockResolvedValueOnce(createJobSummary({
            id: 'job-progress',
            status: 'SUCCEEDED',
            stage: 'SUCCEEDED',
            lane: 'STABLE',
            routingMode: 'CLASSIFIER',
            selectedStrategy: 'TEXT_EXACT',
            resultStrategy: 'EXTRACTED',
            decision: 'EXACT_ACCEPTED',
            tokenCostUsd: 0.12,
            totalElapsedMs: 3000,
            fileName: 'history.docx',
            message: 'Import completed successfully.',
            progressMessage: 'Import completed successfully.',
            testId: 'test-progress',
            result: { test: { id: 'test-progress' }, questionsGenerated: 50 },
            updatedAt: new Date('2026-04-13T10:00:04.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            stageStartedAt: new Date('2026-04-13T10:00:04.000Z'),
            lastHeartbeatAt: new Date('2026-04-13T10:00:04.000Z'),
            completedAt: new Date('2026-04-13T10:00:04.000Z'),
        }))

    generateAdminTestFromDocumentMock.mockImplementation(async (input: { onProgress?: (update: unknown) => Promise<void> }) => {
        await input.onProgress?.({
            stage: 'VERIFYING',
            message: 'Verification complete. Preparing the draft result.',
            progressMessage: 'Verification passed. Finalizing the draft payload.',
            lane: 'STABLE',
            routingMode: 'CLASSIFIER',
            selectedStrategy: 'TEXT_EXACT',
            resultStrategy: 'EXTRACTED',
            decision: 'EXACT_ACCEPTED',
            tokenCostUsd: 0.12,
        })

        return {
            test: { id: 'test-progress', title: 'AI Test - History', reviewStatus: null },
            strategy: 'EXTRACTED',
            extractedQuestions: 50,
            generationTarget: null,
            questionsGenerated: 50,
            failedCount: 0,
            cost: { costUSD: 0.12 },
            importDiagnostics: {
                warning: null,
                lane: 'STABLE',
                routingMode: 'CLASSIFIER',
                selectedStrategy: 'TEXT_EXACT',
                decision: 'EXACT_ACCEPTED',
            },
        }
    })

    const { processDocumentImportJob } = await servicePromise
    const result = await processDocumentImportJob('job-progress')

    expect(result.kind).toBe('succeeded')
    expect(prismaMock.documentImportJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
            where: { id: 'job-progress' },
            data: expect.objectContaining({
                status: 'PROCESSING',
                stage: 'VERIFYING',
                lane: 'STABLE',
                routingMode: 'CLASSIFIER',
                selectedStrategy: 'TEXT_EXACT',
                resultStrategy: 'EXTRACTED',
                decision: 'EXACT_ACCEPTED',
                tokenCostUsd: 0.12,
            }),
        }),
    )
})

test('processDocumentImportJob creates PDF drafts first and queues deferred reference enrichment', async () => {
    prismaMock.documentImportJob.findUnique.mockResolvedValueOnce({
        ...createJobSummary({
            id: 'job-pdf',
            adminId: 'admin-1',
            status: 'QUEUED',
            stage: 'QUEUED',
            fileName: 'figure.pdf',
            mimeType: 'application/pdf',
            fileSize: 11,
            fileData: Buffer.from('Mock upload'),
            requestedTitle: 'AI Test - Figure',
            requestedCount: 50,
        }),
    })
    prismaMock.documentImportJob.update
        .mockResolvedValueOnce(createJobSummary({
            id: 'job-pdf',
            status: 'PROCESSING',
            stage: 'PROCESSING_EXACT',
            fileName: 'figure.pdf',
            message: 'Import is being processed in the background.',
            progressMessage: 'Running document extraction and validation.',
            updatedAt: new Date('2026-04-13T10:00:01.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            lastHeartbeatAt: new Date('2026-04-13T10:00:01.000Z'),
        }))
        .mockResolvedValueOnce(createJobSummary({
            id: 'job-pdf',
            status: 'SUCCEEDED',
            stage: 'ENRICHING_REFERENCES',
            fileName: 'figure.pdf',
            message: 'Draft created. Reference enrichment continues in the background.',
            progressMessage: 'Draft created. Reference enrichment continues in the background.',
            testId: 'test-pdf',
            result: { test: { id: 'test-pdf' }, questionsGenerated: 50 },
            updatedAt: new Date('2026-04-13T10:00:04.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            lastHeartbeatAt: new Date('2026-04-13T10:00:04.000Z'),
            completedAt: new Date('2026-04-13T10:00:04.000Z'),
        }))

    generateAdminTestFromDocumentMock.mockResolvedValue({
        test: { id: 'test-pdf', title: 'AI Test - Figure', reviewStatus: null },
        strategy: 'EXTRACTED',
        extractedQuestions: 50,
        generationTarget: null,
        questionsGenerated: 50,
        failedCount: 0,
        cost: null,
        importDiagnostics: {
            warning: null,
            referenceEnrichmentDeferred: true,
        },
    })

    const { processDocumentImportJob } = await servicePromise
    const result = await processDocumentImportJob('job-pdf')

    expect(result.kind).toBe('succeeded')
    expect(generateAdminTestFromDocumentMock).toHaveBeenCalledWith(expect.objectContaining({
        deferReferenceEnrichment: true,
    }))
    expect(enqueueDocumentImportReferenceEnrichmentMock).toHaveBeenCalledWith('job-pdf')
    expect(prismaMock.documentImportJob.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
            where: { id: 'job-pdf' },
            data: expect.objectContaining({
                status: 'SUCCEEDED',
                stage: 'ENRICHING_REFERENCES',
                testId: 'test-pdf',
            }),
        }),
    )
})

test('processDocumentImportJob completes deferred reference enrichment and clears file bytes', async () => {
    prismaMock.documentImportJob.findUnique.mockResolvedValueOnce({
        ...createJobSummary({
            id: 'job-enrich',
            adminId: 'admin-1',
            status: 'SUCCEEDED',
            stage: 'ENRICHING_REFERENCES',
            fileName: 'figure.pdf',
            mimeType: 'application/pdf',
            fileSize: 11,
            fileData: Buffer.from('Mock upload'),
            requestedTitle: 'AI Test - Figure',
            requestedCount: 50,
            testId: 'test-pdf',
            result: { test: { id: 'test-pdf' }, questionsGenerated: 50 },
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            completedAt: new Date('2026-04-13T10:00:04.000Z'),
        }),
    })
    prismaMock.documentImportJob.update
        .mockResolvedValueOnce(createJobSummary({
            id: 'job-enrich',
            status: 'SUCCEEDED',
            stage: 'ENRICHING_REFERENCES',
            fileName: 'figure.pdf',
            message: 'Draft created. Reference enrichment is running in the background.',
            progressMessage: 'Enriching shared references, tables, and diagram context.',
            testId: 'test-pdf',
            updatedAt: new Date('2026-04-13T10:01:00.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            lastHeartbeatAt: new Date('2026-04-13T10:01:00.000Z'),
            completedAt: new Date('2026-04-13T10:00:04.000Z'),
        }))
        .mockResolvedValueOnce(createJobSummary({
            id: 'job-enrich',
            status: 'SUCCEEDED',
            stage: 'SUCCEEDED',
            fileName: 'figure.pdf',
            message: 'Import completed successfully.',
            progressMessage: 'Reference enrichment completed successfully.',
            testId: 'test-pdf',
            updatedAt: new Date('2026-04-13T10:01:20.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            lastHeartbeatAt: new Date('2026-04-13T10:01:20.000Z'),
            completedAt: new Date('2026-04-13T10:01:20.000Z'),
        }))
    enrichImportedTestReferencesAfterDraftMock.mockResolvedValue({
        testId: 'test-pdf',
        updatedQuestionCount: 50,
        enrichedReferenceCount: 32,
    })

    const { processDocumentImportJob } = await servicePromise
    const result = await processDocumentImportJob('job-enrich', 'REFERENCE_ENRICHMENT')

    expect(result.kind).toBe('succeeded')
    expect(enrichImportedTestReferencesAfterDraftMock).toHaveBeenCalledWith(expect.objectContaining({
        testId: 'test-pdf',
        fileName: 'figure.pdf',
    }))
    expect(prismaMock.documentImportJob.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
            where: { id: 'job-enrich' },
            data: expect.objectContaining({
                stage: 'SUCCEEDED',
                fileData: null,
            }),
        }),
    )
})

test('processDocumentImportJob keeps draft success if deferred reference enrichment fails', async () => {
    prismaMock.documentImportJob.findUnique.mockResolvedValueOnce({
        ...createJobSummary({
            id: 'job-enrich-fail',
            adminId: 'admin-1',
            status: 'SUCCEEDED',
            stage: 'ENRICHING_REFERENCES',
            fileName: 'figure.pdf',
            mimeType: 'application/pdf',
            fileSize: 11,
            fileData: Buffer.from('Mock upload'),
            requestedTitle: 'AI Test - Figure',
            requestedCount: 50,
            testId: 'test-pdf',
            result: { test: { id: 'test-pdf' }, questionsGenerated: 50 },
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            completedAt: new Date('2026-04-13T10:00:04.000Z'),
        }),
    })
    prismaMock.documentImportJob.update
        .mockResolvedValueOnce(createJobSummary({
            id: 'job-enrich-fail',
            status: 'SUCCEEDED',
            stage: 'ENRICHING_REFERENCES',
            fileName: 'figure.pdf',
            message: 'Draft created. Reference enrichment is running in the background.',
            progressMessage: 'Enriching shared references, tables, and diagram context.',
            testId: 'test-pdf',
            updatedAt: new Date('2026-04-13T10:01:00.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            lastHeartbeatAt: new Date('2026-04-13T10:01:00.000Z'),
            completedAt: new Date('2026-04-13T10:00:04.000Z'),
        }))
        .mockResolvedValueOnce(createJobSummary({
            id: 'job-enrich-fail',
            status: 'SUCCEEDED',
            stage: 'SUCCEEDED',
            fileName: 'figure.pdf',
            message: 'Draft created. Reference enrichment completed with warnings.',
            progressMessage: 'Reference enrichment failed after draft creation.',
            testId: 'test-pdf',
            errorCode: 'REFERENCE_ENRICHMENT_FAILED',
            errorMessage: 'Visual extractor crashed',
            updatedAt: new Date('2026-04-13T10:01:20.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            lastHeartbeatAt: new Date('2026-04-13T10:01:20.000Z'),
            completedAt: new Date('2026-04-13T10:01:20.000Z'),
        }))
    enrichImportedTestReferencesAfterDraftMock.mockResolvedValue({
        error: true,
        code: 'GENERATION_FAILED',
        message: 'Visual extractor crashed',
    })

    const { processDocumentImportJob } = await servicePromise
    const result = await processDocumentImportJob('job-enrich-fail', 'REFERENCE_ENRICHMENT')

    expect(result.kind).toBe('succeeded')
    expect(prismaMock.documentImportJob.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
            where: { id: 'job-enrich-fail' },
            data: expect.objectContaining({
                stage: 'SUCCEEDED',
                errorCode: 'GENERATION_FAILED',
                fileData: null,
            }),
        }),
    )
})

test('processDocumentImportJob finalizes deferred enrichment with warnings when draft test id is missing', async () => {
    prismaMock.documentImportJob.findUnique.mockResolvedValueOnce({
        ...createJobSummary({
            id: 'job-enrich-missing-test',
            adminId: 'admin-1',
            status: 'SUCCEEDED',
            stage: 'ENRICHING_REFERENCES',
            fileName: 'figure.pdf',
            mimeType: 'application/pdf',
            fileSize: 11,
            fileData: Buffer.from('Mock upload'),
            requestedTitle: 'AI Test - Figure',
            requestedCount: 50,
            testId: null,
            result: { test: { id: 'test-pdf' }, questionsGenerated: 50 },
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            completedAt: new Date('2026-04-13T10:00:04.000Z'),
        }),
    })
    prismaMock.documentImportJob.update.mockResolvedValueOnce(createJobSummary({
        id: 'job-enrich-missing-test',
        status: 'SUCCEEDED',
        stage: 'SUCCEEDED',
        fileName: 'figure.pdf',
        message: 'Draft created. Reference enrichment completed with warnings.',
        progressMessage: 'Reference enrichment skipped because no draft test id was available.',
        testId: null,
        errorCode: 'REFERENCE_TEST_MISSING',
        errorMessage: 'Deferred reference enrichment could not run because the draft test id was missing from the import job.',
        updatedAt: new Date('2026-04-13T10:01:20.000Z'),
        startedAt: new Date('2026-04-13T10:00:01.000Z'),
        lastHeartbeatAt: new Date('2026-04-13T10:01:20.000Z'),
        completedAt: new Date('2026-04-13T10:01:20.000Z'),
    }))

    const { processDocumentImportJob } = await servicePromise
    const result = await processDocumentImportJob('job-enrich-missing-test', 'REFERENCE_ENRICHMENT')

    expect(result.kind).toBe('succeeded')
    expect(enrichImportedTestReferencesAfterDraftMock).not.toHaveBeenCalled()
    expect(prismaMock.documentImportJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
            where: { id: 'job-enrich-missing-test' },
            data: expect.objectContaining({
                stage: 'SUCCEEDED',
                errorCode: 'REFERENCE_TEST_MISSING',
                fileData: null,
            }),
        }),
    )
})

test('processDocumentImportJob stores deterministic service failures without throwing', async () => {
    prismaMock.documentImportJob.findUnique.mockResolvedValueOnce({
        ...createJobSummary({
        id: 'job-2',
        adminId: 'admin-1',
        status: 'QUEUED',
        stage: 'QUEUED',
        fileName: 'broken.pdf',
        mimeType: 'application/pdf',
        fileSize: 11,
        fileData: Buffer.from('Mock upload'),
        requestedTitle: 'AI Test - Broken',
        requestedCount: 50,
    }),
    })
    prismaMock.documentImportJob.update
        .mockResolvedValueOnce(createJobSummary({
            id: 'job-2',
            status: 'PROCESSING',
            stage: 'PROCESSING_EXACT',
            fileName: 'broken.pdf',
            message: 'Import is being processed in the background.',
            progressMessage: 'Running document extraction and validation.',
            updatedAt: new Date('2026-04-13T10:00:01.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            lastHeartbeatAt: new Date('2026-04-13T10:00:01.000Z'),
        }))
        .mockResolvedValueOnce(createJobSummary({
            id: 'job-2',
            status: 'FAILED',
            stage: 'FAILED',
            fileName: 'broken.pdf',
            message: 'Could not parse document',
            progressMessage: 'Could not parse document',
            errorCode: 'PARSE_ERROR',
            errorMessage: 'Could not parse document',
            updatedAt: new Date('2026-04-13T10:00:04.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            lastHeartbeatAt: new Date('2026-04-13T10:00:04.000Z'),
            completedAt: new Date('2026-04-13T10:00:04.000Z'),
        }))

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
        ...createJobSummary({
        id: 'job-timeout',
        adminId: 'admin-1',
        status: 'QUEUED',
        stage: 'QUEUED',
        fileName: 'figure.pdf',
        mimeType: 'application/pdf',
        fileSize: 11,
        fileData: Buffer.from('Mock upload'),
        requestedTitle: 'Figure import',
        requestedCount: 50,
    }),
    })
    prismaMock.documentImportJob.update
        .mockResolvedValueOnce(createJobSummary({
            id: 'job-timeout',
            status: 'PROCESSING',
            stage: 'PROCESSING_EXACT',
            fileName: 'figure.pdf',
            message: 'Import is being processed in the background.',
            progressMessage: 'Running document extraction and validation.',
            updatedAt: new Date('2026-04-13T10:00:01.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            lastHeartbeatAt: new Date('2026-04-13T10:00:01.000Z'),
        }))
        .mockResolvedValueOnce(createJobSummary({
            id: 'job-timeout',
            status: 'FAILED',
            stage: 'FAILED',
            fileName: 'figure.pdf',
            message: 'Import timed out during background processing.',
            progressMessage: 'Import timed out during background processing.',
            errorCode: 'TIMEOUT',
            errorMessage: 'Document import timed out before completion.',
            updatedAt: new Date('2026-04-13T10:03:31.000Z'),
            startedAt: new Date('2026-04-13T10:00:01.000Z'),
            lastHeartbeatAt: new Date('2026-04-13T10:03:31.000Z'),
            completedAt: new Date('2026-04-13T10:03:31.000Z'),
        }))

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
        ...createJobSummary({
        id: 'job-stale',
        adminId: 'admin-1',
        status: 'PROCESSING',
        stage: 'PROCESSING_EXACT',
        fileName: 'figure.pdf',
        message: 'Import is being processed in the background.',
        updatedAt: new Date('2026-04-13T10:00:01.000Z'),
        startedAt: new Date(Date.now() - 280_000),
        lastHeartbeatAt: new Date(Date.now() - 280_000),
    }),
    })
    prismaMock.documentImportJob.update.mockResolvedValueOnce(createJobSummary({
        id: 'job-stale',
        status: 'FAILED',
        stage: 'FAILED',
        fileName: 'figure.pdf',
        message: 'Import timed out during background processing.',
        progressMessage: 'Import timed out during background processing.',
        errorCode: 'TIMEOUT',
        errorMessage: 'The background import worker exceeded the allowed execution window.',
        updatedAt: new Date('2026-04-13T10:05:00.000Z'),
        startedAt: new Date(Date.now() - 280_000),
        lastHeartbeatAt: new Date('2026-04-13T10:05:00.000Z'),
        completedAt: new Date('2026-04-13T10:05:00.000Z'),
    }))

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
    prismaMock.documentImportJob.update.mockResolvedValueOnce(createJobSummary({
        id: 'job-crash',
        status: 'FAILED',
        stage: 'FAILED',
        fileName: 'figure.pdf',
        message: 'Import failed during background processing.',
        progressMessage: 'Import failed during background processing.',
        errorCode: 'GENERATION_FAILED',
        errorMessage: 'Worker crashed',
        updatedAt: new Date('2026-04-13T10:00:02.000Z'),
        startedAt: new Date('2026-04-13T10:00:01.000Z'),
        lastHeartbeatAt: new Date('2026-04-13T10:00:02.000Z'),
        completedAt: new Date('2026-04-13T10:00:02.000Z'),
    }))

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
