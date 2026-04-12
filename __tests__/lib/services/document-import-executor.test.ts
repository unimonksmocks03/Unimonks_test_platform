import { expect, test, vi } from 'vitest'

import type { GeneratedQuestion, PreciseDocumentQuestionAnalysis } from '@/lib/services/ai-service.types'
import type { VerificationIssue, VerificationResult } from '@/lib/services/ai-extraction-schemas'
import { executeDocumentImportPlan } from '@/lib/services/document-import-executor'
import type { DocumentImportPlan } from '@/lib/services/document-import-strategy'

type ExecutionHandlers = Parameters<typeof executeDocumentImportPlan>[1]

function createVerificationResult(overrides: Partial<VerificationResult> = {}) {
    return {
        ...baseVerificationResult(),
        ...overrides,
    }
}

function baseVerificationResult(): VerificationResult {
    return {
        totalQuestions: 1,
        validQuestions: 1,
        issues: [],
        passed: true,
        issueSummary: {
            structural: 0,
            evidence: 0,
            cross: 0,
            errors: 0,
            warnings: 0,
        },
    }
}

function createQuestion(stem: string): GeneratedQuestion {
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
        topic: 'General',
        extractionMode: 'TEXT_EXACT',
        answerSource: 'ANSWER_KEY',
        sourceSnippet: stem,
        confidence: 0.98,
    }
}

function createVerificationIssue(overrides: Partial<VerificationIssue> = {}): VerificationIssue {
    return {
        code: 'MISSING_SOURCE_SNIPPET',
        issue: 'Question has no source snippet evidence attached',
        category: 'EVIDENCE',
        severity: 'ERROR',
        questionNumber: 1,
        ...overrides,
    }
}

function createExactExtraction(overrides: Partial<PreciseDocumentQuestionAnalysis> = {}): PreciseDocumentQuestionAnalysis {
    return {
        detectedAsMcqDocument: true,
        answerHintCount: 1,
        candidateBlockCount: 1,
        questions: [createQuestion('Recovered exact question')],
        expectedQuestionCount: 1,
        exactMatchAchieved: true,
        invalidQuestionNumbers: [],
        missingQuestionNumbers: [],
        duplicateQuestionNumbers: [],
        aiRepairUsed: false,
        cost: undefined,
        error: false,
        message: undefined,
        ...overrides,
    }
}

const multimodalFirstPlan: DocumentImportPlan = {
    routingMode: 'CLASSIFIER',
    selectedStrategy: 'MULTIMODAL_EXTRACT',
    runMultimodalFirst: true,
    visualReferenceOverlay: false,
    generateFromSource: false,
    reasons: ['table heavy'],
}

const sourceGenerationPlan: DocumentImportPlan = {
    routingMode: 'CLASSIFIER',
    selectedStrategy: 'GENERATE_FROM_SOURCE',
    runMultimodalFirst: false,
    visualReferenceOverlay: false,
    generateFromSource: true,
    reasons: ['source material'],
}

function createVisualReferenceResult() {
    return {
        references: [],
        pageCount: 0,
        chunkCount: 0,
    }
}

function createHandlers(overrides: Partial<ExecutionHandlers> = {}): ExecutionHandlers {
    return {
        extractTextExact: vi.fn().mockResolvedValue(createExactExtraction()),
        extractMultimodal: vi.fn(),
        extractVisualReferences: vi.fn().mockResolvedValue(createVisualReferenceResult()),
        generateFromText: vi.fn(),
        generateFromPdfVision: vi.fn(),
        ...overrides,
    } satisfies ExecutionHandlers
}

