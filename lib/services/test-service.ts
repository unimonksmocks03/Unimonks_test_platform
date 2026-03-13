import { prisma } from '@/lib/prisma'
import type {
    CreateTestInput,
    UpdateTestInput,
    CreateQuestionInput,
    UpdateQuestionInput,
    AssignTestInput,
    TestQueryInput,
} from '@/lib/validations/test.schema'
import { TestStatus, Difficulty, Prisma } from '@prisma/client'
import {
    getScheduledTestLifecycle,
    hardDeleteTestById,
    purgeExpiredFinishedTests,
} from '@/lib/services/test-lifecycle'

/**
 * Teacher-scoped test management service.
 * Every query is scoped to the requesting teacher's own tests.
 */

// ── List Tests (teacher-scoped, paginated) ──
export async function listTests(teacherId: string, query: TestQueryInput) {
    const { status, page, limit } = query
    const skip = (page - 1) * limit

    await purgeExpiredFinishedTests({ teacherId })

    const where: Prisma.TestWhereInput = { teacherId }
    if (status) where.status = status as TestStatus

    const [tests, total] = await Promise.all([
        prisma.test.findMany({
            where,
            include: {
                _count: {
                    select: {
                        questions: true,
                        sessions: { where: { status: { in: ['SUBMITTED', 'TIMED_OUT', 'FORCE_SUBMITTED'] } } }
                    }
                },
                sessions: {
                    where: { status: 'IN_PROGRESS' },
                    select: { id: true },
                    take: 1,
                },
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
        }),
        prisma.test.count({ where }),
    ])

    return {
        tests: tests.map((t) => ({
            ...(() => {
                const lifecycle = getScheduledTestLifecycle(t)
                const hasActiveSessions = t.sessions.length > 0

                return {
                    isFinished: t.status === 'PUBLISHED' && lifecycle.isFinished,
                    scheduledEndAt: lifecycle.scheduledEndAt,
                    retentionExpiresAt: lifecycle.retentionExpiresAt,
                    canDelete:
                        t.status === 'DRAFT' ||
                        (t.status === 'PUBLISHED' && lifecycle.isFinished && !hasActiveSessions),
                    hasActiveSessions,
                }
            })(),
            id: t.id,
            title: t.title,
            description: t.description,
            durationMinutes: t.durationMinutes,
            status: t.status,
            source: t.source,
            settings: t.settings,
            scheduledAt: t.scheduledAt,
            questionCount: t._count.questions,
            attemptCount: t._count.sessions,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
        })),
        total,
        page,
        totalPages: Math.ceil(total / limit),
    }
}

// ── Get Single Test (teacher-scoped) ──
export async function getTest(teacherId: string, testId: string) {
    const test = await prisma.test.findUnique({
        where: { id: testId },
        include: {
            _count: { select: { questions: true, sessions: true, assignments: true } },
            assignments: { select: { batchId: true } }
        },
    })

    if (!test) return { error: true, code: 'NOT_FOUND', message: 'Test not found' }
    if (test.teacherId !== teacherId) return { error: true, code: 'FORBIDDEN', message: 'You do not own this test' }

    return { test: { ...test, questionCount: test._count.questions, attemptCount: test._count.sessions, assignmentCount: test._count.assignments } }
}

// ── Create Test (DRAFT) ──
export async function createTest(teacherId: string, data: CreateTestInput) {
    const teacher = await prisma.user.findUnique({ where: { id: teacherId } })
    if (!teacher || teacher.status !== 'ACTIVE') {
        return { error: true, code: 'FORBIDDEN', message: 'Only active teachers can create tests' }
    }

    const test = await prisma.test.create({
        data: {
            teacherId,
            title: data.title,
            description: data.description,
            durationMinutes: data.durationMinutes,
            settings: data.settings as Prisma.InputJsonValue,
            scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
            status: 'DRAFT',
            source: 'MANUAL',
        },
    })

    return { test }
}

// ── Update Test (teacher-scoped) ──
export async function updateTest(teacherId: string, testId: string, data: UpdateTestInput) {
    const existing = await prisma.test.findUnique({
        where: { id: testId },
        include: { _count: { select: { questions: true } } },
    })

    if (!existing) return { error: true, code: 'NOT_FOUND', message: 'Test not found' }
    if (existing.teacherId !== teacherId) return { error: true, code: 'FORBIDDEN', message: 'You do not own this test' }

    // Lock published + started tests
    if (existing.status === 'PUBLISHED' && existing.scheduledAt && new Date(existing.scheduledAt) <= new Date()) {
        return { error: true, code: 'FORBIDDEN', message: 'Cannot edit a published test after its scheduled time' }
    }

    // Publishing validation: must have at least 1 question
    if (data.status === 'PUBLISHED' && existing.status === 'DRAFT') {
        if (existing._count.questions === 0) {
            return { error: true, code: 'NO_QUESTIONS', message: 'Cannot publish a test with no questions' }
        }
    }

    // Archiving: only PUBLISHED tests can be archived
    if (data.status === 'ARCHIVED' && existing.status !== 'PUBLISHED') {
        return { error: true, code: 'INVALID_TRANSITION', message: 'Only published tests can be archived' }
    }

    const updateData: Prisma.TestUpdateInput = {}
    if (data.title) updateData.title = data.title
    if (data.description !== undefined) updateData.description = data.description
    if (data.durationMinutes) updateData.durationMinutes = data.durationMinutes
    if (data.settings) {
        // Merge with existing settings
        const currentSettings = (existing.settings as Record<string, unknown>) || {}
        updateData.settings = { ...currentSettings, ...data.settings }
    }
    if (data.status) updateData.status = data.status as TestStatus
    if (data.scheduledAt !== undefined) updateData.scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null

    const test = await prisma.test.update({ where: { id: testId }, data: updateData })
    return { test }
}

// ── Delete Test (DRAFT or finished PUBLISHED) ──
export async function deleteTest(teacherId: string, testId: string) {
    const existing = await prisma.test.findUnique({ where: { id: testId } })
    if (!existing) return { error: true, code: 'NOT_FOUND', message: 'Test not found' }
    if (existing.teacherId !== teacherId) return { error: true, code: 'FORBIDDEN', message: 'You do not own this test' }

    if (existing.status === 'DRAFT') {
        await hardDeleteTestById(testId)
        return { message: 'Test deleted successfully' }
    }

    if (existing.status !== 'PUBLISHED') {
        return { error: true, code: 'NOT_DELETABLE', message: 'Only draft or finished published tests can be deleted' }
    }

    const lifecycle = getScheduledTestLifecycle(existing)
    if (!lifecycle.isFinished) {
        return { error: true, code: 'WINDOW_OPEN', message: 'Published tests can only be deleted after they have finished' }
    }

    const activeSessionCount = await prisma.testSession.count({
        where: { testId, status: 'IN_PROGRESS' },
    })
    if (activeSessionCount > 0) {
        return {
            error: true,
            code: 'ACTIVE_SESSIONS',
            message: 'Cannot delete this test while student sessions are still in progress',
        }
    }

    await hardDeleteTestById(testId)
    return { message: 'Test deleted successfully' }
}

// ── Get Questions (teacher-scoped) ──
export async function getQuestions(teacherId: string, testId: string) {
    const test = await prisma.test.findUnique({ where: { id: testId } })
    if (!test) return { error: true, code: 'NOT_FOUND', message: 'Test not found' }
    if (test.teacherId !== teacherId) return { error: true, code: 'FORBIDDEN', message: 'You do not own this test' }

    const questions = await prisma.question.findMany({
        where: { testId },
        orderBy: { order: 'asc' },
    })

    return { questions }
}

// ── Add Question ──
export async function addQuestion(teacherId: string, testId: string, data: CreateQuestionInput) {
    const test = await prisma.test.findUnique({ where: { id: testId } })
    if (!test) return { error: true, code: 'NOT_FOUND', message: 'Test not found' }
    if (test.teacherId !== teacherId) return { error: true, code: 'FORBIDDEN', message: 'You do not own this test' }

    // Lock published + started tests
    if (test.status === 'PUBLISHED' && test.scheduledAt && new Date(test.scheduledAt) <= new Date()) {
        return { error: true, code: 'FORBIDDEN', message: 'Cannot edit a published test after its scheduled time' }
    }
    // Allow if DRAFT or a future PUBLISHED test
    if (test.status !== 'DRAFT' && test.status !== 'PUBLISHED') {
        return { error: true, code: 'NOT_DRAFT', message: 'Can only add questions to draft or future published tests' }
    }

    // Get next order number
    const lastQuestion = await prisma.question.findFirst({
        where: { testId },
        orderBy: { order: 'desc' },
        select: { order: true },
    })
    const nextOrder = (lastQuestion?.order ?? 0) + 1

    const question = await prisma.question.create({
        data: {
            testId,
            order: nextOrder,
            stem: data.stem,
            options: data.options as unknown as Prisma.InputJsonValue,
            explanation: data.explanation,
            difficulty: data.difficulty as Difficulty,
            topic: data.topic,
        },
    })

    return { question }
}

// ── Update Question ──
export async function updateQuestion(teacherId: string, testId: string, questionId: string, data: UpdateQuestionInput) {
    const test = await prisma.test.findUnique({ where: { id: testId } })
    if (!test) return { error: true, code: 'NOT_FOUND', message: 'Test not found' }
    if (test.teacherId !== teacherId) return { error: true, code: 'FORBIDDEN', message: 'You do not own this test' }

    const existing = await prisma.question.findUnique({ where: { id: questionId } })
    if (!existing || existing.testId !== testId) {
        return { error: true, code: 'NOT_FOUND', message: 'Question not found in this test' }
    }

    // Lock published + started tests
    if (test.status === 'PUBLISHED' && test.scheduledAt && new Date(test.scheduledAt) <= new Date()) {
        return { error: true, code: 'FORBIDDEN', message: 'Cannot edit a published test after its scheduled time' }
    }
    // Allow if DRAFT or a future PUBLISHED test
    if (test.status !== 'DRAFT' && test.status !== 'PUBLISHED') {
        return { error: true, code: 'NOT_DRAFT', message: 'Can only edit questions in draft or future published tests' }
    }

    const updateData: Prisma.QuestionUpdateInput = {}
    if (data.stem) updateData.stem = data.stem
    if (data.options) updateData.options = data.options as unknown as Prisma.InputJsonValue
    if (data.explanation !== undefined) updateData.explanation = data.explanation
    if (data.difficulty) updateData.difficulty = data.difficulty as Difficulty
    if (data.topic !== undefined) updateData.topic = data.topic

    const question = await prisma.question.update({ where: { id: questionId }, data: updateData })
    return { question }
}

// ── Delete Question + Reorder ──
export async function deleteQuestion(teacherId: string, testId: string, questionId: string) {
    const test = await prisma.test.findUnique({ where: { id: testId } })
    if (!test) return { error: true, code: 'NOT_FOUND', message: 'Test not found' }
    if (test.teacherId !== teacherId) return { error: true, code: 'FORBIDDEN', message: 'You do not own this test' }

    const question = await prisma.question.findUnique({ where: { id: questionId } })
    if (!question || question.testId !== testId) {
        return { error: true, code: 'NOT_FOUND', message: 'Question not found in this test' }
    }

    // Lock published + started tests
    if (test.status === 'PUBLISHED' && test.scheduledAt && new Date(test.scheduledAt) <= new Date()) {
        return { error: true, code: 'FORBIDDEN', message: 'Cannot delete from a published test after its scheduled time' }
    }
    // Allow if DRAFT or a future PUBLISHED test
    if (test.status !== 'DRAFT' && test.status !== 'PUBLISHED') {
        return { error: true, code: 'NOT_DRAFT', message: 'Can only delete questions from draft or future published tests' }
    }

    // Delete and reorder remaining
    await prisma.$transaction([
        prisma.question.delete({ where: { id: questionId } }),
        prisma.$executeRaw`
            UPDATE "Question" SET "order" = "order" - 1
            WHERE "testId" = ${testId}::uuid AND "order" > ${question.order}
        `,
    ])

    return { message: 'Question deleted and remaining questions reordered' }
}

// ── Assign Test (to batches and/or students) ──
export async function assignTest(teacherId: string, testId: string, data: AssignTestInput) {
    const test = await prisma.test.findUnique({ where: { id: testId } })
    if (!test) return { error: true, code: 'NOT_FOUND', message: 'Test not found' }
    if (test.teacherId !== teacherId) return { error: true, code: 'FORBIDDEN', message: 'You do not own this test' }
    // We allow assigning a test even in DRAFT status so the UI can save batch checkboxes before publishing.


    const assignments: { testId: string; batchId?: string; studentId?: string }[] = []

    if (data.batchIds) {
        // Clear previous batch assignments to sync state with the UI
        await prisma.testAssignment.deleteMany({
            where: { testId, batchId: { not: null } }
        })
        for (const batchId of data.batchIds) {
            assignments.push({ testId, batchId })
        }
    }
    if (data.studentIds) {
        for (const studentId of data.studentIds) {
            assignments.push({ testId, studentId })
        }
    }

    const result = await prisma.testAssignment.createMany({
        data: assignments,
        skipDuplicates: true,
    })

    return { assigned: result.count, total: assignments.length }
}
