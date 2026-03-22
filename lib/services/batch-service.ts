import { prisma } from '@/lib/prisma'
import {
    FREE_BATCH_CODE,
    FREE_BATCH_KIND,
    FREE_BATCH_NAME,
} from '@/lib/config/platform-policy'
import type { CreateBatchInput, UpdateBatchInput, BatchQueryInput, EnrollStudentsInput } from '@/lib/validations/batch.schema'
import { BatchStatus, Prisma } from '@prisma/client'

/**
 * Admin-level batch management service.
 */

function isProtectedSystemBatch(batch: { kind: string }) {
    return batch.kind === FREE_BATCH_KIND
}

function isReservedSystemBatchInput(data: { name?: string; code?: string }) {
    return data.code?.trim().toUpperCase() === FREE_BATCH_CODE
        || data.name?.trim() === FREE_BATCH_NAME
}

// ── List Batches (paginated, searchable, filterable) ──
export async function listBatches(query: BatchQueryInput) {
    const { search, status, page, limit } = query
    const skip = (page - 1) * limit

    const where: Prisma.BatchWhereInput = {}

    if (search) {
        where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { code: { contains: search, mode: 'insensitive' } },
        ]
    }
    if (status) where.status = status as BatchStatus

    const [batches, total] = await Promise.all([
        prisma.batch.findMany({
            where,
            include: {
                _count: { select: { students: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
        }),
        prisma.batch.count({ where }),
    ])

    return {
        batches: batches.map((b) => ({
            id: b.id,
            name: b.name,
            code: b.code,
            kind: b.kind,
            status: b.status,
            studentCount: b._count.students,
            createdAt: b.createdAt,
        })),
        total,
        page,
        totalPages: Math.ceil(total / limit),
    }
}

// ── Get Single Batch ──
export async function getBatch(id: string) {
    const batch = await prisma.batch.findUnique({
        where: { id },
        include: {
            students: {
                include: {
                    student: { select: { id: true, name: true, email: true, status: true } },
                },
            },
            assignments: {
                include: {
                    test: { select: { id: true, title: true, status: true, durationMinutes: true } },
                },
            },
            _count: { select: { students: true, assignments: true } },
        },
    })

    if (!batch) {
        return { error: true, code: 'NOT_FOUND', message: 'Batch not found' }
    }

    return {
        batch: {
            id: batch.id,
            name: batch.name,
            code: batch.code,
            kind: batch.kind,
            status: batch.status,
            students: batch.students.map((bs) => bs.student),
            assignments: batch.assignments.map((a) => ({
                id: a.id,
                testId: a.testId,
                test: a.test,
            })),
            studentCount: batch._count.students,
            assignmentCount: batch._count.assignments,
            createdAt: batch.createdAt,
        },
    }
}

// ── Create Batch ──
export async function createBatch(data: CreateBatchInput) {
    // Check code uniqueness
    const existing = await prisma.batch.findUnique({ where: { code: data.code } })
    if (existing) {
        return { error: true, code: 'DUPLICATE_CODE', message: 'A batch with this code already exists' }
    }

    if (isReservedSystemBatchInput(data)) {
        return {
            error: true,
            code: 'SYSTEM_BATCH_PROTECTED',
            message: 'The system free-mock batch is created automatically and cannot be created manually',
        }
    }

    const batch = await prisma.batch.create({
        data: {
            name: data.name,
            code: data.code,
            kind: 'STANDARD',
        },
    })

    return { batch }
}

// ── Update Batch ──
export async function updateBatch(id: string, data: UpdateBatchInput) {
    const existing = await prisma.batch.findUnique({ where: { id } })
    if (!existing) {
        return { error: true, code: 'NOT_FOUND', message: 'Batch not found' }
    }

    // If code is being changed, check uniqueness
    if (data.code && data.code !== existing.code) {
        const codeTaken = await prisma.batch.findUnique({ where: { code: data.code } })
        if (codeTaken) {
            return { error: true, code: 'DUPLICATE_CODE', message: 'A batch with this code already exists' }
        }
    }

    if (!isProtectedSystemBatch(existing) && isReservedSystemBatchInput(data)) {
        return {
            error: true,
            code: 'SYSTEM_BATCH_PROTECTED',
            message: 'The system free-mock batch identifiers are reserved',
        }
    }

    if (isProtectedSystemBatch(existing)) {
        if (data.name || data.code || data.status) {
            return {
                error: true,
                code: 'SYSTEM_BATCH_PROTECTED',
                message: 'The system free-mock batch cannot be renamed, disabled, or deleted',
            }
        }
    }

    const updateData: Prisma.BatchUpdateInput = {}
    if (data.name) updateData.name = data.name
    if (data.code) updateData.code = data.code
    if (data.status) updateData.status = data.status as BatchStatus

    const batch = await prisma.batch.update({
        where: { id },
        data: updateData,
        include: {
            _count: { select: { students: true } },
        },
    })

    return {
        batch: {
            ...batch,
            studentCount: batch._count.students,
        },
    }
}

// ── Delete Batch ──
export async function deleteBatch(id: string, permanent: boolean = false) {
    const existing = await prisma.batch.findUnique({
        where: { id },
        include: { _count: { select: { students: true } } },
    })
    if (!existing) {
        return { error: true, code: 'NOT_FOUND', message: 'Batch not found' }
    }

    if (isProtectedSystemBatch(existing)) {
        return {
            error: true,
            code: 'SYSTEM_BATCH_PROTECTED',
            message: 'The system free-mock batch cannot be renamed, disabled, or deleted',
        }
    }

    if (permanent) {
        // Cascade: remove enrollments, assignments, then delete batch
        await prisma.$transaction([
            prisma.batchStudent.deleteMany({ where: { batchId: id } }),
            prisma.testAssignment.deleteMany({ where: { batchId: id } }),
            prisma.batch.delete({ where: { id } }),
        ])
        return { message: 'Batch permanently deleted', deleted: true }
    }

    // Soft delete: mark as COMPLETED
    await prisma.batch.update({ where: { id }, data: { status: 'COMPLETED' } })
    return { message: 'Batch marked as completed', deleted: false }
}

// ── Enroll Students (bulk) ──
export async function enrollStudents(batchId: string, data: EnrollStudentsInput) {
    const batch = await prisma.batch.findUnique({ where: { id: batchId } })
    if (!batch) {
        return { error: true, code: 'NOT_FOUND', message: 'Batch not found' }
    }

    if (isProtectedSystemBatch(batch)) {
        return {
            error: true,
            code: 'SYSTEM_BATCH_PROTECTED',
            message: 'The system free-mock batch is reserved for public leads and cannot enroll students',
        }
    }

    // Validate all student IDs exist and are STUDENT role
    const students = await prisma.user.findMany({
        where: { id: { in: data.studentIds }, role: 'STUDENT', status: 'ACTIVE' },
        select: { id: true },
    })

    const validIds = new Set(students.map((s) => s.id))
    const invalidIds = data.studentIds.filter((id) => !validIds.has(id))

    if (invalidIds.length > 0) {
        return {
            error: true,
            code: 'INVALID_STUDENTS',
            message: `${invalidIds.length} student ID(s) are invalid or not active students`,
            details: { invalidIds },
        }
    }

    // Bulk upsert (skip already enrolled)
    const result = await prisma.batchStudent.createMany({
        data: data.studentIds.map((studentId) => ({ batchId, studentId })),
        skipDuplicates: true,
    })

    return {
        added: result.count,
        skipped: data.studentIds.length - result.count,
        total: data.studentIds.length,
    }
}

// ── Unenroll Student ──
export async function unenrollStudent(batchId: string, studentId: string) {
    const batch = await prisma.batch.findUnique({ where: { id: batchId }, select: { kind: true } })
    if (!batch) {
        return { error: true, code: 'NOT_FOUND', message: 'Batch not found' }
    }

    if (isProtectedSystemBatch(batch)) {
        return {
            error: true,
            code: 'SYSTEM_BATCH_PROTECTED',
            message: 'The system free-mock batch is reserved for public leads and cannot enroll students',
        }
    }

    try {
        await prisma.batchStudent.delete({
            where: { batchId_studentId: { batchId, studentId } },
        })
        return { message: 'Student unenrolled successfully' }
    } catch {
        return { error: true, code: 'NOT_FOUND', message: 'Student is not enrolled in this batch' }
    }
}
