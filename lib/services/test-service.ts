import { BatchKind, Difficulty, Prisma, Role, SessionStatus, TestStatus } from '@prisma/client'

import { FREE_BATCH_KIND, STANDARD_BATCH_KIND } from '@/lib/config/platform-policy'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import {
    extractQuestionsFromDocumentText,
    generateQuestionsFromText,
    parseDocumentToText,
} from '@/lib/services/ai-service'
import {
    getScheduledTestLifecycle,
    hardDeleteTestById,
    purgeExpiredFinishedTests,
} from '@/lib/services/test-lifecycle'
import type {
    AssignTestInput,
    CreateQuestionInput,
    CreateTestInput,
    TestQueryInput,
    UpdateQuestionInput,
    UpdateTestInput,
} from '@/lib/validations/test.schema'

const COMPLETED_SESSION_STATUSES: SessionStatus[] = ['SUBMITTED', 'TIMED_OUT', 'FORCE_SUBMITTED']
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
const MIN_GENERATED_QUESTIONS = 30
const DOC_GENERATION_RATE_LIMIT_MAX = 5
const DOC_GENERATION_RATE_LIMIT_WINDOW_SECONDS = 60 * 60

type ServiceErrorCode =
    | 'ACTIVE_SESSIONS'
    | 'BAD_REQUEST'
    | 'FORBIDDEN'
    | 'GENERATION_FAILED'
    | 'INACTIVE_ADMIN'
    | 'INVALID_ASSIGNMENT_MIX'
    | 'INVALID_TRANSITION'
    | 'NO_ASSIGNMENTS'
    | 'NO_QUESTIONS'
    | 'NOT_DRAFT'
    | 'NOT_EDITABLE'
    | 'NOT_FOUND'
    | 'PARSE_ERROR'
    | 'RATE_LIMITED'
    | 'UNSUPPORTED_DIRECT_ASSIGNMENTS'
    | 'WINDOW_OPEN'

export type TestServiceError = {
    error: true
    code: ServiceErrorCode
    message: string
    details?: Record<string, unknown>
    retryAfter?: number
}

type BatchAudience = 'FREE' | 'PAID' | 'UNASSIGNED' | 'INVALID'

type DocumentUploadValidationInput = {
    fileName?: string | null
    fileSize?: number | null
    requestedCount?: number | null
}

type DocumentUploadValidationResult = {
    sanitizedFileName: string
    generationTarget: number
}

type BatchSummary = {
    id: string
    name: string
    code: string
    kind: BatchKind
}

type AdminDocumentGenerationInput = {
    adminId: string
    file: File
    title?: string | null
    requestedCount?: number | null
    ipAddress?: string | null
}

function serviceError(
    code: ServiceErrorCode,
    message: string,
    details?: Record<string, unknown>,
    retryAfter?: number
): TestServiceError {
    return {
        error: true,
        code,
        message,
        details,
        ...(retryAfter !== undefined ? { retryAfter } : {}),
    }
}

function dedupeIds(ids: string[] | undefined) {
    return [...new Set(ids ?? [])]
}

export function classifyBatchAudience(batchKinds: readonly BatchKind[]): BatchAudience {
    if (batchKinds.length === 0) {
        return 'UNASSIGNED'
    }

    const hasFreeBatch = batchKinds.includes(FREE_BATCH_KIND)
    const hasStandardBatch = batchKinds.includes(STANDARD_BATCH_KIND)

    if (hasFreeBatch && hasStandardBatch) {
        return 'INVALID'
    }

    if (hasFreeBatch) {
        return 'FREE'
    }

    return 'PAID'
}

export function validateBatchAudienceConsistency(batchKinds: readonly BatchKind[]) {
    const audience = classifyBatchAudience(batchKinds)

    if (audience !== 'INVALID') {
        return null
    }

    return serviceError(
        'INVALID_ASSIGNMENT_MIX',
        'Free-system batches cannot be mixed with paid batches in the same assignment.',
    )
}

export function validateAdminDocumentUpload(input: DocumentUploadValidationInput): DocumentUploadValidationResult | TestServiceError {
    const sanitizedFileName = input.fileName?.trim() ?? ''

    if (!sanitizedFileName) {
        return serviceError('BAD_REQUEST', 'No file provided')
    }

    const lowerFileName = sanitizedFileName.toLowerCase()
    const isSupportedDocument = lowerFileName.endsWith('.docx') || lowerFileName.endsWith('.pdf')
    if (!isSupportedDocument) {
        return serviceError('BAD_REQUEST', 'Only .docx and .pdf files are supported')
    }

    if ((input.fileSize ?? 0) > MAX_FILE_SIZE_BYTES) {
        return serviceError(
            'BAD_REQUEST',
            `File too large. Max ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB.`,
        )
    }

    const generationTarget = Number.isFinite(input.requestedCount)
        ? Math.max(MIN_GENERATED_QUESTIONS, Number(input.requestedCount))
        : MIN_GENERATED_QUESTIONS

    return {
        sanitizedFileName,
        generationTarget,
    }
}

