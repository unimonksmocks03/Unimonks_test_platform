import { beforeEach, expect, test, vi } from 'vitest'

vi.stubEnv('NODE_ENV', process.env.NODE_ENV ?? 'test')
vi.stubEnv('DATABASE_URL', process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
vi.stubEnv('DIRECT_URL', process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
vi.stubEnv('REDIS_URL', process.env.REDIS_URL ?? 'redis://localhost:6379')
vi.stubEnv('UPSTASH_REDIS_REST_URL', process.env.UPSTASH_REDIS_REST_URL ?? 'https://example.upstash.io')
vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', process.env.UPSTASH_REDIS_REST_TOKEN ?? 'test-token')

const prismaMock = {
    user: {
        findUnique: vi.fn(),
    },
    test: {
        create: vi.fn(),
        findUnique: vi.fn(),
    },
    question: {
        findUnique: vi.fn(),
        update: vi.fn(),
    },
    questionReference: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
    },
    questionReferenceLink: {
        create: vi.fn(),
        createMany: vi.fn(),
        deleteMany: vi.fn(),
    },
    auditLog: {
        create: vi.fn(),
    },
    $transaction: vi.fn(),
}

const parseDocumentToTextMock = vi.fn()
const extractQuestionsFromDocumentTextPreciselyMock = vi.fn()
const extractQuestionsFromPdfMultimodalMock = vi.fn()
const generateQuestionsFromPdfVisionFallbackMock = vi.fn()
const generateQuestionsFromTextMock = vi.fn()
const getPdfPageCountMock = vi.fn()
const attachSharedContextsFromPdfMock = vi.fn()
const enrichGeneratedQuestionsMetadataMock = vi.fn()
const verifyExtractedQuestionsMock = vi.fn()
const verifyExtractedQuestionsWithAIMock = vi.fn()
const reconcileGeneratedQuestionsWithTextAnswerHintsMock = vi.fn()
const extractVisualReferencesFromDocxImagesMock = vi.fn()
const extractVisualReferencesFromPdfImagesMock = vi.fn()
const classifyDocumentForImportMock = vi.fn()
const resolveDocumentImportPlanMock = vi.fn()
const isClassifierRoutingEnabledMock = vi.fn()
const executeDocumentImportPlanMock = vi.fn()
const uploadPdfReferenceSnapshotsMock = vi.fn()
const uploadManualReferenceSnapshotMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
    prisma: prismaMock,
}))

vi.mock('@/lib/services/ai-service', () => ({
    parseDocumentToText: parseDocumentToTextMock,
    extractQuestionsFromDocumentTextPrecisely: extractQuestionsFromDocumentTextPreciselyMock,
    extractQuestionsFromPdfMultimodal: extractQuestionsFromPdfMultimodalMock,
    generateQuestionsFromPdfVisionFallback: generateQuestionsFromPdfVisionFallbackMock,
    generateQuestionsFromText: generateQuestionsFromTextMock,
    getPdfPageCount: getPdfPageCountMock,
    attachSharedContextsFromPdf: attachSharedContextsFromPdfMock,
    enrichGeneratedQuestionsMetadata: enrichGeneratedQuestionsMetadataMock,
    verifyExtractedQuestions: verifyExtractedQuestionsMock,
    verifyExtractedQuestionsWithAI: verifyExtractedQuestionsWithAIMock,
    reconcileGeneratedQuestionsWithTextAnswerHints: reconcileGeneratedQuestionsWithTextAnswerHintsMock,
    extractVisualReferencesFromDocxImages: extractVisualReferencesFromDocxImagesMock,
    extractVisualReferencesFromPdfImages: extractVisualReferencesFromPdfImagesMock,
}))

vi.mock('@/lib/services/document-classifier', () => ({
    classifyDocumentForImport: classifyDocumentForImportMock,
}))

vi.mock('@/lib/services/document-import-strategy', () => ({
    resolveDocumentImportPlan: resolveDocumentImportPlanMock,
    isClassifierRoutingEnabled: isClassifierRoutingEnabledMock,
}))

vi.mock('@/lib/services/document-import-executor', () => ({
    executeDocumentImportPlan: executeDocumentImportPlanMock,
}))

vi.mock('@/lib/storage/reference-snapshots', () => ({
    uploadPdfReferenceSnapshots: uploadPdfReferenceSnapshotsMock,
    uploadManualReferenceSnapshot: uploadManualReferenceSnapshotMock,
    isReferenceSnapshotStorageConfigured: vi.fn(() => true),
}))

const servicePromise = import('../../../lib/services/test-service')

function createFile(
    name = 'history.docx',
    type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
) {
    return new File(['Mock upload'], name, {
        type,
    })
}

function createQuestion(stem: string, overrides: Record<string, unknown> = {}) {
    return {
        stem,
        options: [
            { id: 'A', text: 'Option A', isCorrect: true },
            { id: 'B', text: 'Option B', isCorrect: false },
            { id: 'C', text: 'Option C', isCorrect: false },
            { id: 'D', text: 'Option D', isCorrect: false },
        ],
        explanation: 'Explanation',
        difficulty: 'MEDIUM',
        topic: 'History',
        sharedContext: null,
        sourcePage: 2,
        sourceSnippet: `${stem} source`,
        answerSource: 'ANSWER_KEY',
        confidence: 0.94,
        sharedContextEvidence: null,
        extractionMode: 'TEXT_EXACT',
        ...overrides,
    }
}

function createReferenceLink(overrides: Record<string, unknown> = {}) {
    return {
        order: 1,
        reference: {
            id: 'reference-1',
            kind: 'DIAGRAM',
            mode: 'SNAPSHOT',
            title: 'Figure reference',
            textContent: null,
            assetUrl: null,
            sourcePage: 2,
            bbox: null,
            confidence: 0.88,
            evidence: null,
            ...overrides,
        },
    }
}

function createClassification() {
    return {
        documentType: 'MCQ_PAPER',
        layoutRisk: 'LOW',
        hasTables: false,
        hasPassages: false,
        hasVisualReferences: false,
        hasEmbeddedImages: false,
        hasMatchFollowing: false,
        hasAssertionReason: false,
        hasDiagramReasoning: false,
        isScannedLike: false,
        isMixedLayout: false,
        preferredStrategy: 'TEXT_EXACT',
        reasons: ['Detected numbered questions with option/answer patterns'],
    }
}

