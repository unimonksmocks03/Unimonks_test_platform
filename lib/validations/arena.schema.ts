import { z } from 'zod'

import { dbUuid } from '@/lib/validations/db-id.schema'

// ── Start Test ──
export const StartTestSchema = z.object({
    testId: dbUuid('Valid test ID is required'),
})

// ── Answer Question ──
export const AnswerSchema = z.object({
    questionId: dbUuid('Valid question ID is required'),
    optionId: z.string().min(1, 'Option ID is required'),
})

// ── Flag Event (Anti-Cheat) ──
export const FlagSchema = z.object({
    type: z.enum(['TAB_SWITCH', 'RIGHT_CLICK', 'COPY_ATTEMPT'], {
        message: 'Flag type is required',
    }),
})

// ── Type Exports ──
export type StartTestInput = z.infer<typeof StartTestSchema>
export type AnswerInput = z.infer<typeof AnswerSchema>
export type FlagInput = z.infer<typeof FlagSchema>