test('executeDocumentImportPlan uses exact extraction for TEXT_EXACT strategy', async () => {
    const extractTextExact = vi.fn().mockResolvedValue(createExactExtraction())

    const outcome = await executeDocumentImportPlan(
        {
            plan: {
                routingMode: 'CLASSIFIER',
                selectedStrategy: 'TEXT_EXACT',
                runMultimodalFirst: false,
                visualReferenceOverlay: false,
                generateFromSource: false,
                reasons: ['clean paper'],
            },
            isPdfUpload: true,
            textLength: 2000,
            parseFailed: false,
            generationTarget: 50,
        },
        createHandlers({ extractTextExact }),
    )

    expect(outcome.useLegacyFlow).toBe(false)
    expect(outcome.strategy).toBe('EXTRACTED')
    expect(extractTextExact).toHaveBeenCalledOnce()
})

test('executeDocumentImportPlan accepts a near-complete exact recovery for TEXT_EXACT strategy', async () => {
    const extractTextExact = vi.fn().mockResolvedValue(createExactExtraction({
        candidateBlockCount: 51,
        questions: Array.from({ length: 50 }, (_, index) => createQuestion(`Recovered exact question ${index + 1}`)),
        expectedQuestionCount: 50,
        exactMatchAchieved: false,
        error: true,
        message: 'One candidate block could not be normalized cleanly',
    }))

    const outcome = await executeDocumentImportPlan(
        {
            plan: {
                routingMode: 'CLASSIFIER',
                selectedStrategy: 'TEXT_EXACT',
                runMultimodalFirst: false,
                visualReferenceOverlay: false,
                generateFromSource: false,
                reasons: ['clean paper'],
            },
            isPdfUpload: true,
            textLength: 2400,
            parseFailed: false,
            generationTarget: 50,
        },
        createHandlers({ extractTextExact }),
    )

    expect(outcome.useLegacyFlow).toBe(false)
    expect(outcome.strategy).toBe('EXTRACTED')
    expect(outcome.parserStatus).toBe('WEAK_OUTPUT')
    expect(outcome.result?.questions).toHaveLength(50)
    expect(outcome.result?.failedCount).toBe(0)
})

test('executeDocumentImportPlan accepts a near-complete exact recovery even when format detection stayed conservative', async () => {
    const extractTextExact = vi.fn().mockResolvedValue(createExactExtraction({
        detectedAsMcqDocument: false,
        candidateBlockCount: 51,
        questions: Array.from({ length: 50 }, (_, index) => createQuestion(`Recovered exact question ${index + 1}`)),
        expectedQuestionCount: null,
        exactMatchAchieved: true,
        error: false,
        message: undefined,
    }))

    const outcome = await executeDocumentImportPlan(
        {
            plan: {
                routingMode: 'CLASSIFIER',
                selectedStrategy: 'TEXT_EXACT',
                runMultimodalFirst: false,
                visualReferenceOverlay: false,
                generateFromSource: false,
                reasons: ['clean paper'],
            },
            isPdfUpload: true,
            textLength: 2400,
            parseFailed: false,
            generationTarget: 50,
        },
        createHandlers({ extractTextExact }),
    )

    expect(outcome.useLegacyFlow).toBe(false)
    expect(outcome.strategy).toBe('EXTRACTED')
    expect(outcome.result?.questions).toHaveLength(50)
    expect(outcome.result?.failedCount).toBe(0)
})

test('executeDocumentImportPlan uses multimodal extraction first for risky PDFs', async () => {
    const extractMultimodal = vi.fn().mockResolvedValue({
        mode: 'EXTRACTED',
        questions: [createQuestion('Multimodal question')],
        failedCount: 0,
        pageCount: 4,
        chunkCount: 1,
        verification: createVerificationResult(),
    })
    const extractTextExact = vi.fn()
    const generateFromText = vi.fn()

    const outcome = await executeDocumentImportPlan(
        {
            plan: multimodalFirstPlan,
            isPdfUpload: true,
            textLength: 2400,
            parseFailed: false,
            generationTarget: 50,
        },
        createHandlers({
            extractTextExact,
            extractMultimodal,
            generateFromText,
        }),
    )

    expect(outcome.useLegacyFlow).toBe(false)
    expect(outcome.strategy).toBe('AI_VISION_FALLBACK')
    expect(extractMultimodal).toHaveBeenCalledOnce()
    expect(extractTextExact).not.toHaveBeenCalled()
    expect(generateFromText).not.toHaveBeenCalled()
})