function createVerification(overrides: Record<string, unknown> = {}) {
    return {
        totalQuestions: 1,
        validQuestions: 1,
        issues: [],
        passed: true,
        reviewRecommended: false,
        issueSummary: {
            structural: 0,
            evidence: 0,
            cross: 0,
            errors: 0,
            warnings: 0,
        },
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
    prismaMock.test.findUnique.mockResolvedValue({
        id: 'test-1',
        status: 'DRAFT',
    })
    prismaMock.question.findUnique.mockResolvedValue({
        id: 'question-1',
        testId: 'test-1',
        order: 1,
        stem: 'Recovered question stem',
        sharedContext: '',
        importEvidence: null,
        options: [
            { id: 'A', text: 'Option A', isCorrect: true },
            { id: 'B', text: 'Option B', isCorrect: false },
            { id: 'C', text: 'Option C', isCorrect: false },
            { id: 'D', text: 'Option D', isCorrect: false },
        ],
        explanation: 'Explanation',
        difficulty: 'MEDIUM',
        topic: 'History',
        referenceLinks: [],
    })
    prismaMock.question.update.mockResolvedValue({
        id: 'question-1',
        testId: 'test-1',
    })
    prismaMock.questionReference.create.mockResolvedValue({ id: 'reference-1' })
    prismaMock.questionReference.update.mockResolvedValue({ id: 'reference-1' })
    prismaMock.questionReference.delete.mockResolvedValue({ id: 'reference-1' })
    prismaMock.questionReference.deleteMany.mockResolvedValue({ count: 0 })
    prismaMock.questionReferenceLink.create.mockResolvedValue({ id: 'reference-link-1' })
    prismaMock.questionReferenceLink.createMany.mockResolvedValue({ count: 1 })
    prismaMock.questionReferenceLink.deleteMany.mockResolvedValue({ count: 1 })
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock))
    prismaMock.test.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'test-1',
        title: data.title,
        reviewStatus: data.reviewStatus ?? null,
        questions: [{ id: 'question-1', order: 1 }],
    }))
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' })

    parseDocumentToTextMock.mockResolvedValue('Question 1 text')
    classifyDocumentForImportMock.mockReturnValue(createClassification())
    isClassifierRoutingEnabledMock.mockReturnValue(true)
    resolveDocumentImportPlanMock.mockReturnValue({
        routingMode: 'CLASSIFIER',
        lane: 'STABLE',
        selectedStrategy: 'TEXT_EXACT',
        runMultimodalFirst: false,
        visualReferenceOverlay: false,
        generateFromSource: false,
        reasons: ['clean paper'],
    })
    executeDocumentImportPlanMock.mockResolvedValue({
        useLegacyFlow: false,
        strategy: 'EXTRACTED',
        result: {
            error: false,
            message: undefined,
            questions: [createQuestion('Recovered question stem')],
            failedCount: 0,
            cost: {
                model: 'gpt-5.4-mini',
                inputTokens: 100,
                outputTokens: 20,
                costUSD: 0.12,
            },
        },
        extracted: {
            detectedAsMcqDocument: true,
            answerHintCount: 1,
            candidateBlockCount: 1,
            questions: [createQuestion('Recovered question stem')],
            expectedQuestionCount: 1,
            exactMatchAchieved: true,
            invalidQuestionNumbers: [],
            missingQuestionNumbers: [],
            duplicateQuestionNumbers: [],
            aiRepairUsed: false,
            cost: undefined,
            error: false,
            message: undefined,
        },
        parserStatus: 'OK',
        aiFallbackUsed: false,
        reportParserIssue: false,
        warning: null,
        needsAdminReview: false,
        reviewIssueCount: 0,
    })
    verifyExtractedQuestionsMock.mockReturnValue(createVerification())
    verifyExtractedQuestionsWithAIMock.mockResolvedValue({
        issues: [],
        overallAssessment: 'No additional AI issues found.',
        confidence: 0.95,
    })
    reconcileGeneratedQuestionsWithTextAnswerHintsMock.mockImplementation((questions) => ({
        questions,
        repairedCount: 0,
        answerHintsRecovered: 0,
    }))
    attachSharedContextsFromPdfMock.mockImplementation(async (_buffer, questions) => questions)
    extractVisualReferencesFromPdfImagesMock.mockResolvedValue({
        error: false,
        references: [],
    })
    enrichGeneratedQuestionsMetadataMock.mockResolvedValue({
        questions: [createQuestion('Recovered question stem')],
        description: 'Recovered description',
        aiUsed: false,
        cost: undefined,
        warning: undefined,
    })
    extractQuestionsFromDocumentTextPreciselyMock.mockResolvedValue({
        detectedAsMcqDocument: false,
        answerHintCount: 0,
        candidateBlockCount: 0,
        questions: [],
        expectedQuestionCount: null,
        exactMatchAchieved: false,
        invalidQuestionNumbers: [],
        missingQuestionNumbers: [],
        duplicateQuestionNumbers: [],
        aiRepairUsed: false,
        cost: undefined,
        error: false,
        message: undefined,
    })
    uploadPdfReferenceSnapshotsMock.mockResolvedValue(new Map())
    uploadManualReferenceSnapshotMock.mockResolvedValue({
        assetUrl: 'https://blob.vercel-storage.com/manual-reference.png',
        bbox: null,
    })
    getPdfPageCountMock.mockResolvedValue(12)
})

test('generateAdminTestFromDocument persists per-question evidence and durable import diagnostics', async () => {
    const { generateAdminTestFromDocument } = await servicePromise

    const result = await generateAdminTestFromDocument({
        adminId: 'admin-1',
        file: createFile(),
        ipAddress: '127.0.0.1',
    })

    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(prismaMock.test.create).toHaveBeenCalledTimes(1)
    const createCall = prismaMock.test.create.mock.calls[0][0]
    const questionCreate = createCall.data.questions.create[0]

    expect(questionCreate.importEvidence).toEqual({
        sourcePage: 2,
        sourceSnippet: 'Recovered question stem source',
        sharedContextEvidence: null,
        answerSource: 'ANSWER_KEY',
        confidence: 0.94,
        extractionMode: 'TEXT_EXACT',
        referenceKind: 'NONE',
        referenceMode: 'TEXT',
        referenceTitle: null,
        referenceAssetUrl: null,
    })
    expect(prismaMock.questionReference.create).not.toHaveBeenCalled()
    expect(prismaMock.questionReferenceLink.createMany).not.toHaveBeenCalled()

    expect(createCall.data.importDiagnostics).toMatchObject({
        fileName: 'history.docx',
        strategy: 'EXTRACTED',
        parserStatus: 'OK',
        decision: 'EXACT_ACCEPTED',
        failureReason: null,
        routingMode: 'CLASSIFIER',
        selectedStrategy: 'TEXT_EXACT',
        extractedQuestionCandidates: 1,
        extractedQuestions: 1,
        questionsGenerated: 1,
        reviewStatus: null,
        verification: expect.objectContaining({
            passed: true,
            issueSummary: expect.objectContaining({
                structural: 0,
                evidence: 0,
                cross: 0,
            }),
        }),
    })
})