export function validatePublishDraftState(input: {
    currentStatus: TestStatus
    questionCount: number
    batchKinds: readonly BatchKind[]
}) {
    if (input.currentStatus !== 'DRAFT') {
        return serviceError('INVALID_TRANSITION', 'Only draft tests can be published')
    }

    if (input.questionCount < 1) {
        return serviceError('NO_QUESTIONS', 'Cannot publish a test with no questions')
    }

    if (input.batchKinds.length < 1) {
        return serviceError('NO_ASSIGNMENTS', 'Assign the test to at least one batch before publishing')
    }

    return validateBatchAudienceConsistency(input.batchKinds)
}

function isStatusOnlyArchiveRequest(existingStatus: TestStatus, data: UpdateTestInput) {
    const nonStatusKeys = Object.keys(data).filter((key) => key !== 'status')
    return existingStatus === 'PUBLISHED' && data.status === 'ARCHIVED' && nonStatusKeys.length === 0
}

function mergeSettings(
    currentSettings: unknown,
    nextSettings: UpdateTestInput['settings'] | CreateTestInput['settings']
): Prisma.InputJsonValue {
    const currentValue = (currentSettings && typeof currentSettings === 'object' && !Array.isArray(currentSettings))
        ? currentSettings as Record<string, unknown>
        : {}

    const nextValue = (nextSettings && typeof nextSettings === 'object' && !Array.isArray(nextSettings))
        ? nextSettings as Record<string, unknown>
        : {}

    return {
        ...currentValue,
        ...nextValue,
    } as Prisma.InputJsonObject
}

function buildSearchWhere(query: TestQueryInput): Prisma.TestWhereInput {
    const where: Prisma.TestWhereInput = {}

    if (query.status) {
        where.status = query.status
    }

    if (query.search) {
        where.OR = [
            { title: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
        ]
    }

    return where
}

function toAssignedBatchSummary(assignments: Array<{ batch: BatchSummary | null }>) {
    return assignments
        .map((assignment) => assignment.batch)
        .filter((batch): batch is BatchSummary => Boolean(batch))
}

function buildAdminTestListItem(test: {
    id: string
    title: string
    description: string | null
    durationMinutes: number
    status: TestStatus
    source: string
    settings: Prisma.JsonValue
    createdAt: Date
    updatedAt: Date
    assignments: Array<{ batch: BatchSummary | null }>
    _count: {
        questions: number
        sessions: number
        leadSessions: number
    }
}) {
    const assignedBatches = toAssignedBatchSummary(test.assignments)
    const batchKinds = assignedBatches.map((batch) => batch.kind)
    const audience = classifyBatchAudience(batchKinds)

    return {
        id: test.id,
        title: test.title,
        description: test.description,
        durationMinutes: test.durationMinutes,
        status: test.status,
        source: test.source,
        settings: test.settings,
        audience,
        questionCount: test._count.questions,
        attemptCount: test._count.sessions + test._count.leadSessions,
        assignmentCount: assignedBatches.length,
        assignedBatches,
        createdAt: test.createdAt,
        updatedAt: test.updatedAt,
    }
}

function ensureDraftEditable(status: TestStatus) {
    if (status === 'DRAFT') {
        return null
    }

    return serviceError(
        'NOT_EDITABLE',
        status === 'PUBLISHED'
            ? 'Published tests are immutable'
            : 'Archived tests are read-only',
    )
}

export function validateDraftEditableStatus(status: TestStatus) {
    return ensureDraftEditable(status)
}

async function ensureActiveAdmin(adminId: string) {
    const admin = await prisma.user.findUnique({
        where: { id: adminId },
        select: { id: true, role: true, status: true },
    })

    if (!admin || admin.role !== Role.ADMIN) {
        return serviceError('FORBIDDEN', 'Only admins can manage tests through this route')
    }

    if (admin.status !== 'ACTIVE') {
        return serviceError('INACTIVE_ADMIN', 'Only active admins can manage tests')
    }

    return admin
}

async function getBatchSummaries(batchIds: string[]) {
    if (batchIds.length === 0) {
        return []
    }

    return prisma.batch.findMany({
        where: { id: { in: batchIds } },
        select: {
            id: true,
            name: true,
            code: true,
            kind: true,
        },
        orderBy: { name: 'asc' },
    })
}

async function getAdminEditableTest(testId: string) {
    return prisma.test.findUnique({
        where: { id: testId },
        select: {
            id: true,
            title: true,
            status: true,
            settings: true,
            _count: {
                select: {
                    questions: true,
                },
            },
            assignments: {
                where: { batchId: { not: null } },
                select: {
                    batch: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                            kind: true,
                        },
                    },
                },
                orderBy: {
                    batch: {
                        name: 'asc',
                    },
                },
            },
        },
    })
}

