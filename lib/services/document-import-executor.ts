import type {
    VerificationResult,
    VisualReferenceExtraction,
} from '@/lib/services/ai-extraction-schemas'
import type {
    CostInfo,
    DocumentQuestionStrategy,
    GeneratedQuestion,
    PdfVisionFallbackResult,
    PreciseDocumentQuestionAnalysis,
    VisualReferenceExtractionResult,
} from '@/lib/services/ai-service.types'
import type { DocumentImportPlan } from '@/lib/services/document-import-strategy'

type GeneratedTextQuestionsResult = {
    questions?: GeneratedQuestion[]
    failedCount?: number
    cost?: CostInfo
    error?: boolean
    message?: string
}

export type DocumentImportExecutionResult = {
    useLegacyFlow: boolean
    strategy?: DocumentQuestionStrategy
    result?: {
        error?: boolean
        message?: string
        questions?: GeneratedQuestion[]
        failedCount?: number
        cost?: CostInfo
        verification?: VerificationResult
        pageCount?: number
        chunkCount?: number
    }
    extracted?: PreciseDocumentQuestionAnalysis
    parserStatus?: 'OK' | 'FAILED' | 'WEAK_OUTPUT' | 'REPAIRED'
    aiFallbackUsed?: boolean
    reportParserIssue?: boolean
    warning?: string | null
    needsAdminReview?: boolean
    reviewIssueCount?: number
    failure?: {
        code: 'BAD_REQUEST' | 'PARSE_ERROR' | 'GENERATION_FAILED'
        message: string
    }
}

type ExecuteDocumentImportPlanInput = {
    plan: DocumentImportPlan
    isPdfUpload: boolean
    textLength: number
    parseFailed: boolean
    generationTarget: number
}

type ExecuteDocumentImportPlanHandlers = {
    extractTextExact: () => Promise<PreciseDocumentQuestionAnalysis>
    extractMultimodal: (target: number) => Promise<PdfVisionFallbackResult>
    extractVisualReferences: () => Promise<VisualReferenceExtractionResult>
    generateFromText: (target: number) => Promise<GeneratedTextQuestionsResult>
    generateFromPdfVision: (target: number) => Promise<PdfVisionFallbackResult>
}

function hasUsableQuestions(
    result:
        | GeneratedTextQuestionsResult
        | PdfVisionFallbackResult
        | undefined
        | null,
): result is { questions: GeneratedQuestion[]; failedCount?: number; cost?: CostInfo; verification?: VerificationResult; pageCount?: number; chunkCount?: number } {
    return Boolean(result && !result.error && result.questions && result.questions.length > 0)
}

function hasUsableExactExtraction(extracted: PreciseDocumentQuestionAnalysis) {
    return extracted.detectedAsMcqDocument && !extracted.error && extracted.questions.length > 0
}

function hasRecoverableExactExtraction(extracted: PreciseDocumentQuestionAnalysis) {
    if (extracted.questions.length === 0) {
        return false
    }

    if (extracted.expectedQuestionCount !== null) {
        const missingFromExpected = Math.max(0, extracted.expectedQuestionCount - extracted.questions.length)
        const toleratedExpectedMisses = Math.max(2, Math.floor(extracted.expectedQuestionCount * 0.1))
        if (missingFromExpected <= toleratedExpectedMisses) {
            return true
        }
    }

    const baselineCount = Math.max(extracted.candidateBlockCount, extracted.questions.length)
    const missingFromCandidates = Math.max(0, extracted.candidateBlockCount - extracted.questions.length)
    const toleratedMisses = Math.max(2, Math.floor(baselineCount * 0.1))

    if (extracted.candidateBlockCount === 0) {
        return extracted.questions.length >= 10 && (extracted.exactMatchAchieved || extracted.aiRepairUsed)
    }

    return missingFromCandidates <= toleratedMisses
}