test('generateAdminTestFromDocument rejects PDFs that exceed the page cap before import processing starts', async () => {
    const { generateAdminTestFromDocument } = await servicePromise

    getPdfPageCountMock.mockResolvedValueOnce(61)

    const result = await generateAdminTestFromDocument({
        adminId: 'admin-1',
        file: createFile('large.pdf', 'application/pdf'),
        ipAddress: '127.0.0.1',
    })

    expect(result).toEqual({
        error: true,
        code: 'BAD_REQUEST',
        message: 'PDF too large. Max 60 pages.',
    })
    expect(parseDocumentToTextMock).not.toHaveBeenCalled()
})

test('generateAdminTestFromDocument persists normalized question references when extracted questions include shared context', async () => {
    const { generateAdminTestFromDocument } = await servicePromise
    const referencedQuestion = createQuestion('Read the following data table and answer.', {
        sharedContext: 'Table 1: History timeline',
        sharedContextEvidence: 'Page 2 table',
        referenceKind: 'TABLE',
        referenceMode: 'TEXT',
        referenceTitle: 'History timeline',
    })

    executeDocumentImportPlanMock.mockResolvedValueOnce({
        useLegacyFlow: false,
        strategy: 'EXTRACTED',
        result: {
            error: false,
            message: undefined,
            questions: [referencedQuestion],
            failedCount: 0,
            cost: {
                model: 'gpt-5.4-mini',
                inputTokens: 100,
                outputTokens: 20,
                costUSD: 0.12,
            },
        },
        extracted: {
            detectedAsMcqDocument: true,
            answerHintCount: 1,
            candidateBlockCount: 1,
            questions: [referencedQuestion],
            expectedQuestionCount: 1,
            exactMatchAchieved: true,
            invalidQuestionNumbers: [],
            missingQuestionNumbers: [],
            duplicateQuestionNumbers: [],
            aiRepairUsed: false,
            cost: undefined,
            error: false,
            message: undefined,
        },
        parserStatus: 'OK',
        aiFallbackUsed: false,
        reportParserIssue: false,
        warning: null,
        needsAdminReview: false,
        reviewIssueCount: 0,
    })
    enrichGeneratedQuestionsMetadataMock.mockResolvedValueOnce({
        questions: [referencedQuestion],
        description: 'Recovered description',
        aiUsed: false,
        cost: undefined,
        warning: undefined,
    })

    const result = await generateAdminTestFromDocument({
        adminId: 'admin-1',
        file: createFile('history-table.docx'),
        ipAddress: '127.0.0.1',
    })

    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(prismaMock.questionReference.create).toHaveBeenCalledWith(
        expect.objectContaining({
            data: expect.objectContaining({
                testId: 'test-1',
                kind: 'TABLE',
                mode: 'TEXT',
                title: 'History timeline',
                textContent: 'Table 1: History timeline',
                sourcePage: 2,
            }),
        }),
    )
    expect(prismaMock.questionReferenceLink.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
            data: [
                expect.objectContaining({
                    referenceId: 'reference-1',
                    questionId: 'question-1',
                    order: 1,
                }),
            ],
        }),
    )
})

test('generateAdminTestFromDocument persists snapshot asset urls for visual references when uploads succeed', async () => {
    const { generateAdminTestFromDocument } = await servicePromise
    const referencedQuestion = createQuestion('Find the missing figure.', {
        sharedContext: 'Original diagram on page 2',
        sharedContextEvidence: 'Diagram visible on page 2',
        referenceKind: 'DIAGRAM',
        referenceMode: 'SNAPSHOT',
        referenceTitle: 'Figure completion diagram',
    })

    executeDocumentImportPlanMock.mockResolvedValueOnce({
        useLegacyFlow: false,
        strategy: 'EXTRACTED',
        result: {
            error: false,
            message: undefined,
            questions: [referencedQuestion],
            failedCount: 0,
            cost: {
                model: 'gpt-5.4-mini',
                inputTokens: 100,
                outputTokens: 20,
                costUSD: 0.12,
            },
        },
        extracted: {
            detectedAsMcqDocument: true,
            answerHintCount: 1,
            candidateBlockCount: 1,
            questions: [referencedQuestion],
            expectedQuestionCount: 1,
            exactMatchAchieved: true,
            invalidQuestionNumbers: [],
            missingQuestionNumbers: [],
            duplicateQuestionNumbers: [],
            aiRepairUsed: false,
            cost: undefined,
            error: false,
            message: undefined,
        },
        parserStatus: 'OK',
        aiFallbackUsed: false,
        reportParserIssue: false,
        warning: null,
        needsAdminReview: false,
        reviewIssueCount: 0,
    })
    enrichGeneratedQuestionsMetadataMock.mockResolvedValueOnce({
        questions: [referencedQuestion],
        description: 'Recovered description',
        aiUsed: false,
        cost: undefined,
        warning: undefined,
    })
    uploadPdfReferenceSnapshotsMock.mockResolvedValueOnce(
        new Map([[2, { assetUrl: 'https://blob.vercel-storage.com/reference.png', bbox: null }]]),
    )

    const result = await generateAdminTestFromDocument({
        adminId: 'admin-1',
        file: createFile('figure.pdf', 'application/pdf'),
        ipAddress: '127.0.0.1',
    })

    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(prismaMock.questionReference.create).toHaveBeenCalledWith(
        expect.objectContaining({
            data: expect.objectContaining({
                testId: 'test-1',
                kind: 'DIAGRAM',
                mode: 'SNAPSHOT',
                title: 'Figure completion diagram',
                textContent: 'Original diagram on page 2',
                sourcePage: 2,
                assetUrl: 'https://blob.vercel-storage.com/reference.png',
            }),
        }),
    )
})