async function createDeleteAuditLog(tx: Prisma.TransactionClient, input: {
    actorId: string
    test: {
        id: string
        title: string
        status: TestStatus
        assignments: Array<{ batch: BatchSummary | null }>
    }
}) {
    const assignedBatches = toAssignedBatchSummary(input.test.assignments)

    await tx.auditLog.create({
        data: {
            userId: input.actorId,
            action: 'TEST_DELETED',
            metadata: {
                testId: input.test.id,
                title: input.test.title,
                status: input.test.status,
                audience: classifyBatchAudience(assignedBatches.map((batch) => batch.kind)),
                assignedBatchIds: assignedBatches.map((batch) => batch.id),
                assignedBatchCodes: assignedBatches.map((batch) => batch.code),
            } as Prisma.InputJsonValue,
        },
    })
}

export async function listAdminTests(query: TestQueryInput) {
    const { page, limit } = query
    const skip = (page - 1) * limit
    const where = buildSearchWhere(query)

    const [tests, total] = await Promise.all([
        prisma.test.findMany({
            where,
            select: {
                id: true,
                title: true,
                description: true,
                durationMinutes: true,
                status: true,
                source: true,
                settings: true,
                createdAt: true,
                updatedAt: true,
                assignments: {
                    where: { batchId: { not: null } },
                    select: {
                        batch: {
                            select: {
                                id: true,
                                name: true,
                                code: true,
                                kind: true,
                            },
                        },
                    },
                    orderBy: {
                        batch: {
                            name: 'asc',
                        },
                    },
                },
                _count: {
                    select: {
                        questions: true,
                        sessions: true,
                        leadSessions: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
        }),
        prisma.test.count({ where }),
    ] as const)

    return {
        tests: tests.map(buildAdminTestListItem),
        total,
        page,
        totalPages: Math.ceil(total / limit),
    }
}

export async function getAdminTest(testId: string) {
    const test = await prisma.test.findUnique({
        where: { id: testId },
        select: {
            id: true,
            title: true,
            description: true,
            durationMinutes: true,
            status: true,
            source: true,
            settings: true,
            createdAt: true,
            updatedAt: true,
            assignments: {
                where: { batchId: { not: null } },
                select: {
                    batch: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                            kind: true,
                        },
                    },
                },
                orderBy: {
                    batch: {
                        name: 'asc',
                    },
                },
            },
            _count: {
                select: {
                    questions: true,
                    sessions: true,
                    leadSessions: true,
                },
            },
        },
    })

    if (!test) {
        return serviceError('NOT_FOUND', 'Test not found')
    }

    const assignedBatches = toAssignedBatchSummary(test.assignments)

    return {
        test: {
            ...buildAdminTestListItem(test),
            isEditable: test.status === 'DRAFT',
            assignedBatches,
        },
    }
}

export async function createAdminTest(adminId: string, data: CreateTestInput) {
    const admin = await ensureActiveAdmin(adminId)
    if ('error' in admin) {
        return admin
    }

    const test = await prisma.test.create({
        data: {
            teacherId: admin.id,
            createdById: admin.id,
            title: data.title,
            description: data.description,
            durationMinutes: data.durationMinutes,
            settings: (data.settings ?? {}) as Prisma.InputJsonValue,
            status: 'DRAFT',
            source: 'MANUAL',
        },
        select: {
            id: true,
            title: true,
            description: true,
            durationMinutes: true,
            status: true,
            source: true,
            settings: true,
            createdAt: true,
            updatedAt: true,
        },
    })

    return { test }
}

export async function updateAdminTest(adminId: string, testId: string, data: UpdateTestInput) {
    const admin = await ensureActiveAdmin(adminId)
    if ('error' in admin) {
        return admin
    }

    const existing = await getAdminEditableTest(testId)
    if (!existing) {
        return serviceError('NOT_FOUND', 'Test not found')
    }

    const metadataUpdateRequested =
        data.title !== undefined ||
        data.description !== undefined ||
        data.durationMinutes !== undefined ||
        data.settings !== undefined

    if (metadataUpdateRequested) {
        const editableError = ensureDraftEditable(existing.status)
        if (editableError) {
            return editableError
        }
    }

    if (data.status === 'PUBLISHED') {
        const publishError = validatePublishDraftState({
            currentStatus: existing.status,
            questionCount: existing._count.questions,
            batchKinds: toAssignedBatchSummary(existing.assignments).map((batch) => batch.kind),
        })

        if (publishError) {
            return publishError
        }
    } else if (data.status === 'ARCHIVED') {
        if (!isStatusOnlyArchiveRequest(existing.status, data)) {
            return serviceError(
                existing.status === 'PUBLISHED'
                    ? 'INVALID_TRANSITION'
                    : 'NOT_EDITABLE',
                existing.status === 'PUBLISHED'
                    ? 'Archiving is the only allowed change for a published test'
                    : 'Only published tests can be archived',
            )
        }
    } else if (data.status === 'DRAFT' && existing.status !== 'DRAFT') {
        return serviceError('INVALID_TRANSITION', 'Published or archived tests cannot return to draft')
    } else if (!metadataUpdateRequested && data.status === undefined) {
        return serviceError('BAD_REQUEST', 'No valid changes were provided')
    } else if (existing.status !== 'DRAFT' && !isStatusOnlyArchiveRequest(existing.status, data)) {
        const editableError = ensureDraftEditable(existing.status)
        if (editableError) {
            return editableError
        }
    }

    const updateData: Prisma.TestUpdateInput = {}

    if (data.title !== undefined) {
        updateData.title = data.title
    }
    if (data.description !== undefined) {
        updateData.description = data.description
    }
    if (data.durationMinutes !== undefined) {
        updateData.durationMinutes = data.durationMinutes
    }
    if (data.settings !== undefined) {
        updateData.settings = mergeSettings(existing.settings, data.settings)
    }
    if (data.status !== undefined) {
        updateData.status = data.status
    }

    const test = await prisma.test.update({
        where: { id: testId },
        data: updateData,
        select: {
            id: true,
            title: true,
            description: true,
            durationMinutes: true,
            status: true,
            source: true,
            settings: true,
            createdAt: true,
            updatedAt: true,
        },
    })

    return { test }
}

export async function deleteAdminTest(adminId: string, testId: string) {
    const admin = await ensureActiveAdmin(adminId)
    if ('error' in admin) {
        return admin
    }

    const existing = await prisma.test.findUnique({
        where: { id: testId },
        select: {
            id: true,
            title: true,
            status: true,
            assignments: {
                where: { batchId: { not: null } },
                select: {
                    batch: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                            kind: true,
                        },
                    },
                },
            },
        },
    })

    if (!existing) {
        return serviceError('NOT_FOUND', 'Test not found')
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await createDeleteAuditLog(tx, {
            actorId: admin.id,
            test: existing,
        })

        await tx.test.delete({
            where: { id: testId },
        })
    })

    return {
        message: `Test "${existing.title}" deleted successfully`,
    }
}

