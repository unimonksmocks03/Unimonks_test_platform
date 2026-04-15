import { z } from 'zod'

export const ExtractionModeSchema = z.enum([
    'TEXT_EXACT',
    'MULTIMODAL_EXTRACT',
    'HYBRID_RECONCILE',
    'GENERATE_FROM_SOURCE',
])

export const AnswerSourceSchema = z.enum([
    'ANSWER_KEY',
    'INLINE_ANSWER',
    'INFERRED',
])

export const QuestionReferenceKindSchema = z.enum([
    'NONE',
    'PASSAGE',
    'TABLE',
    'LIST_MATCH',
    'DIAGRAM',
    'GRAPH',
    'MAP',
    'OTHER',
])

export const QuestionReferenceModeSchema = z.enum([
    'TEXT',
    'SNAPSHOT',
    'HYBRID',
])

export const VerificationIssueCategorySchema = z.enum([
    'STRUCTURAL',
    'EVIDENCE',
    'CROSS',
])

export const VerificationIssueSeveritySchema = z.enum([
    'ERROR',
    'WARNING',
])

export const McqOptionSchema = z.object({
    id: z.enum(['A', 'B', 'C', 'D']),
    text: z.string().trim().min(1),
    isCorrect: z.boolean(),
})

export const McqQuestionSchema = z.object({
    stem: z.string().trim().min(3),
    options: z.array(McqOptionSchema).length(4),
    explanation: z.string(),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
    topic: z.string().trim().min(1),
    sharedContext: z.string().trim().max(12000).optional().nullable(),
    sourcePage: z.number().int().positive().optional().nullable(),
    sourceSnippet: z.string().trim().min(1).max(2000).optional().nullable(),
    answerSource: AnswerSourceSchema.optional().nullable(),
    confidence: z.number().min(0).max(1).optional().nullable(),
    sharedContextEvidence: z.string().trim().min(1).max(12000).optional().nullable(),
    extractionMode: ExtractionModeSchema.optional().nullable(),
    referenceKind: QuestionReferenceKindSchema.optional().nullable(),
    referenceMode: QuestionReferenceModeSchema.optional().nullable(),
    referenceTitle: z.string().trim().min(1).max(120).optional().nullable(),
})

export const McqExtractionResponseSchema = z.object({
    questions: z.array(McqQuestionSchema),
})

export const NumberedMcqQuestionSchema = McqQuestionSchema.extend({
    questionNumber: z.number().int().positive(),
})

export const NumberedMcqExtractionResponseSchema = z.object({
    questions: z.array(NumberedMcqQuestionSchema),
})

export const VisualReferenceExtractionSchema = z.object({
    questionNumber: z.number().int().positive(),
    sharedContext: z.string().trim().max(12000),
    sourcePage: z.number().int().positive().optional().nullable(),
    sourceSnippet: z.string().trim().min(1).max(2000).optional().nullable(),
    sharedContextEvidence: z.string().trim().min(1).max(12000).optional().nullable(),
    confidence: z.number().min(0).max(1).optional().nullable(),
    referenceKind: QuestionReferenceKindSchema.optional().nullable(),
    referenceMode: QuestionReferenceModeSchema.optional().nullable(),
    referenceTitle: z.string().trim().min(1).max(120).optional().nullable(),
})

export const VisualReferenceExtractionResponseSchema = z.object({
    references: z.array(VisualReferenceExtractionSchema),
})

export const VerificationIssueSchema = z.object({
    questionNumber: z.number().int().nonnegative(),
    issue: z.string().trim().min(1),
    category: VerificationIssueCategorySchema,
    severity: VerificationIssueSeveritySchema,
    code: z.string().trim().min(1).max(80).optional(),
})

export const VerificationResultSchema = z.object({
    totalQuestions: z.number().int().nonnegative(),
    validQuestions: z.number().int().nonnegative(),
    issues: z.array(VerificationIssueSchema),
    passed: z.boolean(),
    reviewRecommended: z.boolean().optional(),
    issueSummary: z.object({
        structural: z.number().int().nonnegative(),
        evidence: z.number().int().nonnegative(),
        cross: z.number().int().nonnegative(),
        errors: z.number().int().nonnegative(),
        warnings: z.number().int().nonnegative(),
    }).optional(),
})

export type McqOption = z.infer<typeof McqOptionSchema>
export type McqQuestion = z.infer<typeof McqQuestionSchema>
export type McqExtractionResponse = z.infer<typeof McqExtractionResponseSchema>
export type NumberedMcqQuestion = z.infer<typeof NumberedMcqQuestionSchema>
export type NumberedMcqExtractionResponse = z.infer<typeof NumberedMcqExtractionResponseSchema>
export type VisualReferenceExtraction = z.infer<typeof VisualReferenceExtractionSchema>
export type VisualReferenceExtractionResponse = z.infer<typeof VisualReferenceExtractionResponseSchema>
export type VerificationIssue = z.infer<typeof VerificationIssueSchema>
export type VerificationResult = z.infer<typeof VerificationResultSchema>
export type ExtractionMode = z.infer<typeof ExtractionModeSchema>
export type AnswerSource = z.infer<typeof AnswerSourceSchema>
export type QuestionReferenceKind = z.infer<typeof QuestionReferenceKindSchema>
export type QuestionReferenceMode = z.infer<typeof QuestionReferenceModeSchema>
export const AIVerificationResponseSchema = z.object({
    issues: z.array(VerificationIssueSchema),
    overallAssessment: z.string().trim().min(1),
    confidence: z.number().min(0).max(1),
})

export type AIVerificationResponse = z.infer<typeof AIVerificationResponseSchema>
export type VerificationIssueCategory = z.infer<typeof VerificationIssueCategorySchema>
export type VerificationIssueSeverity = z.infer<typeof VerificationIssueSeveritySchema>