test('upsertAdminQuestionReferenceImage creates a new visual reference when none exists', async () => {
    const { upsertAdminQuestionReferenceImage } = await servicePromise

    prismaMock.question.findUnique
        .mockResolvedValueOnce({
            id: 'question-1',
            testId: 'test-1',
            order: 1,
            stem: 'Find the missing figure.',
            sharedContext: 'Original diagram context',
            importEvidence: null,
            options: [
                { id: 'A', text: 'Option A', isCorrect: true },
                { id: 'B', text: 'Option B', isCorrect: false },
                { id: 'C', text: 'Option C', isCorrect: false },
                { id: 'D', text: 'Option D', isCorrect: false },
            ],
            explanation: 'Explanation',
            difficulty: 'MEDIUM',
            topic: 'Reasoning',
            referenceLinks: [],
        })
        .mockResolvedValueOnce({
            id: 'question-1',
            testId: 'test-1',
            order: 1,
            stem: 'Find the missing figure.',
            sharedContext: 'Original diagram context',
            importEvidence: {
                sourcePage: 2,
                sourceSnippet: null,
                sharedContextEvidence: null,
                answerSource: null,
                confidence: null,
                extractionMode: null,
                referenceKind: 'DIAGRAM',
                referenceMode: 'HYBRID',
                referenceTitle: 'Visual reference',
                referenceAssetUrl: 'https://blob.vercel-storage.com/manual-reference.png',
            },
            options: [
                { id: 'A', text: 'Option A', isCorrect: true },
                { id: 'B', text: 'Option B', isCorrect: false },
                { id: 'C', text: 'Option C', isCorrect: false },
                { id: 'D', text: 'Option D', isCorrect: false },
            ],
            explanation: 'Explanation',
            difficulty: 'MEDIUM',
            topic: 'Reasoning',
            referenceLinks: [
                createReferenceLink({
                    assetUrl: 'https://blob.vercel-storage.com/manual-reference.png',
                    mode: 'HYBRID',
                    textContent: 'Original diagram context',
                    title: 'Visual reference',
                }),
            ],
        })

    const result = await upsertAdminQuestionReferenceImage(
        'admin-1',
        'test-1',
        'question-1',
        new File(['png-data'], 'figure.png', { type: 'image/png' }),
    )

    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(uploadManualReferenceSnapshotMock).toHaveBeenCalledWith(
        expect.objectContaining({
            testId: 'test-1',
            questionId: 'question-1',
        }),
    )
    expect(prismaMock.questionReference.create).toHaveBeenCalledWith(
        expect.objectContaining({
            data: expect.objectContaining({
                testId: 'test-1',
                kind: 'DIAGRAM',
                mode: 'HYBRID',
                title: null,
                textContent: 'Original diagram context',
                assetUrl: 'https://blob.vercel-storage.com/manual-reference.png',
            }),
        }),
    )
    expect(prismaMock.questionReferenceLink.create).toHaveBeenCalledWith(
        expect.objectContaining({
            data: expect.objectContaining({
                questionId: 'question-1',
                referenceId: 'reference-1',
                order: 1,
            }),
        }),
    )
    expect(prismaMock.question.update).toHaveBeenCalledWith(
        expect.objectContaining({
            where: { id: 'question-1' },
            data: expect.objectContaining({
                importEvidence: expect.objectContaining({
                    referenceKind: 'DIAGRAM',
                    referenceMode: 'HYBRID',
                    referenceTitle: null,
                    referenceAssetUrl: 'https://blob.vercel-storage.com/manual-reference.png',
                }),
            }),
        }),
    )
    expect(result.question.references).toEqual([
        expect.objectContaining({
            id: 'reference-1',
            kind: 'DIAGRAM',
            mode: 'HYBRID',
            assetUrl: 'https://blob.vercel-storage.com/manual-reference.png',
        }),
    ])
})

test('upsertAdminQuestionReferenceImage updates an existing visual reference in place', async () => {
    const { upsertAdminQuestionReferenceImage } = await servicePromise

    prismaMock.question.findUnique
        .mockResolvedValueOnce({
            id: 'question-1',
            testId: 'test-1',
            order: 1,
            stem: 'Match the figure.',
            sharedContext: 'Existing visual explanation',
            importEvidence: {
                referenceKind: 'DIAGRAM',
                referenceMode: 'SNAPSHOT',
                referenceTitle: 'Existing figure',
                referenceAssetUrl: null,
                sourcePage: 3,
                confidence: 0.92,
            },
            options: [
                { id: 'A', text: 'Option A', isCorrect: true },
                { id: 'B', text: 'Option B', isCorrect: false },
                { id: 'C', text: 'Option C', isCorrect: false },
                { id: 'D', text: 'Option D', isCorrect: false },
            ],
            explanation: 'Explanation',
            difficulty: 'MEDIUM',
            topic: 'Reasoning',
            referenceLinks: [
                createReferenceLink({
                    id: 'reference-existing',
                    assetUrl: null,
                    title: 'Existing figure',
                    textContent: 'Existing visual explanation',
                }),
            ],
        })
        .mockResolvedValueOnce({
            id: 'question-1',
            testId: 'test-1',
            order: 1,
            stem: 'Match the figure.',
            sharedContext: 'Existing visual explanation',
            importEvidence: {
                referenceKind: 'DIAGRAM',
                referenceMode: 'SNAPSHOT',
                referenceTitle: 'Existing figure',
                referenceAssetUrl: 'https://blob.vercel-storage.com/manual-reference.png',
                sourcePage: 3,
                confidence: 0.92,
            },
            options: [
                { id: 'A', text: 'Option A', isCorrect: true },
                { id: 'B', text: 'Option B', isCorrect: false },
                { id: 'C', text: 'Option C', isCorrect: false },
                { id: 'D', text: 'Option D', isCorrect: false },
            ],
            explanation: 'Explanation',
            difficulty: 'MEDIUM',
            topic: 'Reasoning',
            referenceLinks: [
                createReferenceLink({
                    id: 'reference-existing',
                    assetUrl: 'https://blob.vercel-storage.com/manual-reference.png',
                    title: 'Existing figure',
                    textContent: 'Existing visual explanation',
                }),
            ],
        })

    const result = await upsertAdminQuestionReferenceImage(
        'admin-1',
        'test-1',
        'question-1',
        new File(['png-data'], 'replacement.png', { type: 'image/png' }),
    )

    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(prismaMock.questionReference.update).toHaveBeenCalledWith(
        expect.objectContaining({
            where: { id: 'reference-existing' },
            data: expect.objectContaining({
                kind: 'DIAGRAM',
                mode: 'SNAPSHOT',
                title: 'Existing figure',
                textContent: 'Existing visual explanation',
                assetUrl: 'https://blob.vercel-storage.com/manual-reference.png',
            }),
        }),
    )
    expect(prismaMock.questionReference.create).not.toHaveBeenCalled()
    expect(prismaMock.questionReferenceLink.create).not.toHaveBeenCalled()
    expect(result.question.references).toEqual([
        expect.objectContaining({
            id: 'reference-existing',
            assetUrl: 'https://blob.vercel-storage.com/manual-reference.png',
        }),
    ])
})