test('executeDocumentImportPlan falls back to exact extraction after multimodal failure', async () => {
    const extractMultimodal = vi.fn().mockResolvedValue({
        mode: 'EXTRACTED',
        error: true,
        message: 'multimodal failed',
        pageCount: 3,
        chunkCount: 1,
        questions: [],
        failedCount: 50,
    })
    const extractTextExact = vi.fn().mockResolvedValue(createExactExtraction())

    const outcome = await executeDocumentImportPlan(
        {
            plan: multimodalFirstPlan,
            isPdfUpload: true,
            textLength: 2400,
            parseFailed: false,
            generationTarget: 50,
        },
        createHandlers({
            extractTextExact,
            extractMultimodal,
        }),
    )

    expect(outcome.useLegacyFlow).toBe(false)
    expect(outcome.strategy).toBe('EXTRACTED')
    expect(extractMultimodal).toHaveBeenCalledOnce()
    expect(extractTextExact).toHaveBeenCalledOnce()
    expect(outcome.result?.questions).toHaveLength(1)
})

test('executeDocumentImportPlan prefers exact extraction when hybrid reconcile finds a fuller set', async () => {
    const extractMultimodal = vi.fn().mockResolvedValue({
        mode: 'EXTRACTED',
        questions: [createQuestion('Multimodal question')],
        failedCount: 0,
        pageCount: 4,
        chunkCount: 1,
        verification: createVerificationResult({
            totalQuestions: 1,
            validQuestions: 0,
            passed: false,
            reviewRecommended: true,
            issues: [createVerificationIssue()],
            issueSummary: {
                structural: 0,
                evidence: 1,
                cross: 0,
                errors: 1,
                warnings: 0,
            },
        }),
    })
    const extractTextExact = vi.fn().mockResolvedValue(createExactExtraction({
        questions: [createQuestion('Exact question 1'), createQuestion('Exact question 2')],
        candidateBlockCount: 2,
        answerHintCount: 2,
        expectedQuestionCount: 2,
    }))

    const outcome = await executeDocumentImportPlan(
        {
            plan: {
                routingMode: 'CLASSIFIER',
                selectedStrategy: 'HYBRID_RECONCILE',
                runMultimodalFirst: true,
                visualReferenceOverlay: false,
                generateFromSource: false,
                reasons: ['borderline pdf'],
            },
            isPdfUpload: true,
            textLength: 2400,
            parseFailed: false,
            generationTarget: 50,
        },
        createHandlers({
            extractTextExact,
            extractMultimodal,
        }),
    )

    expect(outcome.useLegacyFlow).toBe(false)
    expect(outcome.strategy).toBe('EXTRACTED')
    expect(extractMultimodal).toHaveBeenCalledOnce()
    expect(extractTextExact).toHaveBeenCalledOnce()
    expect(outcome.result?.questions).toHaveLength(2)
})

test('executeDocumentImportPlan does not run PDF multimodal extraction for non-PDF hybrid documents', async () => {
    const extractTextExact = vi.fn().mockResolvedValue(createExactExtraction({
        detectedAsMcqDocument: false,
        candidateBlockCount: 50,
        questions: Array.from({ length: 50 }, (_, index) => createQuestion(`Recovered DOCX question ${index + 1}`)),
        expectedQuestionCount: null,
        exactMatchAchieved: true,
        error: false,
        message: undefined,
    }))
    const extractMultimodal = vi.fn()

    const outcome = await executeDocumentImportPlan(
        {
            plan: {
                routingMode: 'CLASSIFIER',
                selectedStrategy: 'HYBRID_RECONCILE',
                runMultimodalFirst: false,
                visualReferenceOverlay: false,
                generateFromSource: false,
                reasons: ['normalized multimodal risk for non-pdf upload'],
            },
            isPdfUpload: false,
            textLength: 2400,
            parseFailed: false,
            generationTarget: 50,
        },
        createHandlers({
            extractTextExact,
            extractMultimodal,
        }),
    )

    expect(outcome.useLegacyFlow).toBe(false)
    expect(outcome.strategy).toBe('EXTRACTED')
    expect(outcome.result?.questions).toHaveLength(50)
    expect(extractMultimodal).not.toHaveBeenCalled()
})

