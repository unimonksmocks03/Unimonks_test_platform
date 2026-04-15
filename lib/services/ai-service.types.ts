import type {
    AnswerSource,
    ExtractionMode,
    QuestionReferenceKind,
    QuestionReferenceMode,
    VerificationIssue,
    VerificationResult,
    VisualReferenceExtraction,
} from '@/lib/services/ai-extraction-schemas'

export interface GeneratedQuestion {
    stem: string
    options: { id: string; text: string; isCorrect: boolean }[]
    explanation: string
    difficulty: string
    topic: string
    sharedContext?: string | null
    sourcePage?: number | null
    sourceSnippet?: string | null
    answerSource?: AnswerSource | null
    confidence?: number | null
    sharedContextEvidence?: string | null
    extractionMode?: ExtractionMode | null
    referenceKind?: QuestionReferenceKind | null
    referenceMode?: QuestionReferenceMode | null
    referenceTitle?: string | null
    referenceAssetUrl?: string | null
    referenceBBox?: unknown | null
}

export interface CostInfo {
    model: string
    inputTokens: number
    outputTokens: number
    costUSD: number
}

export type DocumentQuestionStrategy = 'EXTRACTED' | 'AI_GENERATED' | 'AI_VISION_FALLBACK'
export type PdfImportFallbackMode = 'EXTRACTED' | 'GENERATED'

export interface ExtractedQuestionAnalysis {
    detectedAsMcqDocument: boolean
    answerHintCount: number
    candidateBlockCount: number
    questions: GeneratedQuestion[]
    expectedQuestionCount: number | null
    exactMatchAchieved: boolean
    invalidQuestionNumbers: number[]
    missingQuestionNumbers: number[]
    duplicateQuestionNumbers: number[]
}

export interface PreciseDocumentQuestionAnalysis extends ExtractedQuestionAnalysis {
    aiRepairUsed: boolean
    cost?: CostInfo
    error?: boolean
    message?: string
}

export interface DocumentMetadataEnrichmentResult {
    questions: GeneratedQuestion[]
    description: string
    suggestedTitle?: string | null
    suggestedDurationMinutes?: number | null
    primaryTopic?: string | null
    difficultyDistribution?: { easy: number; medium: number; hard: number } | null
    aiUsed: boolean
    cost?: CostInfo
    warning?: string
}

export interface AIVerificationResult {
    issues: VerificationIssue[]
    overallAssessment: string
    confidence: number
    cost?: CostInfo
    error?: boolean
    message?: string
}

export interface PdfVisionFallbackResult {
    mode: PdfImportFallbackMode
    questions?: GeneratedQuestion[]
    failedCount?: number
    cost?: CostInfo
    error?: boolean
    truncated?: boolean
    message?: string
    pageCount: number
    chunkCount: number
    verification?: VerificationResult
}

export interface VisualReferenceExtractionResult {
    references?: VisualReferenceExtraction[]
    cost?: CostInfo
    error?: boolean
    message?: string
    pageCount: number
    chunkCount: number
}