test('upsertAdminQuestionReferenceImage prefers the linked visual slot over a shared table placeholder', async () => {
    const { upsertAdminQuestionReferenceImage } = await servicePromise

    prismaMock.question.findUnique
        .mockResolvedValueOnce({
            id: 'question-1',
            testId: 'test-1',
            order: 1,
            stem: 'Analyse the illustration.',
            sharedContext: 'Use the shared data table and the figure.',
            importEvidence: {
                referenceKind: 'DIAGRAM',
                referenceMode: 'SNAPSHOT',
                referenceTitle: 'Question figure',
                referenceAssetUrl: null,
                sourcePage: 4,
                confidence: 0.9,
            },
            options: [
                { id: 'A', text: 'Option A', isCorrect: true },
                { id: 'B', text: 'Option B', isCorrect: false },
                { id: 'C', text: 'Option C', isCorrect: false },
                { id: 'D', text: 'Option D', isCorrect: false },
            ],
            explanation: 'Explanation',
            difficulty: 'MEDIUM',
            topic: 'Accountancy',
            referenceLinks: [
                {
                    order: 1,
                    reference: {
                        id: 'reference-table',
                        kind: 'TABLE',
                        mode: 'HYBRID',
                        title: 'Data table',
                        textContent: 'Opening stock | Purchases | Closing stock',
                        assetUrl: null,
                        sourcePage: 4,
                        bbox: null,
                        confidence: 0.88,
                        evidence: null,
                    },
                },
                {
                    order: 2,
                    reference: {
                        id: 'reference-diagram',
                        kind: 'DIAGRAM',
                        mode: 'SNAPSHOT',
                        title: 'Question figure',
                        textContent: null,
                        assetUrl: null,
                        sourcePage: 4,
                        bbox: null,
                        confidence: 0.9,
                        evidence: null,
                    },
                },
            ],
        })
        .mockResolvedValueOnce({
            id: 'question-1',
            testId: 'test-1',
            order: 1,
            stem: 'Analyse the illustration.',
            sharedContext: 'Use the shared data table and the figure.',
            importEvidence: {
                referenceKind: 'DIAGRAM',
                referenceMode: 'SNAPSHOT',
                referenceTitle: 'Question figure',
                referenceAssetUrl: 'https://blob.vercel-storage.com/manual-reference.png',
                sourcePage: 4,
                confidence: 0.9,
            },
            options: [
                { id: 'A', text: 'Option A', isCorrect: true },
                { id: 'B', text: 'Option B', isCorrect: false },
                { id: 'C', text: 'Option C', isCorrect: false },
                { id: 'D', text: 'Option D', isCorrect: false },
            ],
            explanation: 'Explanation',
            difficulty: 'MEDIUM',
            topic: 'Accountancy',
            referenceLinks: [
                {
                    order: 1,
                    reference: {
                        id: 'reference-table',
                        kind: 'TABLE',
                        mode: 'HYBRID',
                        title: 'Data table',
                        textContent: 'Opening stock | Purchases | Closing stock',
                        assetUrl: null,
                        sourcePage: 4,
                        bbox: null,
                        confidence: 0.88,
                        evidence: null,
                    },
                },
                {
                    order: 2,
                    reference: {
                        id: 'reference-diagram',
                        kind: 'DIAGRAM',
                        mode: 'SNAPSHOT',
                        title: 'Question figure',
                        textContent: null,
                        assetUrl: 'https://blob.vercel-storage.com/manual-reference.png',
                        sourcePage: 4,
                        bbox: null,
                        confidence: 0.9,
                        evidence: null,
                    },
                },
            ],
        })

    const result = await upsertAdminQuestionReferenceImage(
        'admin-1',
        'test-1',
        'question-1',
        new File(['png-data'], 'replacement.png', { type: 'image/png' }),
    )

    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(prismaMock.questionReference.update).toHaveBeenCalledWith(
        expect.objectContaining({
            where: { id: 'reference-diagram' },
            data: expect.objectContaining({
                kind: 'DIAGRAM',
                mode: 'SNAPSHOT',
                title: 'Question figure',
                assetUrl: 'https://blob.vercel-storage.com/manual-reference.png',
            }),
        }),
    )
    expect(prismaMock.questionReference.create).not.toHaveBeenCalled()
    expect(result.question.references).toEqual([
        expect.objectContaining({
            id: 'reference-table',
            kind: 'TABLE',
            assetUrl: null,
        }),
        expect.objectContaining({
            id: 'reference-diagram',
            kind: 'DIAGRAM',
            assetUrl: 'https://blob.vercel-storage.com/manual-reference.png',
        }),
    ])
})

test('upsertAdminQuestionReferenceImage rejects updates for published tests', async () => {
    const { upsertAdminQuestionReferenceImage } = await servicePromise

    prismaMock.test.findUnique.mockResolvedValueOnce({
        id: 'test-1',
        status: 'PUBLISHED',
    })

    const result = await upsertAdminQuestionReferenceImage(
        'admin-1',
        'test-1',
        'question-1',
        new File(['png-data'], 'figure.png', { type: 'image/png' }),
    )

    expect(result).toEqual(
        expect.objectContaining({
            error: true,
            code: 'NOT_EDITABLE',
        }),
    )
    expect(prismaMock.question.findUnique).not.toHaveBeenCalled()
    expect(uploadManualReferenceSnapshotMock).not.toHaveBeenCalled()
})

test('removeAdminQuestionReferenceImage removes the asset but preserves sanitized text fallback', async () => {
    const { removeAdminQuestionReferenceImage } = await servicePromise

    prismaMock.question.findUnique
        .mockResolvedValueOnce({
            id: 'question-1',
            testId: 'test-1',
            order: 1,
            stem: 'Find the missing figure.',
            sharedContext: 'Original diagram context',
            importEvidence: {
                referenceKind: 'DIAGRAM',
                referenceMode: 'HYBRID',
                referenceTitle: 'Manual visual reference',
                referenceAssetUrl: 'https://blob.vercel-storage.com/manual-reference.png',
            },
            options: [
                { id: 'A', text: 'Option A', isCorrect: true },
                { id: 'B', text: 'Option B', isCorrect: false },
                { id: 'C', text: 'Option C', isCorrect: false },
                { id: 'D', text: 'Option D', isCorrect: false },
            ],
            explanation: 'Explanation',
            difficulty: 'MEDIUM',
            topic: 'Reasoning',
            referenceLinks: [
                createReferenceLink({
                    id: 'reference-existing',
                    mode: 'HYBRID',
                    title: 'Manual visual reference',
                    textContent: 'Original diagram context',
                    assetUrl: 'https://blob.vercel-storage.com/manual-reference.png',
                }),
            ],
        })
        .mockResolvedValueOnce({
            id: 'question-1',
            testId: 'test-1',
            order: 1,
            stem: 'Find the missing figure.',
            sharedContext: 'Original diagram context',
            importEvidence: {
                referenceKind: 'DIAGRAM',
                referenceMode: 'TEXT',
                referenceTitle: null,
                referenceAssetUrl: null,
            },
            options: [
                { id: 'A', text: 'Option A', isCorrect: true },
                { id: 'B', text: 'Option B', isCorrect: false },
                { id: 'C', text: 'Option C', isCorrect: false },
                { id: 'D', text: 'Option D', isCorrect: false },
            ],
            explanation: 'Explanation',
            difficulty: 'MEDIUM',
            topic: 'Reasoning',
            referenceLinks: [
                createReferenceLink({
                    id: 'reference-existing',
                    mode: 'TEXT',
                    title: null,
                    textContent: 'Original diagram context',
                    assetUrl: null,
                }),
            ],
        })

    const result = await removeAdminQuestionReferenceImage(
        'admin-1',
        'test-1',
        'question-1',
    )

    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(prismaMock.questionReference.update).toHaveBeenCalledWith(
        expect.objectContaining({
            where: { id: 'reference-existing' },
            data: expect.objectContaining({
                mode: 'TEXT',
                assetUrl: null,
                textContent: 'Original diagram context',
            }),
        }),
    )
    expect(prismaMock.questionReferenceLink.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.questionReference.delete).not.toHaveBeenCalled()
    expect(prismaMock.question.update).toHaveBeenCalledWith(
        expect.objectContaining({
            where: { id: 'question-1' },
            data: expect.objectContaining({
                importEvidence: expect.objectContaining({
                    referenceAssetUrl: null,
                    referenceMode: 'TEXT',
                }),
            }),
        }),
    )
    expect(result.question.references).toEqual([
        expect.objectContaining({
            id: 'reference-existing',
            mode: 'TEXT',
            assetUrl: null,
            textContent: 'Original diagram context',
        }),
    ])
})

