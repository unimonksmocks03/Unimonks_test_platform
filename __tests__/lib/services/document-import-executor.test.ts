import { afterEach, expect, test, vi } from 'vitest'

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

function createQuestion(stem: string, overrides: Partial<GeneratedQuestion> = {}): GeneratedQuestion {
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
        ...overrides,
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
    lane: 'ADVANCED',
    selectedStrategy: 'MULTIMODAL_EXTRACT',
    runMultimodalFirst: true,
    visualReferenceOverlay: false,
    generateFromSource: false,
    reasons: ['table heavy'],
}

const sourceGenerationPlan: DocumentImportPlan = {
    routingMode: 'CLASSIFIER',
    lane: 'ADVANCED',
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

afterEach(() => {
    vi.useRealTimers()
})

test('executeDocumentImportPlan uses exact extraction for TEXT_EXACT strategy', async () => {
    const extractTextExact = vi.fn().mockResolvedValue(createExactExtraction())

    const outcome = await executeDocumentImportPlan(
        {
            plan: {
                routingMode: 'CLASSIFIER',
                lane: 'STABLE',
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
                lane: 'STABLE',
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
                lane: 'STABLE',
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

test('executeDocumentImportPlan returns legacy flow for stable-lane TEXT_EXACT PDFs when exact parser fails', async () => {
    const extractTextExact = vi.fn().mockResolvedValue(createExactExtraction({
        detectedAsMcqDocument: false,
        candidateBlockCount: 0,
        questions: [],
        expectedQuestionCount: null,
        exactMatchAchieved: false,
        error: true,
        message: 'Parser could not recover any questions',
    }))
    const extractMultimodal = vi.fn()

    const outcome = await executeDocumentImportPlan(
        {
            plan: {
                routingMode: 'CLASSIFIER',
                lane: 'STABLE',
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
        createHandlers({
            extractTextExact,
            extractMultimodal,
        }),
    )

    expect(outcome.useLegacyFlow).toBe(true)
    expect(extractTextExact).toHaveBeenCalledOnce()
    expect(extractMultimodal).not.toHaveBeenCalled()
})

test('executeDocumentImportPlan fails explicitly for stable-lane TEXT_EXACT non-PDFs when exact parser fails', async () => {
    const extractTextExact = vi.fn().mockResolvedValue(createExactExtraction({
        detectedAsMcqDocument: false,
        candidateBlockCount: 0,
        questions: [],
        expectedQuestionCount: null,
        exactMatchAchieved: false,
        error: true,
        message: 'Parser could not recover any questions',
    }))
    const extractMultimodal = vi.fn()

    const outcome = await executeDocumentImportPlan(
        {
            plan: {
                routingMode: 'CLASSIFIER',
                lane: 'STABLE',
                selectedStrategy: 'TEXT_EXACT',
                runMultimodalFirst: false,
                visualReferenceOverlay: false,
                generateFromSource: false,
                reasons: ['clean paper'],
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
    expect(outcome.failure).toBeDefined()
    expect(outcome.failure?.code).toBe('PARSE_ERROR')
    expect(extractTextExact).toHaveBeenCalledOnce()
    expect(extractMultimodal).not.toHaveBeenCalled()
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

test('executeDocumentImportPlan does not run a second visual overlay after multimodal extraction succeeds', async () => {
    const extractMultimodal = vi.fn().mockResolvedValue({
        mode: 'EXTRACTED',
        questions: [createQuestion('Multimodal question')],
        failedCount: 0,
        pageCount: 4,
        chunkCount: 1,
        verification: createVerificationResult(),
    })
    const extractVisualReferences = vi.fn().mockResolvedValue({
        references: [
            {
                questionNumber: 1,
                sharedContext: 'Diagram reference',
                sourcePage: 1,
                sourceSnippet: 'diagram',
                sharedContextEvidence: 'diagram',
                confidence: 0.9,
            },
        ],
        pageCount: 1,
        chunkCount: 1,
    })

    const outcome = await executeDocumentImportPlan(
        {
            plan: {
                ...multimodalFirstPlan,
                visualReferenceOverlay: true,
            },
            isPdfUpload: true,
            textLength: 2400,
            parseFailed: false,
            generationTarget: 50,
        },
        createHandlers({
            extractMultimodal,
            extractVisualReferences,
        }),
    )

    expect(outcome.useLegacyFlow).toBe(false)
    expect(outcome.strategy).toBe('AI_VISION_FALLBACK')
    expect(extractVisualReferences).not.toHaveBeenCalled()
})

test('executeDocumentImportPlan skips visual overlay entirely when reference enrichment is deferred', async () => {
    const extractVisualReferences = vi.fn()

    const outcome = await executeDocumentImportPlan(
        {
            plan: {
                routingMode: 'CLASSIFIER',
                lane: 'ADVANCED',
                selectedStrategy: 'HYBRID_RECONCILE',
                runMultimodalFirst: false,
                visualReferenceOverlay: true,
                generateFromSource: false,
                reasons: ['visual pdf with strong text'],
            },
            isPdfUpload: true,
            textLength: 2400,
            parseFailed: false,
            generationTarget: 50,
            deferReferenceEnrichment: true,
        },
        createHandlers({
            extractTextExact: vi.fn().mockResolvedValue(createExactExtraction({
                questions: [createQuestion('Exact visual question')],
            })),
            extractVisualReferences,
        }),
    )

    expect(outcome.useLegacyFlow).toBe(false)
    expect(outcome.strategy).toBe('EXTRACTED')
    expect(outcome.result?.questions).toHaveLength(1)
    expect(extractVisualReferences).not.toHaveBeenCalled()
})

test('executeDocumentImportPlan returns exact questions immediately for manual visual-reference capture plans', async () => {
    const extractVisualReferences = vi.fn()

    const outcome = await executeDocumentImportPlan(
        {
            plan: {
                routingMode: 'CLASSIFIER',
                lane: 'ADVANCED',
                selectedStrategy: 'HYBRID_RECONCILE',
                runMultimodalFirst: false,
                visualReferenceOverlay: false,
                manualVisualReferenceCapture: true,
                generateFromSource: false,
                reasons: ['diagram-heavy pdf with strong OCR'],
            },
            isPdfUpload: true,
            textLength: 2400,
            parseFailed: false,
            generationTarget: 50,
        },
        createHandlers({
            extractTextExact: vi.fn().mockResolvedValue(createExactExtraction({
                questions: [
                    createQuestion('Q1. Find the missing figure', {
                        sourceSnippet: 'Find the missing figure',
                        referenceKind: 'DIAGRAM',
                        referenceMode: 'SNAPSHOT',
                    }),
                ],
            })),
            extractVisualReferences,
        }),
    )

    expect(outcome.useLegacyFlow).toBe(false)
    expect(outcome.strategy).toBe('EXTRACTED')
    expect(outcome.warning).toContain('manual image attachment')
    expect(extractVisualReferences).not.toHaveBeenCalled()
})

test('executeDocumentImportPlan returns exact questions even when visual reference extraction times out', async () => {
    vi.useFakeTimers()

    const extractVisualReferences = vi.fn().mockImplementation(() => new Promise(() => {}))
    const outcomePromise = executeDocumentImportPlan(
        {
            plan: {
                routingMode: 'CLASSIFIER',
                lane: 'ADVANCED',
                selectedStrategy: 'HYBRID_RECONCILE',
                runMultimodalFirst: false,
                visualReferenceOverlay: true,
                generateFromSource: false,
                reasons: ['visual pdf with strong text'],
            },
            isPdfUpload: true,
            textLength: 2400,
            parseFailed: false,
            generationTarget: 50,
        },
        createHandlers({
            extractTextExact: vi.fn().mockResolvedValue(createExactExtraction({
                questions: [createQuestion('Exact visual question')],
            })),
            extractVisualReferences,
        }),
    )

    await vi.advanceTimersByTimeAsync(45_000)
    const outcome = await outcomePromise

    expect(outcome.useLegacyFlow).toBe(false)
    expect(outcome.strategy).toBe('EXTRACTED')
    expect(outcome.result?.questions).toHaveLength(1)
    expect(outcome.warning).toContain('visual-reference extraction')
    expect(outcome.needsAdminReview).toBe(true)
})

test('executeDocumentImportPlan skips visual overlay when recovered exact extraction already carries figure context', async () => {
    const extractVisualReferences = vi.fn()

    const outcome = await executeDocumentImportPlan(
        {
            plan: {
                routingMode: 'CLASSIFIER',
                lane: 'ADVANCED',
                selectedStrategy: 'HYBRID_RECONCILE',
                runMultimodalFirst: false,
                visualReferenceOverlay: true,
                generateFromSource: false,
                reasons: ['diagram-heavy pdf with strong OCR'],
            },
            isPdfUpload: true,
            textLength: 2400,
            parseFailed: false,
            generationTarget: 50,
        },
        createHandlers({
            extractTextExact: vi.fn().mockResolvedValue(createExactExtraction({
                questions: [
                    createQuestion('Q1. Find the missing figure: /\\ /\\ -- ? --', {
                        sourceSnippet: 'Find the missing figure /\\ /\\ -- ? --',
                    }),
                    createQuestion('Q2. Study the Venn diagram and answer.', {
                        sharedContext: 'Set A overlaps Set B with shaded circle markers.',
                    }),
                    createQuestion('Q3. Count the triangles in the following figure /\\/\\/', {
                        sourceSnippet: 'Count the triangles in the following figure /\\/\\/',
                    }),
                ],
                expectedQuestionCount: 3,
                candidateBlockCount: 3,
                answerHintCount: 3,
            })),
            extractVisualReferences,
        }),
    )

    expect(outcome.useLegacyFlow).toBe(false)
    expect(outcome.strategy).toBe('EXTRACTED')
    expect(extractVisualReferences).not.toHaveBeenCalled()
    expect(outcome.warning).toContain('skipped additional diagram extraction')
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

test('executeDocumentImportPlan returns recoverable exact extraction immediately for hybrid reconcile PDFs', async () => {
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
                lane: 'ADVANCED',
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
    expect(extractMultimodal).not.toHaveBeenCalled()
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
                lane: 'ADVANCED',
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
                lane: 'ADVANCED',
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
                lane: 'ADVANCED',
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
                lane: 'ADVANCED',
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
                lane: 'ADVANCED',
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

test('executeDocumentImportPlan preserves strong exact-parsed sharedContext when visual reference merges', async () => {
    const exactContext = 'The following table shows the production of cars by 5 companies over 5 years:\nCompany 2018 2019 2020 2021 2022\nA 45 50 40 55 60'
    const exactEvidence = 'Table extracted from exact parser'
    const extractTextExact = vi.fn().mockResolvedValue(createExactExtraction({
        questions: [{
            ...createQuestion('What is the total production of Company A?'),
            sharedContext: exactContext,
            sharedContextEvidence: exactEvidence,
            sourceSnippet: 'Q1. What is the total production',
            confidence: 0.95,
        }],
        expectedQuestionCount: 1,
        candidateBlockCount: 1,
        answerHintCount: 1,
    }))
    const extractVisualReferences = vi.fn().mockResolvedValue({
        references: [
            {
                questionNumber: 1,
                sharedContext: 'Data table showing car production figures.',
                sourcePage: 2,
                sourceSnippet: 'Production of Cars',
                sharedContextEvidence: 'Visual reference from page 2 chart',
                confidence: 0.85,
            },
        ],
        pageCount: 3,
        chunkCount: 2,
    })

    const outcome = await executeDocumentImportPlan(
        {
            plan: {
                routingMode: 'CLASSIFIER',
                lane: 'ADVANCED',
                selectedStrategy: 'HYBRID_RECONCILE',
                runMultimodalFirst: false,
                visualReferenceOverlay: true,
                generateFromSource: false,
                reasons: ['table-heavy pdf'],
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
    const question = outcome.result?.questions?.[0]
    // Strong exact-parsed context must survive the merge
    expect(question?.sharedContext).toContain('production of cars')
    // Visual reference context is appended, not replacing
    expect(question?.sharedContext).toContain('Data table showing car production')
    // Both evidence sources are preserved (concatenated)
    expect(question?.sharedContextEvidence).toContain(exactEvidence)
    expect(question?.sharedContextEvidence).toContain('Visual reference from page 2')
    // Original sourceSnippet from exact parsing is preserved
    expect(question?.sourceSnippet).toBe('Q1. What is the total production')
    // Confidence takes the higher value
    expect(question?.confidence).toBe(0.95)
})

test('executeDocumentImportPlan adds visual context to questions that have none', async () => {
    const extractTextExact = vi.fn().mockResolvedValue(createExactExtraction({
        questions: [{
            ...createQuestion('Study the following diagram and answer.'),
            sharedContext: null,
            sharedContextEvidence: null,
            sourceSnippet: null,
            confidence: 0.7,
        }],
        expectedQuestionCount: 1,
        candidateBlockCount: 1,
        answerHintCount: 1,
    }))
    const extractVisualReferences = vi.fn().mockResolvedValue({
        references: [
            {
                questionNumber: 1,
                sharedContext: 'Venn diagram with Set A (Mammals) and Set B (Aquatic). Overlap: Whale, Dolphin.',
                sourcePage: 3,
                sourceSnippet: 'Study the following diagram',
                sharedContextEvidence: 'Venn diagram on page 3',
                confidence: 0.9,
            },
        ],
        pageCount: 4,
        chunkCount: 2,
    })

    const outcome = await executeDocumentImportPlan(
        {
            plan: {
                routingMode: 'CLASSIFIER',
                lane: 'ADVANCED',
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
    const question = outcome.result?.questions?.[0]
    // Visual context fills the gap
    expect(question?.sharedContext).toContain('Venn diagram')
    expect(question?.sharedContext).toContain('Whale, Dolphin')
    // Evidence and snippet come from the visual reference
    expect(question?.sharedContextEvidence).toContain('Venn diagram on page 3')
    expect(question?.sourceSnippet).toBe('Study the following diagram')
    // Confidence upgraded from visual reference
    expect(question?.confidence).toBe(0.9)
    expect(question?.sourcePage).toBe(3)
})
