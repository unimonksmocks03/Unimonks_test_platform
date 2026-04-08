import type { VerificationResult } from '@/lib/services/ai-extraction-schemas'

export interface GeneratedQuestion {
    stem: string
    options: { id: string; text: string; isCorrect: boolean }[]
    explanation: string
    difficulty: string
    topic: string
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
    aiUsed: boolean
    cost?: CostInfo
    warning?: string
}

export interface PdfVisionFallbackResult {
    mode: PdfImportFallbackMode
    questions?: GeneratedQuestion[]
    failedCount?: number
    cost?: CostInfo
    error?: boolean
    message?: string
    pageCount: number
    chunkCount: number
    verification?: VerificationResult
}