test('enrichImportedTestReferencesAfterDraft sanitizes leaked shared context before persisting references', async () => {
    const { enrichImportedTestReferencesAfterDraft } = await servicePromise

    prismaMock.test.findUnique.mockResolvedValueOnce({
        id: 'test-1',
        createdById: 'admin-1',
        questions: [
            {
                id: 'question-1',
                order: 1,
                stem: 'Cash Flow Statement is primarily prepared to show',
                sharedContext: null,
                importEvidence: {
                    sourcePage: 2,
                    sourceSnippet: 'Cash Flow Statement is primarily prepared to show',
                    sharedContextEvidence: null,
                    answerSource: 'ANSWER_KEY',
                    confidence: 0.95,
                    extractionMode: 'TEXT_EXACT',
                    referenceKind: 'NONE',
                    referenceMode: 'TEXT',
                    referenceTitle: null,
                    referenceAssetUrl: null,
                },
                options: [
                    { id: 'A', text: 'Only profit or loss for the period', isCorrect: false },
                    { id: 'B', text: 'Inflows and outflows of cash', isCorrect: true },
                    { id: 'C', text: 'Cash balance only', isCorrect: false },
                    { id: 'D', text: 'Owner equity only', isCorrect: false },
                ],
                explanation: 'Explanation',
                difficulty: 'MEDIUM',
                topic: 'Accountancy',
            },
        ],
    })

    attachSharedContextsFromPdfMock.mockResolvedValueOnce([
        createQuestion('Cash Flow Statement is primarily prepared to show', {
            sharedContext: '(c) Changes in short-term borrowings\n(d) Only interest paid\nANSWER (a) Expenditures made for resources intended to generate future income and cash flows',
            referenceKind: 'TABLE',
            referenceMode: 'TEXT',
            referenceTitle: 'Reference 1',
            sharedContextEvidence: 'Page 2',
        }),
    ])
    uploadPdfReferenceSnapshotsMock.mockResolvedValueOnce(new Map())

    const result = await enrichImportedTestReferencesAfterDraft({
        adminId: 'admin-1',
        testId: 'test-1',
        file: createFile('accountancy-5.pdf', 'application/pdf'),
        fileName: 'ACCOUNTANCY 5.pdf',
    })

    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(prismaMock.question.update).toHaveBeenCalledWith(
        expect.objectContaining({
            where: { id: 'question-1' },
            data: expect.objectContaining({
                sharedContext: null,
            }),
        }),
    )
    expect(prismaMock.questionReference.create).not.toHaveBeenCalled()
    expect(prismaMock.questionReferenceLink.createMany).not.toHaveBeenCalled()
})

test('generateAdminTestFromDocument persists review-required diagnostics to the draft and audit log', async () => {
    const { generateAdminTestFromDocument } = await servicePromise

    verifyExtractedQuestionsMock.mockReturnValue(createVerification({
        passed: true,
        reviewRecommended: true,
        issues: [
            {
                questionNumber: 1,
                issue: 'Low confidence',
                category: 'EVIDENCE',
                severity: 'WARNING',
                code: 'LOW_CONFIDENCE',
            },
        ],
        issueSummary: {
            structural: 0,
            evidence: 1,
            cross: 0,
            errors: 0,
            warnings: 1,
        },
    }))

    const result = await generateAdminTestFromDocument({
        adminId: 'admin-1',
        file: createFile('review.docx'),
        ipAddress: '127.0.0.1',
    })

    expect('error' in result).toBe(false)
    if ('error' in result) return

    const createCall = prismaMock.test.create.mock.calls[0][0]
    expect(createCall.data.reviewStatus).toBe('NEEDS_REVIEW')
    expect(createCall.data.importDiagnostics).toMatchObject({
        fileName: 'review.docx',
        decision: 'REVIEW_REQUIRED',
        reviewRequired: true,
        reviewIssueCount: 1,
        reviewStatus: 'NEEDS_REVIEW',
        reportParserIssue: true,
        verification: expect.objectContaining({
            reviewRecommended: true,
            issues: [
                expect.objectContaining({
                    code: 'LOW_CONFIDENCE',
                    category: 'EVIDENCE',
                    severity: 'WARNING',
                }),
            ],
        }),
    })

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
            metadata: expect.objectContaining({
                decision: 'REVIEW_REQUIRED',
                reviewStatus: 'NEEDS_REVIEW',
                reviewIssueCount: 1,
            }),
        }),
    }))
})

test('generateAdminTestFromDocument fails fast when verification reports structural errors', async () => {
    const { generateAdminTestFromDocument } = await servicePromise

    verifyExtractedQuestionsMock.mockReturnValue(createVerification({
        passed: false,
        reviewRecommended: true,
        issues: [
            {
                questionNumber: 0,
                issue: 'Missing numbered questions: 49, 50',
                category: 'STRUCTURAL',
                severity: 'ERROR',
                code: 'NUMBERING_GAP',
            },
        ],
        issueSummary: {
            structural: 1,
            evidence: 0,
            cross: 0,
            errors: 1,
            warnings: 0,
        },
    }))

    const result = await generateAdminTestFromDocument({
        adminId: 'admin-1',
        file: createFile('broken.docx'),
        ipAddress: '127.0.0.1',
    })

    expect('error' in result).toBe(true)
    if (!('error' in result)) return

    expect(result.code).toBe('PARSE_ERROR')
    expect(result.message).toContain('Missing numbered questions')
    expect(prismaMock.test.create).not.toHaveBeenCalled()
})

