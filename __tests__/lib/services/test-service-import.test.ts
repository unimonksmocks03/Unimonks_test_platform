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
    },
    questionReference: {
        create: vi.fn(),
    },
    questionReferenceLink: {
        createMany: vi.fn(),
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
const attachSharedContextsFromPdfMock = vi.fn()
const enrichGeneratedQuestionsMetadataMock = vi.fn()
const verifyExtractedQuestionsMock = vi.fn()
const verifyExtractedQuestionsWithAIMock = vi.fn()
const classifyDocumentForImportMock = vi.fn()
const resolveDocumentImportPlanMock = vi.fn()
const isClassifierRoutingEnabledMock = vi.fn()
const executeDocumentImportPlanMock = vi.fn()
const uploadPdfReferenceSnapshotsMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
    prisma: prismaMock,
}))

vi.mock('@/lib/services/ai-service', () => ({
    parseDocumentToText: parseDocumentToTextMock,
    extractQuestionsFromDocumentTextPrecisely: extractQuestionsFromDocumentTextPreciselyMock,
    extractQuestionsFromPdfMultimodal: extractQuestionsFromPdfMultimodalMock,
    generateQuestionsFromPdfVisionFallback: generateQuestionsFromPdfVisionFallbackMock,
    generateQuestionsFromText: generateQuestionsFromTextMock,
    attachSharedContextsFromPdf: attachSharedContextsFromPdfMock,
    enrichGeneratedQuestionsMetadata: enrichGeneratedQuestionsMetadataMock,
    verifyExtractedQuestions: verifyExtractedQuestionsMock,
    verifyExtractedQuestionsWithAI: verifyExtractedQuestionsWithAIMock,
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

function createClassification() {
    return {
        documentType: 'MCQ_PAPER',
        layoutRisk: 'LOW',
        hasTables: false,
        hasPassages: false,
        hasMatchFollowing: false,
        hasAssertionReason: false,
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
    prismaMock.questionReference.create.mockResolvedValue({ id: 'reference-1' })
    prismaMock.questionReferenceLink.createMany.mockResolvedValue({ count: 1 })
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
    attachSharedContextsFromPdfMock.mockImplementation(async (_buffer, questions) => questions)
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

test('generateAdminTestFromDocument skips inline AI verification and metadata enrichment for large classifier imports', async () => {
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

    const result = await generateAdminTestFromDocument({
        adminId: 'admin-1',
        file: createFile('reasoning.pdf'),
        ipAddress: '127.0.0.1',
    })

    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(verifyExtractedQuestionsWithAIMock).not.toHaveBeenCalled()
    expect(enrichGeneratedQuestionsMetadataMock).not.toHaveBeenCalled()

    const createCall = prismaMock.test.create.mock.calls.at(-1)?.[0]
    expect(createCall?.data.importDiagnostics).toMatchObject({
        fileName: 'reasoning.pdf',
        metadataAiUsed: false,
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

test('generateAdminTestFromDocument prefers chunked multimodal extraction for hybrid visual PDFs in classifier flow', async () => {
    const { generateAdminTestFromDocument } = await servicePromise

    classifyDocumentForImportMock.mockReturnValue({
        ...createClassification(),
        hasVisualReferences: true,
        preferredStrategy: 'HYBRID_RECONCILE',
    })
    resolveDocumentImportPlanMock.mockReturnValue({
        routingMode: 'CLASSIFIER',
        lane: 'ADVANCED',
        selectedStrategy: 'HYBRID_RECONCILE',
        runMultimodalFirst: false,
        visualReferenceOverlay: false,
        generateFromSource: false,
        reasons: ['visual reasoning pdf'],
    })
    extractQuestionsFromPdfMultimodalMock.mockResolvedValue({
        error: false,
        message: undefined,
        questions: [createQuestion('Recovered visual question')],
        failedCount: 0,
        cost: undefined,
        verification: createVerification(),
        pageCount: 5,
        chunkCount: 3,
    })
    executeDocumentImportPlanMock.mockImplementationOnce(async (_input, handlers) => {
        await handlers.extractMultimodal(50)
        return {
            useLegacyFlow: false,
            strategy: 'AI_VISION_FALLBACK',
            result: {
                error: false,
                message: undefined,
                questions: [createQuestion('Recovered visual question')],
                failedCount: 0,
                cost: undefined,
                verification: createVerification(),
                pageCount: 5,
                chunkCount: 3,
            },
            parserStatus: 'OK',
            aiFallbackUsed: false,
            reportParserIssue: false,
            warning: null,
            needsAdminReview: false,
            reviewIssueCount: 0,
        }
    })

    const result = await generateAdminTestFromDocument({
        adminId: 'admin-1',
        file: createFile('figure-completion.pdf', 'application/pdf'),
        ipAddress: '127.0.0.1',
    })

    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(extractQuestionsFromPdfMultimodalMock).toHaveBeenCalledWith(
        expect.any(Buffer),
        50,
        'admin-1',
        'figure-completion.pdf',
        {
            preferChunkedVisualExtraction: true,
            allowOneShotFallbackAfterChunked: false,
        },
    )
})

test('generateAdminTestFromDocument prefers chunked multimodal extraction for legacy weak visual PDFs', async () => {
    const { generateAdminTestFromDocument } = await servicePromise

    classifyDocumentForImportMock.mockReturnValue({
        ...createClassification(),
        hasVisualReferences: true,
        preferredStrategy: 'HYBRID_RECONCILE',
    })
    resolveDocumentImportPlanMock.mockReturnValue({
        routingMode: 'CLASSIFIER',
        lane: 'ADVANCED',
        selectedStrategy: 'HYBRID_RECONCILE',
        runMultimodalFirst: false,
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