export async function getAdminQuestions(testId: string) {
    const test = await prisma.test.findUnique({
        where: { id: testId },
        select: { id: true },
    })

    if (!test) {
        return serviceError('NOT_FOUND', 'Test not found')
    }

    const questions = await prisma.question.findMany({
        where: { testId },
        orderBy: { order: 'asc' },
        select: {
            id: true,
            order: true,
            stem: true,
            options: true,
            explanation: true,
            difficulty: true,
            topic: true,
        },
    })

    return { questions }
}

export async function addAdminQuestion(adminId: string, testId: string, data: CreateQuestionInput) {
    const admin = await ensureActiveAdmin(adminId)
    if ('error' in admin) {
        return admin
    }

    const test = await prisma.test.findUnique({
        where: { id: testId },
        select: { id: true, status: true },
    })

    if (!test) {
        return serviceError('NOT_FOUND', 'Test not found')
    }

    const editableError = ensureDraftEditable(test.status)
    if (editableError) {
        return editableError
    }

    const lastQuestion = await prisma.question.findFirst({
        where: { testId },
        orderBy: { order: 'desc' },
        select: { order: true },
    })

    const question = await prisma.question.create({
        data: {
            testId,
            order: (lastQuestion?.order ?? 0) + 1,
            stem: data.stem,
            options: data.options as unknown as Prisma.InputJsonValue,
            explanation: data.explanation,
            difficulty: (data.difficulty ?? 'MEDIUM') as Difficulty,
            topic: data.topic,
        },
        select: {
            id: true,
            order: true,
            stem: true,
            options: true,
            explanation: true,
            difficulty: true,
            topic: true,
        },
    })

    return { question }
}

export async function updateAdminQuestion(
    adminId: string,
    testId: string,
    questionId: string,
    data: UpdateQuestionInput
) {
    const admin = await ensureActiveAdmin(adminId)
    if ('error' in admin) {
        return admin
    }

    const test = await prisma.test.findUnique({
        where: { id: testId },
        select: { id: true, status: true },
    })

    if (!test) {
        return serviceError('NOT_FOUND', 'Test not found')
    }

    const editableError = ensureDraftEditable(test.status)
    if (editableError) {
        return editableError
    }

    const existing = await prisma.question.findUnique({
        where: { id: questionId },
        select: { id: true, testId: true },
    })

    if (!existing || existing.testId !== testId) {
        return serviceError('NOT_FOUND', 'Question not found in this test')
    }

    const updateData: Prisma.QuestionUpdateInput = {}

    if (data.stem !== undefined) {
        updateData.stem = data.stem
    }
    if (data.options !== undefined) {
        updateData.options = data.options as unknown as Prisma.InputJsonValue
    }
    if (data.explanation !== undefined) {
        updateData.explanation = data.explanation
    }
    if (data.difficulty !== undefined) {
        updateData.difficulty = data.difficulty as Difficulty
    }
    if (data.topic !== undefined) {
        updateData.topic = data.topic
    }

    const question = await prisma.question.update({
        where: { id: questionId },
        data: updateData,
        select: {
            id: true,
            order: true,
            stem: true,
            options: true,
            explanation: true,
            difficulty: true,
            topic: true,
        },
    })

    return { question }
}