test('generateAdminTestFromDocument keeps partially recovered imports for review when enough valid questions survive', async () => {
    const { generateAdminTestFromDocument } = await servicePromise

    const recoveredQuestions = Array.from({ length: 18 }, (_, index) => (
        createQuestion(`Recovered question ${index + 1}`)
    ))

    executeDocumentImportPlanMock.mockResolvedValueOnce({
        useLegacyFlow: false,
        strategy: 'EXTRACTED',
        result: {
            error: false,
            message: 'Chunked multimodal extraction skipped 1 page chunk while recovering the question set.',
            questions: recoveredQuestions,
            failedCount: 12,
            cost: {
                model: 'gpt-5.4',
                inputTokens: 240,
                outputTokens: 48,
                costUSD: 0.31,
            },
        },
        extracted: {
            detectedAsMcqDocument: true,
            answerHintCount: 18,
            candidateBlockCount: 30,
            questions: recoveredQuestions,
            expectedQuestionCount: 30,
            exactMatchAchieved: false,
            invalidQuestionNumbers: [],
            missingQuestionNumbers: [19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
            duplicateQuestionNumbers: [],
            aiRepairUsed: false,
            cost: undefined,
            error: false,
            message: undefined,
        },
        parserStatus: 'WEAK_OUTPUT',
        aiFallbackUsed: true,
        reportParserIssue: true,
        warning: 'Recovered the usable pages but one extraction chunk failed.',
        needsAdminReview: false,
        reviewIssueCount: 0,
    })
    verifyExtractedQuestionsMock.mockReturnValueOnce(createVerification({
        totalQuestions: 18,
        validQuestions: 18,
        passed: false,
        reviewRecommended: true,
        issues: [
            {
                questionNumber: 0,
                issue: 'Missing numbered questions: 19-30',
                category: 'STRUCTURAL',
                severity: 'ERROR',
                code: 'NUMBERING_GAP',
            },
        ],
        issueSummary: {
            structural: 1,
            evidence: 0,
            cross: 0,
            errors: 1,
            warnings: 0,
        },
    }))
    enrichGeneratedQuestionsMetadataMock.mockResolvedValueOnce({
        questions: recoveredQuestions,
        description: 'Recovered description',
        aiUsed: true,
        cost: undefined,
        warning: undefined,
    })

    const result = await generateAdminTestFromDocument({
        adminId: 'admin-1',
        file: createFile('partial.pdf', 'application/pdf'),
        ipAddress: '127.0.0.1',
    })

    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(result.test.reviewStatus).toBe('NEEDS_REVIEW')
    expect(result.importDiagnostics).toMatchObject({
        decision: 'PARTIAL',
        reviewRequired: true,
        reviewStatus: 'NEEDS_REVIEW',
        extractedQuestions: 18,
        failedCount: 12,
    })
    expect(result.importDiagnostics.failureReason).toContain('Recovered 18 usable question(s) from an expected 30')

    const createCall = prismaMock.test.create.mock.calls.at(-1)?.[0]
    expect(createCall?.data.importDiagnostics.warning).toContain('Chunked multimodal extraction skipped 1 page chunk')
})

test('generateAdminTestFromDocument runs inline AI verification and metadata enrichment for classifier imports', async () => {
    const { generateAdminTestFromDocument } = await servicePromise

    const extractedQuestions = Array.from({ length: 50 }, (_, index) =>
        createQuestion(`Recovered question ${index + 1}`, {
            topic: 'Reasoning',
            difficulty: index % 3 === 0 ? 'EASY' : index % 3 === 1 ? 'MEDIUM' : 'HARD',
        }),
    )

    executeDocumentImportPlanMock.mockResolvedValue({
        useLegacyFlow: false,
        strategy: 'EXTRACTED',
        result: {
            error: false,
            message: undefined,
            questions: extractedQuestions,
            failedCount: 0,
            cost: {
                model: 'gpt-5.4',
                inputTokens: 500,
                outputTokens: 100,
                costUSD: 0.75,
            },
        },
        extracted: {
            detectedAsMcqDocument: true,
            answerHintCount: 50,
            candidateBlockCount: 50,
            questions: extractedQuestions,
            expectedQuestionCount: 50,
            exactMatchAchieved: true,
            invalidQuestionNumbers: [],
            missingQuestionNumbers: [],
            duplicateQuestionNumbers: [],
            aiRepairUsed: false,
            cost: undefined,
            error: false,
            message: undefined,
        },
        parserStatus: 'OK',
        aiFallbackUsed: false,
        reportParserIssue: false,
        warning: null,
        needsAdminReview: false,
        reviewIssueCount: 0,
    })
    enrichGeneratedQuestionsMetadataMock.mockResolvedValueOnce({
        questions: extractedQuestions,
        description: 'Reasoning import summary',
        aiUsed: true,
        cost: {
            model: 'gpt-5.4-mini',
            inputTokens: 90,
            outputTokens: 18,
            costUSD: 0.11,
        },
        warning: undefined,
    })

    const result = await generateAdminTestFromDocument({
        adminId: 'admin-1',
        file: createFile('reasoning.pdf'),
        ipAddress: '127.0.0.1',
    })

    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(verifyExtractedQuestionsWithAIMock).toHaveBeenCalledOnce()
    expect(enrichGeneratedQuestionsMetadataMock).toHaveBeenCalledOnce()

    const createCall = prismaMock.test.create.mock.calls.at(-1)?.[0]
    expect(createCall?.data.importDiagnostics).toMatchObject({
        fileName: 'reasoning.pdf',
        metadataAiUsed: true,
        extractedQuestions: 50,
        questionsGenerated: 50,
    })
})

test('generateAdminTestFromDocument defers PDF reference enrichment out of the critical path when requested', async () => {
    const { generateAdminTestFromDocument } = await servicePromise

    const pdfQuestions = [
        createQuestion('Recovered PDF question stem', {
            referenceKind: 'DIAGRAM',
            referenceMode: 'SNAPSHOT',
            referenceTitle: 'Figure 1',
        }),
    ]

    executeDocumentImportPlanMock.mockResolvedValueOnce({
        useLegacyFlow: false,
        strategy: 'EXTRACTED',
        result: {
            error: false,
            message: undefined,
            questions: pdfQuestions,
            failedCount: 0,
            cost: {
                model: 'gpt-5.4',
                inputTokens: 120,
                outputTokens: 24,
                costUSD: 0.18,
            },
        },
        extracted: {
            detectedAsMcqDocument: true,
            answerHintCount: 1,
            candidateBlockCount: 1,
            questions: pdfQuestions,
            expectedQuestionCount: 1,
            exactMatchAchieved: true,
            invalidQuestionNumbers: [],
            missingQuestionNumbers: [],
            duplicateQuestionNumbers: [],
            aiRepairUsed: false,
            cost: undefined,
            error: false,
            message: undefined,
        },
        parserStatus: 'OK',
        aiFallbackUsed: false,
        reportParserIssue: false,
        warning: null,
        needsAdminReview: false,
        reviewIssueCount: 0,
    })
    enrichGeneratedQuestionsMetadataMock.mockResolvedValueOnce({
        questions: pdfQuestions,
        description: 'Recovered PDF description',
        aiUsed: false,
        cost: undefined,
        warning: undefined,
    })

    const result = await generateAdminTestFromDocument({
        adminId: 'admin-1',
        file: createFile('visual.pdf', 'application/pdf'),
        ipAddress: '127.0.0.1',
        deferReferenceEnrichment: true,
    })

    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(executeDocumentImportPlanMock).toHaveBeenCalledWith(
        expect.objectContaining({
            deferReferenceEnrichment: true,
            isPdfUpload: true,
        }),
        expect.any(Object),
    )
    expect(attachSharedContextsFromPdfMock).not.toHaveBeenCalled()
    expect(result.importDiagnostics.referenceEnrichmentDeferred).toBe(true)
    const createCall = prismaMock.test.create.mock.calls.at(-1)?.[0]
    expect(createCall?.data.importDiagnostics).toMatchObject({
        referenceEnrichmentDeferred: true,
    })
})

test('generateAdminTestFromDocument creates a draft from exact extraction first for recoverable diagram PDFs', async () => {
    const { generateAdminTestFromDocument } = await servicePromise

    classifyDocumentForImportMock.mockReturnValue({
        ...createClassification(),
        hasVisualReferences: true,
        hasDiagramReasoning: true,
        preferredStrategy: 'HYBRID_RECONCILE',
    })
    resolveDocumentImportPlanMock.mockReturnValue({
        routingMode: 'CLASSIFIER',
        lane: 'ADVANCED',
        selectedStrategy: 'HYBRID_RECONCILE',
        runMultimodalFirst: false,
        visualReferenceOverlay: false,
        manualVisualReferenceCapture: true,
        generateFromSource: false,
        reasons: ['visual reasoning pdf'],
    })
    parseDocumentToTextMock.mockResolvedValueOnce('Question 1 text '.repeat(8))
    extractQuestionsFromDocumentTextPreciselyMock.mockResolvedValueOnce({
        detectedAsMcqDocument: true,
        answerHintCount: 1,
        candidateBlockCount: 1,
        questions: [createQuestion('Recovered visual question')],
        expectedQuestionCount: 1,
        exactMatchAchieved: true,
        invalidQuestionNumbers: [],
        missingQuestionNumbers: [],
        duplicateQuestionNumbers: [],
        aiRepairUsed: false,
        cost: undefined,
        error: false,
        message: undefined,
    })
    executeDocumentImportPlanMock.mockImplementationOnce(async (_input, handlers) => {
        const extracted = await handlers.extractTextExact()
        return {
            useLegacyFlow: false,
            strategy: 'EXTRACTED',
            result: {
                error: false,
                message: undefined,
                questions: extracted.questions,
                failedCount: 0,
                cost: undefined,
                verification: createVerification(),
            },
            parserStatus: 'OK',
            aiFallbackUsed: false,
            reportParserIssue: false,
            warning: 'Created the draft from text extraction. Questions that depend on figures or diagrams are marked for manual image attachment.',
            needsAdminReview: true,
            reviewIssueCount: 1,
        }
    })

    const result = await generateAdminTestFromDocument({
        adminId: 'admin-1',
        file: createFile('figure-completion.pdf', 'application/pdf'),
        ipAddress: '127.0.0.1',
    })

    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(extractQuestionsFromDocumentTextPreciselyMock).toHaveBeenCalled()
    expect(extractQuestionsFromDocumentTextPreciselyMock).toHaveBeenCalledWith(
        expect.any(String),
        'admin-1',
        undefined,
    )
    expect(extractQuestionsFromPdfMultimodalMock).not.toHaveBeenCalled()
    expect(result.strategy).toBe('EXTRACTED')
    expect(result.test.reviewStatus).toBe('NEEDS_REVIEW')
})

test('generateAdminTestFromDocument prefers chunked multimodal extraction for scanned-like weak diagram PDFs', async () => {
    const { generateAdminTestFromDocument } = await servicePromise

    classifyDocumentForImportMock.mockReturnValue({
        ...createClassification(),
        hasVisualReferences: true,
        hasDiagramReasoning: true,
        isScannedLike: true,
        preferredStrategy: 'MULTIMODAL_EXTRACT',
    })
    resolveDocumentImportPlanMock.mockReturnValue({
        routingMode: 'CLASSIFIER',
        lane: 'ADVANCED',
        selectedStrategy: 'MULTIMODAL_EXTRACT',
        runMultimodalFirst: true,
        visualReferenceOverlay: false,
        generateFromSource: false,
        reasons: ['visual reasoning pdf'],
    })
    executeDocumentImportPlanMock.mockResolvedValueOnce({ useLegacyFlow: true })
    extractQuestionsFromDocumentTextPreciselyMock.mockResolvedValueOnce({
        detectedAsMcqDocument: false,
        answerHintCount: 0,
        candidateBlockCount: 10,
        questions: [createQuestion('Only recovered question')],
        expectedQuestionCount: null,
        exactMatchAchieved: false,
        invalidQuestionNumbers: [],
        missingQuestionNumbers: [],
        duplicateQuestionNumbers: [],
        aiRepairUsed: false,
        cost: undefined,
        error: true,
        message: 'Weak parser output',
    })
    extractQuestionsFromPdfMultimodalMock.mockResolvedValueOnce({
        error: false,
        message: undefined,
        questions: [createQuestion('Recovered visual question')],
        failedCount: 0,
        cost: undefined,
        verification: createVerification(),
        pageCount: 5,
        chunkCount: 3,
    })

    const result = await generateAdminTestFromDocument({
        adminId: 'admin-1',
        file: createFile('venn.pdf', 'application/pdf'),
        ipAddress: '127.0.0.1',
    })

    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(extractQuestionsFromPdfMultimodalMock).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.any(Number),
        'admin-1',
        'venn.pdf',
        {
            preferChunkedVisualExtraction: true,
            allowOneShotFallbackAfterChunked: false,
        },
    )
})
