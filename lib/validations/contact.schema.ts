import { z } from 'zod'

import { isValidPhoneNumber } from '../utils/contact-normalization'

const emptyStringToUndefined = (value: unknown) => {
    if (typeof value !== 'string') return value

    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
}

export const LeadContactNameSchema = z.string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(120, 'Name must be at most 120 characters')

export const LeadContactEmailSchema = z.string()
    .trim()
    .email('Valid email is required')

export const LeadContactPhoneSchema = z.string()
    .trim()
    .refine(isValidPhoneNumber, 'Valid phone number is required')

export const OptionalLeadContactEmailSchema = z.preprocess(emptyStringToUndefined, LeadContactEmailSchema.optional())
export const OptionalLeadContactPhoneSchema = z.preprocess(emptyStringToUndefined, LeadContactPhoneSchema.optional())

export const CreateLeadContactSchema = z.object({
    name: LeadContactNameSchema,
    email: OptionalLeadContactEmailSchema,
    phone: OptionalLeadContactPhoneSchema,
}).superRefine((data, ctx) => {
    if (data.email || data.phone) return

    ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Email or phone is required',
        path: ['email'],
    })
    ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Email or phone is required',
        path: ['phone'],
    })
})

export type CreateLeadContactInput = z.infer<typeof CreateLeadContactSchema>
