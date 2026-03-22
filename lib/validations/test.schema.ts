import { z } from 'zod'

import { DEFAULT_TEST_SETTINGS } from '@/lib/config/platform-policy'
import { dbUuid } from '@/lib/validations/db-id.schema'

const nonEmptyUuidArray = z.array(dbUuid('Each ID must be a valid ID'))
    .max(200, 'Cannot submit more than 200 IDs at once')

// ── Test Settings ──
const TestSettingsSchema = z.object({
    shuffleQuestions: z.boolean().default(false),
    showResult: z.boolean().default(true),
    passingScore: z.number().min(0).max(100).default(40),
    correctMarks: z.number().int().min(1).max(20).default(DEFAULT_TEST_SETTINGS.correctMarks),
    incorrectMarks: z.number().int().min(0).max(20).default(DEFAULT_TEST_SETTINGS.incorrectMarks),
})

// ── Create Test ──
export const CreateTestSchema = z.object({
    title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200, 'Title must be at most 200 characters'),
    description: z.string().trim().max(2000).optional(),
    durationMinutes: z.number().int().min(5, 'Duration must be at least 5 minutes').max(300, 'Duration must be at most 300 minutes'),
    settings: TestSettingsSchema.optional().default({ ...DEFAULT_TEST_SETTINGS }),
})

// ── Update Test ──
export const UpdateTestSchema = z.object({
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().max(2000).optional().nullable(),
    durationMinutes: z.number().int().min(5).max(300).optional(),
    settings: TestSettingsSchema.partial().optional(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
}).refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
})

// ── Question Option ──
const QuestionOptionSchema = z.object({
    id: z.string().min(1, 'Option ID is required'),
    text: z.string().min(1, 'Option text is required'),
    isCorrect: z.boolean(),
})

// ── Create Question ──
export const CreateQuestionSchema = z.object({
    stem: z.string().trim().min(3, 'Stem must be at least 3 characters'),
    options: z.array(QuestionOptionSchema)
        .length(4, 'Exactly 4 options are required')
        .refine(
            (opts) => opts.filter((option) => option.isCorrect).length === 1,
            { message: 'Exactly 1 option must be marked as correct' }
        ),
    explanation: z.string().optional(),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
    topic: z.string().max(100).optional(),
})

// ── Update Question ──
export const UpdateQuestionSchema = z.object({
    stem: z.string().trim().min(3).optional(),
    options: z.array(QuestionOptionSchema)
        .length(4, 'Exactly 4 options are required')
        .refine(
            (opts) => opts.filter((option) => option.isCorrect).length === 1,
            { message: 'Exactly 1 option must be marked as correct' }
        )
        .optional(),
    explanation: z.string().optional().nullable(),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
    topic: z.string().trim().max(100).optional().nullable(),
}).refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
})

// ── Assign Test ──
export const AssignTestSchema = z.object({
    batchIds: nonEmptyUuidArray.optional(),
    studentIds: nonEmptyUuidArray.optional(),
}).refine(
    (data) => (data.batchIds && data.batchIds.length > 0) || (data.studentIds && data.studentIds.length > 0),
    { message: 'At least one batchId or studentId is required' }
)

// ── Test Query (GET list) ──
export const TestQuerySchema = z.object({
    search: z.string().trim().max(200).optional(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
})

// ── Type Exports ──
export type CreateTestInput = z.infer<typeof CreateTestSchema>
export type UpdateTestInput = z.infer<typeof UpdateTestSchema>
export type CreateQuestionInput = z.infer<typeof CreateQuestionSchema>
export type UpdateQuestionInput = z.infer<typeof UpdateQuestionSchema>
export type AssignTestInput = z.infer<typeof AssignTestSchema>
export type TestQueryInput = z.infer<typeof TestQuerySchema>