export async function deleteAdminQuestion(adminId: string, testId: string, questionId: string) {
    const admin = await ensureActiveAdmin(adminId)
    if ('error' in admin) {
        return admin
    }

    const test = await prisma.test.findUnique({
        where: { id: testId },
        select: { id: true, status: true },
    })

    if (!test) {
        return serviceError('NOT_FOUND', 'Test not found')
    }

    const editableError = ensureDraftEditable(test.status)
    if (editableError) {
        return editableError
    }

    const question = await prisma.question.findUnique({
        where: { id: questionId },
        select: { id: true, testId: true, order: true },
    })

    if (!question || question.testId !== testId) {
        return serviceError('NOT_FOUND', 'Question not found in this test')
    }

    await prisma.$transaction([
        prisma.question.delete({ where: { id: questionId } }),
        prisma.$executeRaw`
            UPDATE "Question"
            SET "order" = "order" - 1
            WHERE "testId" = ${testId}::uuid
              AND "order" > ${question.order}
        `,
    ])

    return { message: 'Question deleted and remaining questions reordered' }
}

export async function assignAdminTest(adminId: string, testId: string, data: AssignTestInput) {
    const admin = await ensureActiveAdmin(adminId)
    if ('error' in admin) {
        return admin
    }

    const test = await prisma.test.findUnique({
        where: { id: testId },
        select: { id: true, status: true },
    })

    if (!test) {
        return serviceError('NOT_FOUND', 'Test not found')
    }

    const editableError = ensureDraftEditable(test.status)
    if (editableError) {
        return editableError
    }

    const batchIds = dedupeIds(data.batchIds)
    const studentIds = dedupeIds(data.studentIds)

    if (studentIds.length > 0) {
        return serviceError(
            'UNSUPPORTED_DIRECT_ASSIGNMENTS',
            'Admin test management only supports batch assignments',
        )
    }

    const batches = await getBatchSummaries(batchIds)
    if (batches.length !== batchIds.length) {
        const foundBatchIds = new Set(batches.map((batch) => batch.id))
        const missingBatchIds = batchIds.filter((batchId) => !foundBatchIds.has(batchId))

        return serviceError('NOT_FOUND', 'One or more selected batches could not be found', {
            missingBatchIds,
        })
    }

    const batchConsistencyError = validateBatchAudienceConsistency(batches.map((batch) => batch.kind))
    if (batchConsistencyError) {
        return batchConsistencyError
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.testAssignment.deleteMany({
            where: {
                testId,
                batchId: { not: null },
            },
        })

        if (batches.length > 0) {
            await tx.testAssignment.createMany({
                data: batches.map((batch) => ({
                    testId,
                    batchId: batch.id,
                })),
            })
        }
    })

    return {
        assigned: batches.length,
        total: batches.length,
        audience: classifyBatchAudience(batches.map((batch) => batch.kind)),
        assignedBatches: batches,
    }
}

export async function generateAdminTestFromDocument(input: AdminDocumentGenerationInput) {
    const admin = await ensureActiveAdmin(input.adminId)
    if ('error' in admin) {
        return admin
    }

    const rateLimitKey = `ai:docgen:${admin.id}`
    const currentRequestCount = await redis.incr(rateLimitKey)
    if (currentRequestCount === 1) {
        await redis.expire(rateLimitKey, DOC_GENERATION_RATE_LIMIT_WINDOW_SECONDS)
    }

    if (currentRequestCount > DOC_GENERATION_RATE_LIMIT_MAX) {
        const retryAfter = await redis.ttl(rateLimitKey)
        return serviceError(
            'RATE_LIMITED',
            `Upload limit reached. Try again in ${retryAfter}s.`,
            undefined,
            retryAfter,
        )
    }

    const uploadValidation = validateAdminDocumentUpload({
        fileName: input.file.name,
        fileSize: input.file.size,
        requestedCount: input.requestedCount,
    })

    if ('error' in uploadValidation) {
        return uploadValidation
    }

    let text: string
    try {
        const buffer = Buffer.from(await input.file.arrayBuffer())
        text = await parseDocumentToText(buffer, uploadValidation.sanitizedFileName)
    } catch (error) {
        console.error('[AI-DOC][ADMIN] Failed to parse uploaded document:', error)
        return serviceError(
            'PARSE_ERROR',
            'Failed to parse document. Ensure it is a valid .docx or text-based .pdf file.',
        )
    }

    if (text.length < 50) {
        return serviceError(
            'BAD_REQUEST',
            'Document has too little text to generate questions from.',
        )
    }

    const extracted = extractQuestionsFromDocumentText(text)
    const strategy = extracted.detectedAsMcqDocument ? 'EXTRACTED' : 'AI_GENERATED'
    const result = extracted.detectedAsMcqDocument
        ? {
            error: false,
            message: undefined,
            questions: extracted.questions,
            failedCount: Math.max(0, extracted.candidateBlockCount - extracted.questions.length),
            cost: undefined,
        }
        : await generateQuestionsFromText(text, uploadValidation.generationTarget, admin.id)

    if (result.error || !result.questions || result.questions.length === 0) {
        return serviceError(
            'GENERATION_FAILED',
            result.message || 'Failed to generate questions.',
        )
    }

    const baseTitle = uploadValidation.sanitizedFileName.replace(/\.(docx|pdf)$/i, '')
    const testTitle = (input.title?.trim() || `AI Generated Test - ${baseTitle || new Date().toLocaleDateString()}`)

    const test = await prisma.test.create({
        data: {
            teacherId: admin.id,
            createdById: admin.id,
            title: testTitle,
            description: `Auto-generated from document: ${uploadValidation.sanitizedFileName}`,
            durationMinutes: Math.max(15, result.questions.length * 2),
            status: 'DRAFT',
            source: 'AI_GENERATED',
            questions: {
                create: result.questions.map((question, index) => ({
                    order: index + 1,
                    stem: question.stem,
                    options: question.options as unknown as Prisma.InputJsonValue,
                    explanation: question.explanation || null,
                    difficulty: (question.difficulty as Difficulty | undefined) || 'MEDIUM',
                    topic: question.topic || null,
                })),
            },
        },
        select: {
            id: true,
            title: true,
        },
    })

    await prisma.auditLog.create({
        data: {
            userId: admin.id,
            action: 'AI_GENERATE_FROM_DOC',
            metadata: {
                testId: test.id,
                fileName: uploadValidation.sanitizedFileName,
                fileSize: input.file.size,
                strategy,
                extractedQuestionCandidates: extracted.candidateBlockCount,
                extractedQuestions: extracted.questions.length,
                questionsGenerated: result.questions.length,
                failedCount: result.failedCount || 0,
                generationTarget: strategy === 'AI_GENERATED' ? uploadValidation.generationTarget : null,
                costUSD: result.cost?.costUSD || 0,
            } as Prisma.InputJsonValue,
            ipAddress: input.ipAddress || undefined,
        },
    })

    return {
        test,
        strategy,
        extractedQuestions: extracted.questions.length,
        generationTarget: strategy === 'AI_GENERATED' ? uploadValidation.generationTarget : null,
        questionsGenerated: result.questions.length,
        failedCount: result.failedCount || 0,
        cost: result.cost,
    }
}

