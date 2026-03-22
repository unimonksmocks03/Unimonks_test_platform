import { z } from 'zod'

import { dbUuid } from '@/lib/validations/db-id.schema'

// ── Create Batch ──
export const CreateBatchSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name must be at most 100 characters'),
    code: z.string()
        .min(3, 'Code must be at least 3 characters')
        .max(20, 'Code must be at most 20 characters')
        .regex(/^[A-Z0-9\-]+$/, 'Code must be uppercase letters, numbers, and dashes only'),
})

// ── Update Batch ──
export const UpdateBatchSchema = z.object({
    name: z.string().min(2).max(100).optional(),
    code: z.string().min(3).max(20).regex(/^[A-Z0-9\-]+$/, 'Code must be uppercase letters, numbers, and dashes only').optional(),
    status: z.enum(['ACTIVE', 'UPCOMING', 'COMPLETED']).optional(),
}).refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
})

// ── Batch Query (GET list) ──
export const BatchQuerySchema = z.object({
    search: z.string().optional(),
    status: z.enum(['ACTIVE', 'UPCOMING', 'COMPLETED']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
})

// ── Enroll Students ──
export const EnrollStudentsSchema = z.object({
    studentIds: z.array(dbUuid('Each student ID must be a valid ID'))
        .min(1, 'At least one student ID is required')
        .max(200, 'Cannot enroll more than 200 students at once'),
})

// ── Type Exports ──
export type CreateBatchInput = z.infer<typeof CreateBatchSchema>
export type UpdateBatchInput = z.infer<typeof UpdateBatchSchema>
export type BatchQueryInput = z.infer<typeof BatchQuerySchema>
export type EnrollStudentsInput = z.infer<typeof EnrollStudentsSchema>
