import { z } from 'zod'

import {
    LeadContactEmailSchema,
    LeadContactNameSchema,
    LeadContactPhoneSchema,
} from '@/lib/validations/contact.schema'

export const PublicTestParamSchema = z.object({
    testId: z.string().uuid('Valid test ID is required'),
})

export const PublicSessionParamSchema = z.object({
    sessionId: z.string().uuid('Valid session ID is required'),
})

export const PublicLeadCaptureSchema = z.object({
    fullName: LeadContactNameSchema,
    email: LeadContactEmailSchema,
    phone: LeadContactPhoneSchema,
})

export const PublicAnswerEntrySchema = z.object({
    questionId: z.string().uuid('Valid question ID is required'),
    optionId: z.string().trim().min(1, 'Option ID is required').nullable(),
    markedForReview: z.boolean().optional(),
    answeredAt: z.string().datetime().optional(),
})

export const PublicBatchAnswerSchema = z.object({
    answers: z.array(PublicAnswerEntrySchema)
        .max(500, 'Too many answers supplied'),
})

export const PublicSubmitSchema = z.object({
    answers: z.array(PublicAnswerEntrySchema).max(500, 'Too many answers supplied').optional(),
})

export type PublicLeadCaptureInput = z.infer<typeof PublicLeadCaptureSchema>
export type PublicAnswerEntryInput = z.infer<typeof PublicAnswerEntrySchema>
export type PublicBatchAnswerInput = z.infer<typeof PublicBatchAnswerSchema>
export type PublicSubmitInput = z.infer<typeof PublicSubmitSchema>