/**
 * Legacy teacher-scoped exports remain while teacher routes still exist.
 * These wrappers intentionally preserve route compatibility until part 5 deletes them.
 */

export async function listTests(teacherId: string, query: TestQueryInput) {
    const { status, page, limit } = query
    const skip = (page - 1) * limit

    await purgeExpiredFinishedTests({ teacherId })

    const where: Prisma.TestWhereInput = { teacherId }
    if (status) where.status = status as TestStatus
    if (query.search) {
        where.OR = [
            { title: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
        ]
    }

    const [tests, total] = await Promise.all([
        prisma.test.findMany({
            where,
            include: {
                _count: {
                    select: {
                        questions: true,
                        sessions: { where: { status: { in: COMPLETED_SESSION_STATUSES } } },
                    },
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
    ] as const)

    return {
        tests: tests.map((test) => {
            const lifecycle = getScheduledTestLifecycle(test)
            const hasActiveSessions = test.sessions.length > 0

            return {
                isFinished: test.status === 'PUBLISHED' && lifecycle.isFinished,
                scheduledEndAt: lifecycle.scheduledEndAt,
                retentionExpiresAt: lifecycle.retentionExpiresAt,
                canDelete:
                    test.status === 'DRAFT' ||
                    (test.status === 'PUBLISHED' && lifecycle.isFinished && !hasActiveSessions),
                hasActiveSessions,
                id: test.id,
                title: test.title,
                description: test.description,
                durationMinutes: test.durationMinutes,
                status: test.status,
                source: test.source,
                settings: test.settings,
                scheduledAt: test.scheduledAt,
                questionCount: test._count.questions,
                attemptCount: test._count.sessions,
                createdAt: test.createdAt,
                updatedAt: test.updatedAt,
            }
        }),
        total,
        page,
        totalPages: Math.ceil(total / limit),
    }
}

export async function getTest(teacherId: string, testId: string) {
    const test = await prisma.test.findUnique({
        where: { id: testId },
        include: {
            _count: { select: { questions: true, sessions: true, assignments: true } },
            assignments: { select: { batchId: true } },
        },
    })

    if (!test) {
        return serviceError('NOT_FOUND', 'Test not found')
    }
    if (test.teacherId !== teacherId) {
        return serviceError('FORBIDDEN', 'You do not own this test')
    }

    return {
        test: {
            ...test,
            questionCount: test._count.questions,
            attemptCount: test._count.sessions,
            assignmentCount: test._count.assignments,
        },
    }
}

export async function createTest(teacherId: string, data: CreateTestInput) {
    const teacher = await prisma.user.findUnique({ where: { id: teacherId } })
    if (!teacher || teacher.status !== 'ACTIVE') {
        return serviceError('FORBIDDEN', 'Only active teachers can create tests')
    }

    const test = await prisma.test.create({
        data: {
            teacherId,
            createdById: teacherId,
            title: data.title,
            description: data.description,
            durationMinutes: data.durationMinutes,
            settings: (data.settings ?? {}) as Prisma.InputJsonValue,
            status: 'DRAFT',
            source: 'MANUAL',
        },
    })

    return { test }
}

export async function updateTest(teacherId: string, testId: string, data: UpdateTestInput) {
    const existing = await prisma.test.findUnique({
        where: { id: testId },
        include: {
            _count: { select: { questions: true } },
            assignments: {
                where: { batchId: { not: null } },
                select: {
                    batch: {
                        select: {
                            kind: true,
                        },
                    },
                },
            },
        },
    })

    if (!existing) {
        return serviceError('NOT_FOUND', 'Test not found')
    }
    if (existing.teacherId !== teacherId) {
        return serviceError('FORBIDDEN', 'You do not own this test')
    }

    const metadataUpdateRequested =
        data.title !== undefined ||
        data.description !== undefined ||
        data.durationMinutes !== undefined ||
        data.settings !== undefined

    if (metadataUpdateRequested && existing.status !== 'DRAFT') {
        return serviceError('NOT_EDITABLE', 'Only draft tests can be edited')
    }

    if (data.status === 'PUBLISHED') {
        const publishError = validatePublishDraftState({
            currentStatus: existing.status,
            questionCount: existing._count.questions,
            batchKinds: existing.assignments
                .map((assignment) => assignment.batch?.kind)
                .filter((kind): kind is BatchKind => Boolean(kind)),
        })

        if (publishError) {
            return publishError
        }
    } else if (data.status === 'ARCHIVED') {
        if (!isStatusOnlyArchiveRequest(existing.status, data)) {
            return serviceError(
                existing.status === 'PUBLISHED' ? 'INVALID_TRANSITION' : 'NOT_EDITABLE',
                existing.status === 'PUBLISHED'
                    ? 'Archiving is the only allowed change for a published test'
                    : 'Only published tests can be archived',
            )
        }
    } else if (data.status === 'DRAFT' && existing.status !== 'DRAFT') {
        return serviceError('INVALID_TRANSITION', 'Published or archived tests cannot return to draft')
    } else if (existing.status !== 'DRAFT' && data.status === undefined) {
        return serviceError('NOT_EDITABLE', 'Only draft tests can be edited')
    }

    const updateData: Prisma.TestUpdateInput = {}
    if (data.title !== undefined) updateData.title = data.title
    if (data.description !== undefined) updateData.description = data.description
    if (data.durationMinutes !== undefined) updateData.durationMinutes = data.durationMinutes
    if (data.settings !== undefined) {
        updateData.settings = mergeSettings(existing.settings, data.settings)
    }
    if (data.status !== undefined) updateData.status = data.status as TestStatus

    const test = await prisma.test.update({
        where: { id: testId },
        data: updateData,
    })

    return { test }
}

export async function deleteTest(teacherId: string, testId: string) {
    const existing = await prisma.test.findUnique({ where: { id: testId } })
    if (!existing) {
        return serviceError('NOT_FOUND', 'Test not found')
    }
    if (existing.teacherId !== teacherId) {
        return serviceError('FORBIDDEN', 'You do not own this test')
    }

    if (existing.status === 'DRAFT') {
        await hardDeleteTestById(testId)
        return { message: 'Test deleted successfully' }
    }

    if (existing.status !== 'PUBLISHED') {
        return serviceError('BAD_REQUEST', 'Only draft or finished published tests can be deleted')
    }

    const lifecycle = getScheduledTestLifecycle(existing)
    if (!lifecycle.isFinished) {
        return serviceError('WINDOW_OPEN', 'Published tests can only be deleted after they have finished')
    }

    const activeSessionCount = await prisma.testSession.count({
        where: { testId, status: 'IN_PROGRESS' },
    })
    if (activeSessionCount > 0) {
        return serviceError(
            'ACTIVE_SESSIONS',
            'Cannot delete this test while student sessions are still in progress',
        )
    }

    await hardDeleteTestById(testId)
    return { message: 'Test deleted successfully' }
}

export async function getQuestions(teacherId: string, testId: string) {
    const test = await prisma.test.findUnique({ where: { id: testId } })
    if (!test) {
        return serviceError('NOT_FOUND', 'Test not found')
    }
    if (test.teacherId !== teacherId) {
        return serviceError('FORBIDDEN', 'You do not own this test')
    }

    const questions = await prisma.question.findMany({
        where: { testId },
        orderBy: { order: 'asc' },
    })

    return { questions }
}

export async function addQuestion(teacherId: string, testId: string, data: CreateQuestionInput) {
    const test = await prisma.test.findUnique({ where: { id: testId } })
    if (!test) {
        return serviceError('NOT_FOUND', 'Test not found')
    }
    if (test.teacherId !== teacherId) {
        return serviceError('FORBIDDEN', 'You do not own this test')
    }
    if (test.status !== 'DRAFT') {
        return serviceError('NOT_DRAFT', 'Can only add questions to draft tests')
    }

    const lastQuestion = await prisma.question.findFirst({
        where: { testId },
        orderBy: { order: 'desc' },
        select: { order: true },
    })

    const question = await prisma.question.create({
        data: {
            testId,
            order: (lastQuestion?.order ?? 0) + 1,
            stem: data.stem,
            options: data.options as unknown as Prisma.InputJsonValue,
            explanation: data.explanation,
            difficulty: data.difficulty as Difficulty,
            topic: data.topic,
        },
    })

    return { question }
}

export async function updateQuestion(teacherId: string, testId: string, questionId: string, data: UpdateQuestionInput) {
    const test = await prisma.test.findUnique({ where: { id: testId } })
    if (!test) {
        return serviceError('NOT_FOUND', 'Test not found')
    }
    if (test.teacherId !== teacherId) {
        return serviceError('FORBIDDEN', 'You do not own this test')
    }
    if (test.status !== 'DRAFT') {
        return serviceError('NOT_DRAFT', 'Can only edit questions in draft tests')
    }

    const existing = await prisma.question.findUnique({ where: { id: questionId } })
    if (!existing || existing.testId !== testId) {
        return serviceError('NOT_FOUND', 'Question not found in this test')
    }

    const updateData: Prisma.QuestionUpdateInput = {}
    if (data.stem !== undefined) updateData.stem = data.stem
    if (data.options !== undefined) updateData.options = data.options as unknown as Prisma.InputJsonValue
    if (data.explanation !== undefined) updateData.explanation = data.explanation
    if (data.difficulty !== undefined) updateData.difficulty = data.difficulty as Difficulty
    if (data.topic !== undefined) updateData.topic = data.topic

    const question = await prisma.question.update({ where: { id: questionId }, data: updateData })
    return { question }
}

export async function deleteQuestion(teacherId: string, testId: string, questionId: string) {
    const test = await prisma.test.findUnique({ where: { id: testId } })
    if (!test) {
        return serviceError('NOT_FOUND', 'Test not found')
    }
    if (test.teacherId !== teacherId) {
        return serviceError('FORBIDDEN', 'You do not own this test')
    }
    if (test.status !== 'DRAFT') {
        return serviceError('NOT_DRAFT', 'Can only delete questions from draft tests')
    }

    const question = await prisma.question.findUnique({ where: { id: questionId } })
    if (!question || question.testId !== testId) {
        return serviceError('NOT_FOUND', 'Question not found in this test')
    }

    await prisma.$transaction([
        prisma.question.delete({ where: { id: questionId } }),
        prisma.$executeRaw`
            UPDATE "Question"
            SET "order" = "order" - 1
            WHERE "testId" = ${testId}::uuid
              AND "order" > ${question.order}
        `,
    ])

    return { message: 'Question deleted and remaining questions reordered' }
}

export async function assignTest(teacherId: string, testId: string, data: AssignTestInput) {
    const test = await prisma.test.findUnique({ where: { id: testId } })
    if (!test) {
        return serviceError('NOT_FOUND', 'Test not found')
    }
    if (test.teacherId !== teacherId) {
        return serviceError('FORBIDDEN', 'You do not own this test')
    }
    if (test.status !== 'DRAFT') {
        return serviceError('NOT_DRAFT', 'Can only assign draft tests')
    }

    const batchIds = dedupeIds(data.batchIds)
    const studentIds = dedupeIds(data.studentIds)

    if (batchIds.length > 0) {
        const ownedBatchCount = await prisma.batch.count({
            where: {
                id: { in: batchIds },
                teacherId,
            },
        })

        if (ownedBatchCount !== batchIds.length) {
            return serviceError('FORBIDDEN', 'You can only assign tests to your own batches')
        }

        const batches = await prisma.batch.findMany({
            where: { id: { in: batchIds } },
            select: { kind: true },
        })

        const batchConsistencyError = validateBatchAudienceConsistency(batches.map((batch) => batch.kind))
        if (batchConsistencyError) {
            return batchConsistencyError
        }
    }

    if (studentIds.length > 0) {
        const accessibleStudentRows = await prisma.batchStudent.findMany({
            where: {
                studentId: { in: studentIds },
                batch: { teacherId },
            },
            select: { studentId: true },
            distinct: ['studentId'],
        })

        if (accessibleStudentRows.length !== studentIds.length) {
            return serviceError('FORBIDDEN', 'You can only assign tests to students in your own batches')
        }
    }

    const assignments: { testId: string; batchId?: string; studentId?: string }[] = [
        ...batchIds.map((batchId) => ({ testId, batchId })),
        ...studentIds.map((studentId) => ({ testId, studentId })),
    ]

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        if (data.batchIds) {
            await tx.testAssignment.deleteMany({
                where: { testId, batchId: { not: null } },
            })
        }

        if (data.studentIds) {
            await tx.testAssignment.deleteMany({
                where: { testId, studentId: { not: null } },
            })
        }

        if (assignments.length > 0) {
            await tx.testAssignment.createMany({
                data: assignments,
            })
        }
    })

    return { assigned: assignments.length, total: assignments.length }
}