function toGeneratedResult(result: GeneratedTextQuestionsResult) {
    return {
        error: result.error,
        message: result.message,
        questions: result.questions,
        failedCount: result.failedCount,
        cost: result.cost,
    }
}

function toPdfResult(result: PdfVisionFallbackResult) {
    return {
        error: result.error,
        message: result.message,
        questions: result.questions,
        failedCount: result.failedCount,
        cost: result.cost,
        verification: result.verification,
        pageCount: result.pageCount,
        chunkCount: result.chunkCount,
    }
}

function countExtractedValidationFailures(extracted: PreciseDocumentQuestionAnalysis) {
    if (extracted.expectedQuestionCount !== null) {
        return Math.max(0, extracted.expectedQuestionCount - extracted.questions.length)
    }

    if (extracted.missingQuestionNumbers.length > 0) {
        return extracted.missingQuestionNumbers.length
    }

    return 0
}

function toExtractedResult(extracted: PreciseDocumentQuestionAnalysis) {
    return {
        error: false,
        message: undefined,
        questions: extracted.questions,
        failedCount: countExtractedValidationFailures(extracted),
        cost: extracted.cost,
    }
}

function countVerificationErrors(verification?: VerificationResult) {
    if (!verification) {
        return 0
    }

    return verification.issues.filter((issue) => issue.severity === 'ERROR').length
}

function mergeVisualReferencesIntoQuestions(
    questions: GeneratedQuestion[],
    references: VisualReferenceExtraction[] | undefined,
) {
    if (!references || references.length === 0 || questions.length === 0) {
        return questions
    }

    const byQuestionNumber = new Map<number, VisualReferenceExtraction>()
    for (const reference of references) {
        if (!reference || !Number.isInteger(reference.questionNumber) || reference.questionNumber <= 0) {
            continue
        }

        const previous = byQuestionNumber.get(reference.questionNumber)
        if (!previous || (reference.sharedContext?.length ?? 0) > (previous.sharedContext?.length ?? 0)) {
            byQuestionNumber.set(reference.questionNumber, reference)
        }
    }

    return questions.map((question, index) => {
        const reference = byQuestionNumber.get(index + 1)
        if (!reference) {
            return question
        }

        return {
            ...question,
            sharedContext: reference.sharedContext || question.sharedContext || null,
            sourcePage: reference.sourcePage ?? question.sourcePage ?? null,
            sharedContextEvidence:
                reference.sharedContextEvidence
                || reference.sourceSnippet
                || question.sharedContextEvidence
                || null,
            confidence: typeof reference.confidence === 'number'
                ? Math.max(question.confidence ?? 0, reference.confidence)
                : question.confidence ?? null,
            extractionMode: 'HYBRID_RECONCILE' as const,
        }
    })
}

function shouldPreferExactExtraction(
    extracted: PreciseDocumentQuestionAnalysis,
    multimodal?: PdfVisionFallbackResult,
) {
    if (!hasRecoverableExactExtraction(extracted)) {
        return false
    }

    if (!hasUsableQuestions(multimodal)) {
        return true
    }

    const exactCount = extracted.questions.length
    const multimodalCount = multimodal.questions.length
    const multimodalErrors = countVerificationErrors(multimodal.verification)

    if (extracted.exactMatchAchieved && multimodalErrors > 0) {
        return true
    }

    if (exactCount > multimodalCount) {
        return true
    }

    if (exactCount === multimodalCount && extracted.exactMatchAchieved) {
        return true
    }

    return false
}