test('executeDocumentImportPlan routes source material directly to generation', async () => {
    const generateFromText = vi.fn().mockResolvedValue({
        questions: [createQuestion('Generated question')],
        failedCount: 0,
        cost: undefined,
    })
    const extractTextExact = vi.fn()

    const outcome = await executeDocumentImportPlan(
        {
            plan: sourceGenerationPlan,
            isPdfUpload: false,
            textLength: 2400,
            parseFailed: false,
            generationTarget: 25,
        },
        createHandlers({
            extractTextExact,
            generateFromText,
        }),
    )

    expect(outcome.useLegacyFlow).toBe(false)
    expect(outcome.strategy).toBe('AI_GENERATED')
    expect(generateFromText).toHaveBeenCalledWith(25)
    expect(extractTextExact).not.toHaveBeenCalled()
})

test('executeDocumentImportPlan uses pdf vision fallback for low-text source PDFs', async () => {
    const generateFromPdfVision = vi.fn().mockResolvedValue({
        mode: 'GENERATED',
        questions: [createQuestion('Recovered from pdf vision generation')],
        failedCount: 0,
        pageCount: 2,
        chunkCount: 1,
    })

    const outcome = await executeDocumentImportPlan(
        {
            plan: sourceGenerationPlan,
            isPdfUpload: true,
            textLength: 20,
            parseFailed: true,
            generationTarget: 25,
        },
        createHandlers({
            extractTextExact: vi.fn(),
            extractMultimodal: vi.fn(),
            generateFromText: vi.fn(),
            generateFromPdfVision,
        }),
    )

    expect(outcome.useLegacyFlow).toBe(false)
    expect(outcome.strategy).toBe('AI_VISION_FALLBACK')
    expect(generateFromPdfVision).toHaveBeenCalledWith(25)
})

test('executeDocumentImportPlan overlays visual references onto exact extraction for diagram-heavy hybrids', async () => {
    const extractTextExact = vi.fn().mockResolvedValue(createExactExtraction({
        questions: [createQuestion('Study the following Venn diagram and answer.')],
        expectedQuestionCount: 1,
        candidateBlockCount: 1,
        answerHintCount: 1,
    }))
    const extractVisualReferences = vi.fn().mockResolvedValue({
        references: [
            {
                questionNumber: 1,
                sharedContext: 'Venn diagram showing overlap between sets A and B.',
                sourcePage: 2,
                sourceSnippet: 'Study the following Venn diagram',
                sharedContextEvidence: 'Question 1 depends on the page 2 Venn diagram.',
                confidence: 0.91,
            },
        ],
        pageCount: 3,
        chunkCount: 2,
    })

    const outcome = await executeDocumentImportPlan(
        {
            plan: {
                routingMode: 'CLASSIFIER',
                selectedStrategy: 'HYBRID_RECONCILE',
                runMultimodalFirst: false,
                visualReferenceOverlay: true,
                generateFromSource: false,
                reasons: ['diagram-heavy pdf'],
            },
            isPdfUpload: true,
            textLength: 2400,
            parseFailed: false,
            generationTarget: 50,
        },
        createHandlers({
            extractTextExact,
            extractVisualReferences,
        }),
    )

    expect(outcome.useLegacyFlow).toBe(false)
    expect(outcome.strategy).toBe('EXTRACTED')
    expect(extractTextExact).toHaveBeenCalledOnce()
    expect(extractVisualReferences).toHaveBeenCalledOnce()
    expect(outcome.result?.questions?.[0]?.sharedContext).toContain('Venn diagram')
    expect(outcome.result?.questions?.[0]?.extractionMode).toBe('HYBRID_RECONCILE')
})

