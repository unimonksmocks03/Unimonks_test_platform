import { z } from 'zod'

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
})

export const McqExtractionResponseSchema = z.object({
    questions: z.array(McqQuestionSchema),
})

export const VerificationIssueSchema = z.object({
    questionNumber: z.number().int().nonnegative(),
    issue: z.string().trim().min(1),
})

export const VerificationResultSchema = z.object({
    totalQuestions: z.number().int().nonnegative(),
    validQuestions: z.number().int().nonnegative(),
    issues: z.array(VerificationIssueSchema),
    passed: z.boolean(),
})

export type McqOption = z.infer<typeof McqOptionSchema>
export type McqQuestion = z.infer<typeof McqQuestionSchema>
export type McqExtractionResponse = z.infer<typeof McqExtractionResponseSchema>
export type VerificationIssue = z.infer<typeof VerificationIssueSchema>
export type VerificationResult = z.infer<typeof VerificationResultSchema>