export async function executeDocumentImportPlan(
    input: ExecuteDocumentImportPlanInput,
    handlers: ExecuteDocumentImportPlanHandlers,
): Promise<DocumentImportExecutionResult> {
    if (input.plan.routingMode !== 'CLASSIFIER') {
        return { useLegacyFlow: true }
    }

    if (input.plan.generateFromSource) {
        if (input.textLength < 50 && !input.isPdfUpload) {
            return {
                useLegacyFlow: false,
                failure: {
                    code: 'BAD_REQUEST',
                    message: 'Document has too little text to generate questions from.',
                },
            }
        }

        if (input.isPdfUpload && (input.parseFailed || input.textLength < 50)) {
            const fallback = await handlers.generateFromPdfVision(input.generationTarget)
            if (!hasUsableQuestions(fallback)) {
                return {
                    useLegacyFlow: false,
                    failure: {
                        code: input.parseFailed ? 'PARSE_ERROR' : 'GENERATION_FAILED',
                        message: fallback.message || (
                            input.parseFailed
                                ? 'Failed to parse the PDF and AI fallback could not recover the document.'
                                : 'Could not recover usable PDF content for AI generation fallback.'
                        ),
                    },
                }
            }

            const needsAdminReview = Boolean(
                fallback.verification
                && (!fallback.verification.passed || fallback.verification.reviewRecommended),
            )
            return {
                useLegacyFlow: false,
                strategy: 'AI_VISION_FALLBACK',
                result: toPdfResult(fallback),
                parserStatus: input.parseFailed ? 'FAILED' : 'WEAK_OUTPUT',
                aiFallbackUsed: true,
                reportParserIssue: input.parseFailed,
                warning: input.parseFailed
                    ? 'AI took the lead because the PDF parser failed on this file.'
                    : null,
                needsAdminReview,
                reviewIssueCount: fallback.verification?.issues.length ?? 0,
            }
        }

        const generated = await handlers.generateFromText(input.generationTarget)
        if (!hasUsableQuestions(generated)) {
            return {
                useLegacyFlow: false,
                failure: {
                    code: 'GENERATION_FAILED',
                    message: generated.message || 'Failed to generate questions from the document.',
                },
            }
        }

        return {
            useLegacyFlow: false,
            strategy: 'AI_GENERATED',
            result: toGeneratedResult(generated),
            parserStatus: 'OK',
            aiFallbackUsed: false,
            reportParserIssue: false,
            warning: null,
            needsAdminReview: false,
            reviewIssueCount: 0,
        }
    }

    if (input.plan.selectedStrategy === 'TEXT_EXACT') {
        const extracted = await handlers.extractTextExact()
        if (hasRecoverableExactExtraction(extracted)) {
            return {
                useLegacyFlow: false,
                strategy: 'EXTRACTED',
                result: toExtractedResult(extracted),
                extracted,
                parserStatus: extracted.aiRepairUsed
                    ? 'REPAIRED'
                    : extracted.error
                        ? 'WEAK_OUTPUT'
                        : 'OK',
                aiFallbackUsed: extracted.aiRepairUsed,
                reportParserIssue: extracted.aiRepairUsed || Boolean(extracted.error),
                warning: extracted.aiRepairUsed
                    ? 'The exact parser required AI-assisted repair to recover this document cleanly.'
                    : extracted.error
                        ? 'The exact parser recovered a near-complete question set, but verification should review it carefully.'
                        : null,
                needsAdminReview: false,
                reviewIssueCount: 0,
            }
        }

        if (!input.isPdfUpload) {
            return { useLegacyFlow: true }
        }

        const multimodal = await handlers.extractMultimodal(
            extracted.expectedQuestionCount ?? input.generationTarget,
        )
        if (hasUsableQuestions(multimodal)) {
            const needsAdminReview = Boolean(
                multimodal.verification
                && (!multimodal.verification.passed || multimodal.verification.reviewRecommended),
            )
            return {
                useLegacyFlow: false,
                strategy: 'AI_VISION_FALLBACK',
                result: toPdfResult(multimodal),
                extracted,
                parserStatus: extracted.error ? 'FAILED' : 'WEAK_OUTPUT',
                aiFallbackUsed: true,
                reportParserIssue: true,
                warning: extracted.error
                    ? 'The exact parser could not recover this PDF, so multimodal extraction took over.'
                    : 'The exact parser produced weak output for this PDF, so multimodal extraction took over.',
                needsAdminReview,
                reviewIssueCount: multimodal.verification?.issues.length ?? 0,
            }
        }

        return { useLegacyFlow: true }
    }

    if (input.plan.selectedStrategy === 'HYBRID_RECONCILE' && !input.isPdfUpload) {
        const extracted = await handlers.extractTextExact()
        if (hasRecoverableExactExtraction(extracted)) {
            return {
                useLegacyFlow: false,
                strategy: 'EXTRACTED',
                result: toExtractedResult(extracted),
                extracted,
                parserStatus: extracted.aiRepairUsed
                    ? 'REPAIRED'
                    : extracted.error
                        ? 'WEAK_OUTPUT'
                        : 'OK',
                aiFallbackUsed: extracted.aiRepairUsed,
                reportParserIssue: extracted.aiRepairUsed || Boolean(extracted.error),
                warning: extracted.aiRepairUsed
                    ? 'Hybrid reconcile normalized this non-PDF import to the exact parser and used AI-assisted repair where needed.'
                    : extracted.error
                        ? 'Hybrid reconcile normalized this non-PDF import to the exact parser and recovered a near-complete result that should be reviewed carefully.'
                        : null,
                needsAdminReview: false,
                reviewIssueCount: 0,
            }
        }

        return { useLegacyFlow: true }
    }

    if (input.plan.selectedStrategy === 'HYBRID_RECONCILE' && input.plan.visualReferenceOverlay) {
        const extracted = await handlers.extractTextExact()
        if (hasRecoverableExactExtraction(extracted)) {
            const visualReferences = await handlers.extractVisualReferences()
            const mergedQuestions = mergeVisualReferencesIntoQuestions(
                extracted.questions,
                visualReferences.references,
            )
            const mergedExtraction: PreciseDocumentQuestionAnalysis = {
                ...extracted,
                questions: mergedQuestions,
            }

            const extractedVisualCount = visualReferences.references?.length ?? 0
            return {
                useLegacyFlow: false,
                strategy: 'EXTRACTED',
                result: toExtractedResult(mergedExtraction),
                extracted: mergedExtraction,
                parserStatus: extracted.aiRepairUsed ? 'REPAIRED' : 'OK',
                aiFallbackUsed: extracted.aiRepairUsed || extractedVisualCount > 0,
                reportParserIssue: Boolean(visualReferences.error && visualReferences.message),
                warning: visualReferences.error
                    ? 'Exact parsing recovered the questions, but visual-reference extraction could not confidently recover every diagram context.'
                    : extractedVisualCount === 0
                        ? 'Exact parsing recovered the questions, but no diagram references were detected from the page images. Review visual questions carefully.'
                        : extracted.aiRepairUsed
                            ? 'Hybrid reconcile used exact recovery for question parsing and page-image extraction for diagram references.'
                            : 'Hybrid reconcile used exact parsing plus page-image extraction for diagram references.',
                needsAdminReview: Boolean(visualReferences.error),
                reviewIssueCount: visualReferences.error ? 1 : 0,
            }
        }
    }

    const multimodalTarget = input.plan.selectedStrategy === 'HYBRID_RECONCILE'
        ? input.generationTarget
        : input.generationTarget
    const multimodal = await handlers.extractMultimodal(multimodalTarget)
    if (hasUsableQuestions(multimodal)) {
        if (input.plan.selectedStrategy === 'HYBRID_RECONCILE') {
            const extracted = await handlers.extractTextExact()
            if (shouldPreferExactExtraction(extracted, multimodal)) {
                return {
                    useLegacyFlow: false,
                    strategy: 'EXTRACTED',
                    result: toExtractedResult(extracted),
                    extracted,
                    parserStatus: extracted.aiRepairUsed ? 'REPAIRED' : 'OK',
                    aiFallbackUsed: true,
                    reportParserIssue: false,
                    warning: 'Hybrid reconcile preferred the exact parser output because it was more complete than the multimodal extraction.',
                    needsAdminReview: false,
                    reviewIssueCount: 0,
                }
            }
        }
        const needsAdminReview = Boolean(
            multimodal.verification
            && (!multimodal.verification.passed || multimodal.verification.reviewRecommended),
        )
        return {
            useLegacyFlow: false,
            strategy: 'AI_VISION_FALLBACK',
            result: toPdfResult(multimodal),
            parserStatus: input.parseFailed ? 'FAILED' : 'OK',
            aiFallbackUsed: false,
            reportParserIssue: input.parseFailed,
            warning: input.parseFailed
                ? 'AI took the lead because the PDF parser failed on this file.'
                : null,
            needsAdminReview,
            reviewIssueCount: multimodal.verification?.issues.length ?? 0,
        }
    }

    if (input.plan.selectedStrategy === 'HYBRID_RECONCILE') {
        const extracted = await handlers.extractTextExact()
        if (hasRecoverableExactExtraction(extracted)) {
            return {
                useLegacyFlow: false,
                strategy: 'EXTRACTED',
                result: toExtractedResult(extracted),
                extracted,
                parserStatus: extracted.aiRepairUsed ? 'REPAIRED' : 'WEAK_OUTPUT',
                aiFallbackUsed: true,
                reportParserIssue: true,
                warning: extracted.aiRepairUsed
                    ? 'Hybrid reconcile fell back to the exact parser after multimodal extraction underperformed, and AI-assisted repair reconciled the final set.'
                    : extracted.error
                        ? 'Hybrid reconcile preferred the near-complete exact parser result after multimodal extraction underperformed.'
                        : 'Hybrid reconcile fell back to the exact parser after multimodal extraction underperformed.',
                needsAdminReview: false,
                reviewIssueCount: 0,
            }
        }
    }

    if (input.textLength < 50) {
        return {
            useLegacyFlow: false,
            failure: {
                code: input.parseFailed ? 'PARSE_ERROR' : 'GENERATION_FAILED',
                message: multimodal.message || (
                    input.parseFailed
                        ? 'Failed to parse the PDF and multimodal extraction could not recover the document.'
                        : 'The PDF parser produced weak output and multimodal extraction could not recover the document.'
                ),
            },
        }
    }

    const extracted = await handlers.extractTextExact()
    if (hasUsableExactExtraction(extracted)) {
        return {
            useLegacyFlow: false,
            strategy: 'EXTRACTED',
            result: toExtractedResult(extracted),
            extracted,
            parserStatus: extracted.aiRepairUsed ? 'REPAIRED' : 'WEAK_OUTPUT',
            aiFallbackUsed: true,
            reportParserIssue: true,
            warning: extracted.aiRepairUsed
                ? 'Classifier preferred multimodal extraction, but the exact parser recovered the document after AI recovery.'
                : 'Classifier preferred multimodal extraction, but the exact parser recovered the document after multimodal extraction failed.',
            needsAdminReview: false,
            reviewIssueCount: 0,
        }
    }

    const generated = await handlers.generateFromText(input.generationTarget)
    if (!hasUsableQuestions(generated)) {
        return {
            useLegacyFlow: false,
            failure: {
                code: 'GENERATION_FAILED',
                message: generated.message || multimodal.message || 'Failed to recover questions from this document.',
            },
        }
    }

    return {
        useLegacyFlow: false,
        strategy: 'AI_GENERATED',
        result: toGeneratedResult(generated),
        extracted,
        parserStatus: input.parseFailed || extracted.error ? 'FAILED' : 'WEAK_OUTPUT',
        aiFallbackUsed: true,
        reportParserIssue: true,
        warning: input.parseFailed
            ? 'AI took the lead because the PDF parser failed on this file.'
            : 'Classifier preferred multimodal extraction, but the importer fell back to text generation after extraction paths were exhausted.',
        needsAdminReview: false,
        reviewIssueCount: 0,
    }
}