test('executeDocumentImportPlan keeps exact extraction and warns when no visual references are found', async () => {
    const extractTextExact = vi.fn().mockResolvedValue(createExactExtraction({
        questions: [createQuestion('Complete the figure sequence')],
    }))
    const extractVisualReferences = vi.fn().mockResolvedValue(createVisualReferenceResult())

    const outcome = await executeDocumentImportPlan(
        {
            plan: {
                routingMode: 'CLASSIFIER',
                selectedStrategy: 'HYBRID_RECONCILE',
                runMultimodalFirst: false,
                visualReferenceOverlay: true,
                generateFromSource: false,
                reasons: ['figure-completion pdf'],
            },
            isPdfUpload: true,
            textLength: 2400,
            parseFailed: false,
            generationTarget: 50,
        },
        createHandlers({
            extractTextExact,
            extractVisualReferences,
        }),
    )

    expect(outcome.useLegacyFlow).toBe(false)
    expect(outcome.strategy).toBe('EXTRACTED')
    expect(outcome.warning).toContain('no diagram references were detected')
    expect(outcome.needsAdminReview).toBe(false)
})

test('executeDocumentImportPlan marks admin review when visual reference extraction errors', async () => {
    const extractTextExact = vi.fn().mockResolvedValue(createExactExtraction({
        questions: [createQuestion('Study the diagram and answer.')],
    }))
    const extractVisualReferences = vi.fn().mockResolvedValue({
        references: [],
        pageCount: 2,
        chunkCount: 1,
        error: true,
        message: 'Vision extraction failed',
    })

    const outcome = await executeDocumentImportPlan(
        {
            plan: {
                routingMode: 'CLASSIFIER',
                selectedStrategy: 'HYBRID_RECONCILE',
                runMultimodalFirst: false,
                visualReferenceOverlay: true,
                generateFromSource: false,
                reasons: ['diagram-heavy pdf'],
            },
            isPdfUpload: true,
            textLength: 2400,
            parseFailed: false,
            generationTarget: 50,
        },
        createHandlers({
            extractTextExact,
            extractVisualReferences,
        }),
    )

    expect(outcome.useLegacyFlow).toBe(false)
    expect(outcome.strategy).toBe('EXTRACTED')
    expect(outcome.needsAdminReview).toBe(true)
    expect(outcome.warning).toContain('could not confidently recover every diagram context')
})

test('executeDocumentImportPlan does not crash when visual reference extraction throws', async () => {
    const extractTextExact = vi.fn().mockResolvedValue(createExactExtraction({
        questions: [createQuestion('Study the diagram and answer.')],
    }))
    const extractVisualReferences = vi.fn().mockRejectedValue(new Error('canvas runtime failed'))

    const outcome = await executeDocumentImportPlan(
        {
            plan: {
                routingMode: 'CLASSIFIER',
                selectedStrategy: 'HYBRID_RECONCILE',
                runMultimodalFirst: false,
                visualReferenceOverlay: true,
                generateFromSource: false,
                reasons: ['diagram-heavy pdf'],
            },
            isPdfUpload: true,
            textLength: 2400,
            parseFailed: false,
            generationTarget: 50,
        },
        createHandlers({
            extractTextExact,
            extractVisualReferences,
        }),
    )

    expect(outcome.useLegacyFlow).toBe(false)
    expect(outcome.strategy).toBe('EXTRACTED')
    expect(outcome.result?.questions).toHaveLength(1)
    expect(outcome.needsAdminReview).toBe(true)
    expect(outcome.warning).toContain('could not confidently recover every diagram context')
})
