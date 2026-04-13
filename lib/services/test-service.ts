import { BatchKind, Difficulty, Prisma, Role, SessionStatus, TestStatus } from '@prisma/client'

import { FREE_BATCH_KIND, STANDARD_BATCH_KIND } from '@/lib/config/platform-policy'
import { prisma } from '@/lib/prisma'
import {
    attachSharedContextsFromPdf,
    enrichGeneratedQuestionsMetadata,
    extractVisualReferencesFromPdfImages,
    extractQuestionsFromPdfMultimodal,
    extractQuestionsFromDocumentTextPrecisely,
    generateQuestionsFromPdfVisionFallback,
    generateQuestionsFromText,
    parseDocumentToText,
    reconcileGeneratedQuestionsWithTextAnswerHints,
    verifyExtractedQuestions,
    verifyExtractedQuestionsWithAI,
} from '@/lib/services/ai-service'
import type { VerificationResult } from '@/lib/services/ai-extraction-schemas'
import { mergeAIVerificationIssues, resolveImportVerificationOutcome } from '@/lib/services/import-verifier'
import type { DocumentClassificationResult } from '@/lib/services/document-classifier'
import { classifyDocumentForImport } from '@/lib/services/document-classifier'
import { executeDocumentImportPlan } from '@/lib/services/document-import-executor'
import {
    isClassifierRoutingEnabled,
    type DocumentImportRoutingMode,
    resolveDocumentImportPlan,
} from '@/lib/services/document-import-strategy'
import { getTestSearchTokens } from '@/lib/utils/test-search'
import { resolveTestSettings } from '@/lib/utils/test-settings'
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

type ServiceErrorCode =
    | 'ACTIVE_SESSIONS'
    | 'BAD_REQUEST'
    | 'FORBIDDEN'
    | 'GENERATION_FAILED'
    | 'INACTIVE_ADMIN'
    | 'INVALID_TRANSITION'
    | 'NO_ASSIGNMENTS'
    | 'NO_QUESTIONS'
    | 'NOT_DRAFT'
    | 'NOT_EDITABLE'
    | 'NOT_FOUND'
    | 'PARSE_ERROR'
    | 'UNSUPPORTED_DIRECT_ASSIGNMENTS'
    | 'WINDOW_OPEN'

export type TestServiceError = {
    error: true
    code: ServiceErrorCode
    message: string
    details?: Record<string, unknown>
    retryAfter?: number
}

type BatchAudience = 'FREE' | 'PAID' | 'HYBRID' | 'UNASSIGNED'

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

function countExtractedValidationFailures(extracted: Awaited<ReturnType<typeof extractQuestionsFromDocumentTextPrecisely>>) {
    if (extracted.expectedQuestionCount !== null) {
        return Math.max(0, extracted.expectedQuestionCount - extracted.questions.length)
    }

    if (extracted.missingQuestionNumbers.length > 0) {
        return extracted.missingQuestionNumbers.length
    }

    return 0
}

type AdminDocumentGenerationInput = {
    adminId: string
    file: File
    title?: string | null
    requestedCount?: number | null
    ipAddress?: string | null
}

type DocumentImportDiagnostics = {
    parserStatus: 'OK' | 'FAILED' | 'WEAK_OUTPUT' | 'REPAIRED'
    aiFallbackUsed: boolean
    reportParserIssue: boolean
    warning: string | null
    decision?: 'EXACT_ACCEPTED' | 'REVIEW_REQUIRED' | 'FAILED_WITH_REASON'
    failureReason?: string | null
    classification?: DocumentClassificationResult
    routingMode?: DocumentImportRoutingMode
    selectedStrategy?: DocumentClassificationResult['preferredStrategy']
    reviewRequired?: boolean
    reviewIssueCount?: number
    metadataAiUsed?: boolean
}

type QuestionImportEvidencePayload = {
    sourcePage: number | null
    sourceSnippet: string | null
    sharedContextEvidence: string | null
    answerSource: string | null
    confidence: number | null
    extractionMode: string | null
}

type TestImportDiagnosticsPayload = DocumentImportDiagnostics & {
    fileName: string
    fileSize: number
    strategy: 'EXTRACTED' | 'AI_GENERATED' | 'AI_VISION_FALLBACK'
    fallbackPageCount: number | null
    fallbackChunkCount: number | null
    extractedQuestionCandidates: number
    extractedQuestions: number
    questionsGenerated: number
    failedCount: number
    generationTarget: number | null
    detectedQuestionCount: number | null
    costUSD: number
    metadataWarning: string | null
    primaryTopic: string | null
    difficultyDistribution: { easy: number; medium: number; hard: number } | null
    decision: 'EXACT_ACCEPTED' | 'REVIEW_REQUIRED' | 'FAILED_WITH_REASON'
    failureReason: string | null
    reviewStatus: string | null
    verification: VerificationResult | null
}

type GeneratedTextQuestionsResult = Awaited<ReturnType<typeof generateQuestionsFromText>>

type DocumentGenerationResult =
    | {
        error: false
        message: undefined
        questions: Awaited<ReturnType<typeof extractQuestionsFromDocumentTextPrecisely>>['questions']
        failedCount: number
        cost: GeneratedTextQuestionsResult['cost']
        verification?: VerificationResult
        pageCount?: number
        chunkCount?: number
    }
    | (GeneratedTextQuestionsResult & {
        verification?: VerificationResult
        pageCount?: number
        chunkCount?: number
    })

type InlineMetadataEnrichmentFallback = {
    questions: Awaited<ReturnType<typeof extractQuestionsFromDocumentTextPrecisely>>['questions']
    description: string
    suggestedTitle: string | null
    suggestedDurationMinutes: number | null
    primaryTopic: string | null
    difficultyDistribution: { easy: number; medium: number; hard: number } | null
    aiUsed: boolean
    cost?: undefined
    warning?: string
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

function buildQuestionImportEvidence(question: {
    sourcePage?: number | null
    sourceSnippet?: string | null
    sharedContextEvidence?: string | null
    answerSource?: string | null
    confidence?: number | null
    extractionMode?: string | null
}): Prisma.InputJsonValue {
    const payload: QuestionImportEvidencePayload = {
        sourcePage: question.sourcePage ?? null,
        sourceSnippet: question.sourceSnippet ?? null,
        sharedContextEvidence: question.sharedContextEvidence ?? null,
        answerSource: question.answerSource ?? null,
        confidence: question.confidence ?? null,
        extractionMode: question.extractionMode ?? null,
    }

    return payload as Prisma.InputJsonValue
}

function buildTestImportDiagnosticsPayload(input: TestImportDiagnosticsPayload): Prisma.InputJsonValue {
    return input as Prisma.InputJsonValue
}

function buildFallbackDocumentDescriptionForImport(
    questions: Awaited<ReturnType<typeof extractQuestionsFromDocumentTextPrecisely>>['questions'],
    sourceLabel?: string | null,
) {
    const totalQuestions = questions.length
    const topicCounts = new Map<string, number>()

    for (const question of questions) {
        const topic = typeof question.topic === 'string' && question.topic.trim().length > 0
            ? question.topic.trim()
            : 'General aptitude'
        topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1)
    }

    const topTopics = [...topicCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([topic]) => topic)

    const sourceText = sourceLabel?.replace(/\.(docx|pdf)$/i, '').trim() || 'uploaded document'
    const topicText = topTopics.length > 0 ? topTopics.join(', ') : 'core syllabus concepts'

    return `This CUET mock test from ${sourceText} covers ${topicText} across ${totalQuestions} questions. It preserves the uploaded paper structure for review before publishing.`.slice(0, 280)
}

function buildFallbackDifficultyDistribution(
    questions: Awaited<ReturnType<typeof extractQuestionsFromDocumentTextPrecisely>>['questions'],
) {
    if (questions.length === 0) {
        return null
    }

    return questions.reduce(
        (distribution, question) => {
            if (question.difficulty === Difficulty.EASY) distribution.easy += 1
            else if (question.difficulty === Difficulty.HARD) distribution.hard += 1
            else distribution.medium += 1
            return distribution
        },
        { easy: 0, medium: 0, hard: 0 },
    )
}

function buildFallbackMetadataEnrichment(
    questions: Awaited<ReturnType<typeof extractQuestionsFromDocumentTextPrecisely>>['questions'],
    sourceLabel?: string | null,
): InlineMetadataEnrichmentFallback {
    const topicCounts = new Map<string, number>()
    for (const question of questions) {
        const topic = question.topic?.trim()
        if (topic) {
            topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1)
        }
    }

    const primaryTopic = [...topicCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([topic]) => topic)[0] ?? null

    return {
        questions,
        description: buildFallbackDocumentDescriptionForImport(questions, sourceLabel),
        suggestedTitle: null,
        suggestedDurationMinutes: Math.max(15, questions.length * 2),
        primaryTopic,
        difficultyDistribution: buildFallbackDifficultyDistribution(questions),
        aiUsed: false,
    }
}

function shouldRunInlineAiPostProcessing(input: {
    isPdfUpload: boolean
    questionCount: number
    strategy: 'EXTRACTED' | 'AI_GENERATED' | 'AI_VISION_FALLBACK'
    routingMode?: DocumentImportRoutingMode
}) {
    if (input.questionCount >= MIN_GENERATED_QUESTIONS) {
        return false
    }

    if (input.isPdfUpload) {
        return false
    }

    if (input.routingMode === 'CLASSIFIER') {
        return false
    }

    return input.strategy === 'AI_GENERATED'
}

export function classifyBatchAudience(batchKinds: readonly BatchKind[]): BatchAudience {
    if (batchKinds.length === 0) {
        return 'UNASSIGNED'
    }

    const hasFreeBatch = batchKinds.includes(FREE_BATCH_KIND)
    const hasStandardBatch = batchKinds.includes(STANDARD_BATCH_KIND)

    if (hasFreeBatch && hasStandardBatch) {
        return 'HYBRID'
    }

    if (hasFreeBatch) {
        return 'FREE'
    }

    return 'PAID'
}

export function validateBatchAudienceConsistency(batchKinds: readonly BatchKind[]) {
    void batchKinds
    return null
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

function isPublishedDurationOnlyUpdate(existingStatus: TestStatus, data: UpdateTestInput) {
    if (existingStatus !== 'PUBLISHED' || data.durationMinutes === undefined) {
        return false
    }

    const allowedKeys = new Set(['durationMinutes', 'status'])
    const keys = Object.keys(data)

    if (keys.some((key) => !allowedKeys.has(key))) {
        return false
    }

    return data.status === undefined || data.status === 'PUBLISHED'
}

function isPublishedTitleOnlyUpdate(existingStatus: TestStatus, data: UpdateTestInput) {
    if (existingStatus !== 'PUBLISHED' || data.title === undefined) {
        return false
    }

    const allowedKeys = new Set(['title'])
    const keys = Object.keys(data)

    if (keys.some((key) => !allowedKeys.has(key))) {
        return false
    }

    return true
}

export function validatePublishedDurationRepublish(status: TestStatus, data: UpdateTestInput) {
    return isPublishedDurationOnlyUpdate(status, data)
}

export function validatePublishedTitleUpdate(status: TestStatus, data: UpdateTestInput) {
    return isPublishedTitleOnlyUpdate(status, data)
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

    return resolveTestSettings({
        ...currentValue,
        ...nextValue,
    }) as Prisma.InputJsonObject
}

function buildSearchWhere(query: TestQueryInput): Prisma.TestWhereInput {
    const where: Prisma.TestWhereInput = {}

    if (query.status) {
        where.status = query.status
    }

    if (query.search) {
        const searchTokens = getTestSearchTokens(query.search)

        if (searchTokens.length > 0) {
            where.AND = searchTokens.map((token) => ({
                title: {
                    contains: token,
                    mode: 'insensitive',
                },
            }))
        }
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

function ensureAssignmentEditable(status: TestStatus) {
    if (status === 'DRAFT' || status === 'PUBLISHED') {
        return null
    }

    return serviceError('NOT_EDITABLE', 'Archived tests are read-only')
}

export function validateAssignmentEditableStatus(status: TestStatus) {
    return ensureAssignmentEditable(status)
}

async function ensureActiveAdmin(adminId: string) {
    const admin = await prisma.user.findUnique({
        where: { id: adminId },
        select: { id: true, role: true, status: true },
    })

    if (!admin || (admin.role !== Role.ADMIN && admin.role !== Role.SUB_ADMIN)) {
        return serviceError('FORBIDDEN', 'Only admin operators can manage tests through this route')
    }

    if (admin.status !== 'ACTIVE') {
        return serviceError('INACTIVE_ADMIN', 'Only active admin operators can manage tests')
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
            canEditTitle: test.status === 'DRAFT' || test.status === 'PUBLISHED',
            canEditDuration: test.status === 'DRAFT' || test.status === 'PUBLISHED',
            canManageAssignments: test.status !== 'ARCHIVED',
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
            createdById: admin.id,
            title: data.title,
            description: data.description,
            durationMinutes: data.durationMinutes,
            settings: resolveTestSettings(data.settings) as Prisma.InputJsonValue,
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
    const publishedDurationOnlyUpdate = isPublishedDurationOnlyUpdate(existing.status, data)
    const publishedTitleOnlyUpdate = isPublishedTitleOnlyUpdate(existing.status, data)
    const publishedAllowedMetadataUpdate = publishedDurationOnlyUpdate || publishedTitleOnlyUpdate

    if (metadataUpdateRequested && !publishedAllowedMetadataUpdate) {
        const editableError = ensureDraftEditable(existing.status)
        if (editableError) {
            return editableError
        }
    }

    if (data.status === 'PUBLISHED' && !publishedAllowedMetadataUpdate) {
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
    } else if (existing.status !== 'DRAFT' && !isStatusOnlyArchiveRequest(existing.status, data) && !publishedAllowedMetadataUpdate) {
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
            sharedContext: true,
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
            sharedContext: data.sharedContext,
            options: data.options as unknown as Prisma.InputJsonValue,
            explanation: data.explanation,
            difficulty: (data.difficulty ?? 'MEDIUM') as Difficulty,
            topic: data.topic,
        },
        select: {
            id: true,
            order: true,
            stem: true,
            sharedContext: true,
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
    if (data.sharedContext !== undefined) {
        updateData.sharedContext = data.sharedContext
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
            sharedContext: true,
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

    const editableError = ensureAssignmentEditable(test.status)
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

    const uploadValidation = validateAdminDocumentUpload({
        fileName: input.file.name,
        fileSize: input.file.size,
        requestedCount: input.requestedCount,
    })

    if ('error' in uploadValidation) {
        return uploadValidation
    }

    const buffer = Buffer.from(await input.file.arrayBuffer())
    let text = ''
    let parseError: unknown = null
    let importDiagnostics: DocumentImportDiagnostics = {
        parserStatus: 'OK',
        aiFallbackUsed: false,
        reportParserIssue: false,
        warning: null,
        metadataAiUsed: false,
    }

    try {
        text = await parseDocumentToText(buffer, uploadValidation.sanitizedFileName)
    } catch (error) {
        parseError = error
        console.error('[AI-DOC][ADMIN] Failed to parse uploaded document:', error)
    }

    importDiagnostics.classification = classifyDocumentForImport({
        fileName: uploadValidation.sanitizedFileName,
        text,
        parseFailed: Boolean(parseError),
    })

    let extracted: Awaited<ReturnType<typeof extractQuestionsFromDocumentTextPrecisely>> = {
        detectedAsMcqDocument: false,
        answerHintCount: 0,
        candidateBlockCount: 0,
        questions: [] as Awaited<ReturnType<typeof extractQuestionsFromDocumentTextPrecisely>>['questions'],
        expectedQuestionCount: null as number | null,
        exactMatchAchieved: false,
        invalidQuestionNumbers: [] as number[],
        missingQuestionNumbers: [] as number[],
        duplicateQuestionNumbers: [] as number[],
        aiRepairUsed: false,
        cost: undefined as Awaited<ReturnType<typeof extractQuestionsFromDocumentTextPrecisely>>['cost'],
        error: undefined as boolean | undefined,
        message: undefined as string | undefined,
    }

    const isPdfUpload = uploadValidation.sanitizedFileName.toLowerCase().endsWith('.pdf')
    const importPlan = resolveDocumentImportPlan({
        classifierRoutingEnabled: isClassifierRoutingEnabled(),
        classification: importDiagnostics.classification,
        isPdfUpload,
    })
    const effectiveGenerationTarget =
        importDiagnostics.classification.documentType === 'MCQ_PAPER'
        && importDiagnostics.classification.detectedQuestionCount
            ? importDiagnostics.classification.detectedQuestionCount
            : uploadValidation.generationTarget
    importDiagnostics.routingMode = importPlan.routingMode
    importDiagnostics.selectedStrategy = importPlan.selectedStrategy

    let needsAdminReview = false
    let reviewIssueCount = 0

    let strategy: 'EXTRACTED' | 'AI_GENERATED' | 'AI_VISION_FALLBACK'
    let result: DocumentGenerationResult
    const dispatched = await executeDocumentImportPlan(
        {
            plan: importPlan,
            isPdfUpload,
            textLength: text.length,
            parseFailed: Boolean(parseError),
            generationTarget: effectiveGenerationTarget,
        },
        {
            extractTextExact: async () => {
                if (text.length < 50) {
                    return extracted
                }

                const exact = await extractQuestionsFromDocumentTextPrecisely(text, admin.id)
                extracted = exact
                return exact
            },
            extractMultimodal: (target) => extractQuestionsFromPdfMultimodal(
                buffer,
                target,
                admin.id,
                uploadValidation.sanitizedFileName,
                { preferChunkedVisualExtraction: importPlan.visualReferenceOverlay },
            ),
            extractVisualReferences: () => extractVisualReferencesFromPdfImages(
                buffer,
                admin.id,
                uploadValidation.sanitizedFileName,
            ),
            generateFromText: (target) => generateQuestionsFromText(text, target, admin.id),
            generateFromPdfVision: (target) => generateQuestionsFromPdfVisionFallback(
                buffer,
                target,
                admin.id,
                uploadValidation.sanitizedFileName,
            ),
        },
    )

    if (dispatched.failure) {
        return serviceError(dispatched.failure.code, dispatched.failure.message)
    }

    if (!dispatched.useLegacyFlow) {
        strategy = dispatched.strategy!
        result = dispatched.result!

        if (dispatched.extracted) {
            extracted = dispatched.extracted
        }

        if (dispatched.parserStatus) {
            importDiagnostics.parserStatus = dispatched.parserStatus
        }
        if (dispatched.aiFallbackUsed !== undefined) {
            importDiagnostics.aiFallbackUsed = dispatched.aiFallbackUsed
        }
        if (dispatched.reportParserIssue !== undefined) {
            importDiagnostics.reportParserIssue = dispatched.reportParserIssue
        }
        if (dispatched.warning !== undefined) {
            importDiagnostics.warning = dispatched.warning
        }

        needsAdminReview = dispatched.needsAdminReview ?? false
        reviewIssueCount = dispatched.reviewIssueCount ?? 0
    } else {
        if (text.length >= 50) {
            extracted = await extractQuestionsFromDocumentTextPrecisely(text, admin.id)
        }

        if (extracted.detectedAsMcqDocument && extracted.error && !isPdfUpload) {
            return serviceError(
                'GENERATION_FAILED',
                extracted.message || 'Failed to recover an exact MCQ set from the document.',
                {
                    expectedQuestionCount: extracted.expectedQuestionCount,
                    missingQuestionNumbers: extracted.missingQuestionNumbers,
                    invalidQuestionNumbers: extracted.invalidQuestionNumbers,
                    duplicateQuestionNumbers: extracted.duplicateQuestionNumbers,
                },
            )
        }

        const parserProducedWeakPdfOutput =
            isPdfUpload
            && !parseError
            && (
                Boolean(extracted.error)
                || text.length < 50
                || (
                    !extracted.detectedAsMcqDocument
                    &&
                    extracted.candidateBlockCount >= 5
                    && extracted.questions.length < Math.max(3, Math.floor(extracted.candidateBlockCount * 0.35))
                )
            )

        if (parseError || parserProducedWeakPdfOutput) {
            if (!isPdfUpload) {
                return serviceError(
                    'PARSE_ERROR',
                    'Failed to parse document. Ensure it is a valid .docx or text-based .pdf file.',
                )
            }

            const multimodal = await extractQuestionsFromPdfMultimodal(
                buffer,
                extracted.expectedQuestionCount ?? effectiveGenerationTarget,
                admin.id,
                uploadValidation.sanitizedFileName,
            )

            if (!multimodal.error && multimodal.questions && multimodal.questions.length > 0) {
                if (
                    multimodal.verification
                    && (!multimodal.verification.passed || multimodal.verification.reviewRecommended)
                ) {
                    needsAdminReview = true
                    reviewIssueCount = multimodal.verification.issues.length
                }

                importDiagnostics = {
                    parserStatus: parseError || extracted.error ? 'FAILED' : 'WEAK_OUTPUT',
                    aiFallbackUsed: true,
                    reportParserIssue: Boolean(parseError || extracted.error || needsAdminReview),
                    warning: needsAdminReview
                        ? `AI multimodal extraction recovered this PDF with ${reviewIssueCount} issue(s). The draft has been flagged for admin review before publishing.`
                        : (
                            parseError
                                ? 'AI took the lead because the PDF parser failed on this file. Please inform engineering so the parser can be improved for this document type.'
                                : 'AI took the lead because the PDF parser produced weak structured output on this file. Please inform engineering so the parser can be improved for this document type.'
                        ),
                    reviewRequired: needsAdminReview,
                    reviewIssueCount,
                }

                strategy = 'AI_VISION_FALLBACK'
                result = multimodal
            } else {
                if (text.length < 50) {
                    return serviceError(
                        parseError ? 'PARSE_ERROR' : 'GENERATION_FAILED',
                        multimodal.message || (
                            parseError
                                ? 'Failed to parse the PDF and multimodal extraction could not recover the document.'
                                : 'The PDF parser produced weak output and multimodal extraction could not recover the document.'
                        ),
                    )
                }

                const fallback = await generateQuestionsFromText(
                    text,
                    effectiveGenerationTarget,
                    admin.id,
                )

                if (fallback.error || !fallback.questions || fallback.questions.length === 0) {
                    return serviceError(
                        parseError ? 'PARSE_ERROR' : 'GENERATION_FAILED',
                        fallback.message || multimodal.message || (
                            parseError
                                ? 'Failed to parse the PDF and AI fallback could not recover the document.'
                                : 'The PDF parser produced weak output and AI fallback could not recover the document.'
                        ),
                    )
                }

                const fallbackVerification = verifyExtractedQuestions(
                    fallback.questions,
                    null,
                    {
                        extractionAnalysis: extracted,
                        comparisonQuestions: extracted.questions,
                    },
                )
                if (!fallbackVerification.passed || fallbackVerification.reviewRecommended) {
                    needsAdminReview = true
                    reviewIssueCount = fallbackVerification.issues.length
                }

                importDiagnostics = {
                    parserStatus: parseError || extracted.error ? 'FAILED' : 'WEAK_OUTPUT',
                    aiFallbackUsed: true,
                    reportParserIssue: true,
                    warning: needsAdminReview
                        ? `AI fallback recovered this PDF with ${reviewIssueCount} issue(s). The draft has been flagged for admin review before publishing.`
                        : (
                            parseError
                                ? 'AI took the lead because the PDF parser failed on this file. Please inform engineering so the parser can be improved for this document type.'
                                : 'AI took the lead because the PDF parser produced weak structured output on this file. Please inform engineering so the parser can be improved for this document type.'
                        ),
                    reviewRequired: needsAdminReview,
                    reviewIssueCount,
                }

                strategy = 'AI_VISION_FALLBACK'
                result = {
                    ...fallback,
                    verification: fallbackVerification,
                }
            }
        } else {
            if (text.length < 50) {
                return serviceError(
                    'BAD_REQUEST',
                    'Document has too little text to generate questions from.',
                )
            }

            strategy = extracted.detectedAsMcqDocument ? 'EXTRACTED' : 'AI_GENERATED'
            result = extracted.detectedAsMcqDocument
                ? {
                    error: false,
                    message: undefined,
                    questions: extracted.questions,
                    failedCount: countExtractedValidationFailures(extracted),
                    cost: extracted.cost,
                }
                : await generateQuestionsFromText(text, effectiveGenerationTarget, admin.id)

            if (
                isPdfUpload
                && strategy === 'AI_GENERATED'
                && (result.error || !result.questions || result.questions.length === 0)
            ) {
                const fallback = await generateQuestionsFromPdfVisionFallback(
                    buffer,
                    effectiveGenerationTarget,
                    admin.id,
                    uploadValidation.sanitizedFileName,
                )

                if (!fallback.error && fallback.questions && fallback.questions.length > 0) {
                    importDiagnostics = {
                        parserStatus: 'WEAK_OUTPUT',
                        aiFallbackUsed: true,
                        reportParserIssue: true,
                        warning: 'AI took the lead because the PDF parser path could not recover enough usable content from this file. Please inform engineering so the parser can be improved for this document type.',
                    }
                    strategy = 'AI_VISION_FALLBACK'
                    result = fallback
                }
            }

            if (extracted.detectedAsMcqDocument && extracted.aiRepairUsed) {
                importDiagnostics = {
                    parserStatus: 'REPAIRED',
                    aiFallbackUsed: true,
                    reportParserIssue: true,
                    warning: 'AI took the lead because the parser needed help to reconcile this file into an exact MCQ set. Please inform engineering so the parser can be improved for this document type.',
                }
            }
        }
    }

    if (result.error || !result.questions || result.questions.length === 0) {
        return serviceError(
            'GENERATION_FAILED',
            result.message || 'Failed to generate questions.',
        )
    }

    if (isPdfUpload && text.length >= 50 && strategy !== 'AI_GENERATED') {
        const reconciledAnswers = reconcileGeneratedQuestionsWithTextAnswerHints(result.questions, text)
        if (reconciledAnswers.repairedCount > 0) {
            result.questions = reconciledAnswers.questions
            importDiagnostics.warning = importDiagnostics.warning
                ? `${importDiagnostics.warning} Reconciled ${reconciledAnswers.repairedCount} question answer(s) from the PDF text layer.`
                : `Reconciled ${reconciledAnswers.repairedCount} question answer(s) from the PDF text layer.`
        } else {
            result.questions = reconciledAnswers.questions
        }
    }

    let verification: VerificationResult | undefined = verifyExtractedQuestions(
        result.questions,
        strategy === 'AI_GENERATED' ? null : extracted.expectedQuestionCount,
        {
            extractionAnalysis: strategy === 'AI_GENERATED' ? undefined : extracted,
            comparisonQuestions: strategy === 'AI_VISION_FALLBACK' ? extracted.questions : undefined,
        },
    )

    const runInlineAiPostProcessing = shouldRunInlineAiPostProcessing({
        isPdfUpload,
        questionCount: result.questions.length,
        strategy,
        routingMode: importDiagnostics.routingMode,
    })

    // Cross-model AI verification pass
    if (verification && result.questions.length > 0 && runInlineAiPostProcessing) {
        const extractionModel = strategy === 'AI_VISION_FALLBACK' ? 'gpt-4o' : 'gpt-4o-mini'
        const aiVerification = await verifyExtractedQuestionsWithAI(
            result.questions,
            extractionModel,
            admin.id,
        )
        if (aiVerification.issues.length > 0) {
            verification = mergeAIVerificationIssues(verification, aiVerification)
        }
        if (aiVerification.cost) {
            if (result.cost) {
                result.cost.costUSD += aiVerification.cost.costUSD
                result.cost.inputTokens += aiVerification.cost.inputTokens
                result.cost.outputTokens += aiVerification.cost.outputTokens
            } else {
                result.cost = { ...aiVerification.cost }
            }
        }
    }

    let importDecision = resolveImportVerificationOutcome(verification)
    if (importDecision.decision === 'EXACT_ACCEPTED' && needsAdminReview) {
        importDecision = {
            decision: 'REVIEW_REQUIRED',
            message: importDiagnostics.warning || 'Import completed, but the draft needs manual review before publishing.',
            errorCount: 0,
            warningCount: Math.max(reviewIssueCount, 1),
        }
    }

    if (importDecision.decision === 'FAILED_WITH_REASON') {
        return serviceError(
            strategy === 'AI_GENERATED' ? 'GENERATION_FAILED' : 'PARSE_ERROR',
            importDecision.message || 'Import verification failed. Please review the source document and retry.',
            {
                strategy,
                verification,
                routingMode: importDiagnostics.routingMode ?? null,
                selectedStrategy: importDiagnostics.selectedStrategy ?? null,
            },
        )
    }

    if (importDecision.decision === 'REVIEW_REQUIRED') {
        needsAdminReview = true
        reviewIssueCount = verification?.issues.length ?? Math.max(reviewIssueCount, 1)
        importDiagnostics.reviewRequired = true
        importDiagnostics.reviewIssueCount = reviewIssueCount
        importDiagnostics.reportParserIssue = true
        importDiagnostics.warning = importDiagnostics.warning
            ? `${importDiagnostics.warning} Verification also found ${reviewIssueCount} issue(s), so the draft needs admin review.`
            : importDecision.message
                ? `${importDecision.message} The draft has been flagged for admin review before publishing.`
                : `Verification found ${reviewIssueCount} issue(s), so the draft has been flagged for admin review before publishing.`
    }
    importDiagnostics.decision = importDecision.decision
    importDiagnostics.failureReason = importDecision.message

    const baseTitle = uploadValidation.sanitizedFileName.replace(/\.(docx|pdf)$/i, '')
    let questionsWithSharedContext = result.questions
    if (isPdfUpload) {
        try {
            questionsWithSharedContext = await attachSharedContextsFromPdf(buffer, result.questions)
        } catch (error) {
            console.warn('[AI-DOC][ADMIN] Could not attach shared PDF context:', error)
        }
    }
    const metadataEnrichment = runInlineAiPostProcessing
        ? await enrichGeneratedQuestionsMetadata({
            questions: questionsWithSharedContext,
            auditUserId: admin.id,
            sourceLabel: uploadValidation.sanitizedFileName,
        })
        : buildFallbackMetadataEnrichment(
            questionsWithSharedContext,
            uploadValidation.sanitizedFileName,
        )
    const finalQuestions = metadataEnrichment.questions
    const finalDescription = metadataEnrichment.description
    const testTitle = input.title?.trim()
        || metadataEnrichment.suggestedTitle
        || `AI Generated Test - ${baseTitle || new Date().toLocaleDateString()}`
    const testDuration = metadataEnrichment.suggestedDurationMinutes
        ?? Math.max(15, finalQuestions.length * 2)
    importDiagnostics.metadataAiUsed = metadataEnrichment.aiUsed

    if (metadataEnrichment.warning) {
        importDiagnostics.warning = importDiagnostics.warning
            ? `${importDiagnostics.warning} ${metadataEnrichment.warning}`
            : metadataEnrichment.warning
    }

    const test = await prisma.test.create({
        data: {
            createdById: admin.id,
            title: testTitle,
            description: finalDescription,
            durationMinutes: testDuration,
            settings: resolveTestSettings(undefined) as Prisma.InputJsonValue,
            status: 'DRAFT',
            source: 'AI_GENERATED',
            reviewStatus: needsAdminReview ? 'NEEDS_REVIEW' : null,
            importDiagnostics: buildTestImportDiagnosticsPayload({
                ...importDiagnostics,
                fileName: uploadValidation.sanitizedFileName,
                fileSize: input.file.size,
                strategy,
                fallbackPageCount: 'pageCount' in result ? (result.pageCount ?? null) : null,
                fallbackChunkCount: 'chunkCount' in result ? (result.chunkCount ?? null) : null,
                extractedQuestionCandidates: extracted.candidateBlockCount,
                extractedQuestions: extracted.questions.length,
                questionsGenerated: finalQuestions.length,
                failedCount: result.failedCount || 0,
                generationTarget: strategy === 'AI_GENERATED' ? effectiveGenerationTarget : null,
                detectedQuestionCount: importDiagnostics.classification?.detectedQuestionCount ?? null,
                costUSD: (result.cost?.costUSD || 0) + (metadataEnrichment.cost?.costUSD || 0),
                metadataWarning: metadataEnrichment.warning || null,
                primaryTopic: metadataEnrichment.primaryTopic ?? null,
                difficultyDistribution: metadataEnrichment.difficultyDistribution ?? null,
                decision: importDecision.decision,
                failureReason: importDecision.message,
                reviewStatus: needsAdminReview ? 'NEEDS_REVIEW' : null,
                verification: verification ?? null,
            }),
            questions: {
                create: finalQuestions.map((question, index) => ({
                    order: index + 1,
                    stem: question.stem,
                    options: question.options as unknown as Prisma.InputJsonValue,
                    explanation: question.explanation || null,
                    difficulty: (question.difficulty as Difficulty | undefined) || 'MEDIUM',
                    topic: question.topic || null,
                    sharedContext: question.sharedContext || null,
                    importEvidence: buildQuestionImportEvidence(question),
                })),
            },
        },
        select: {
            id: true,
            title: true,
            reviewStatus: true,
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
                parserStatus: importDiagnostics.parserStatus,
                aiFallbackUsed: importDiagnostics.aiFallbackUsed,
                classifier: importDiagnostics.classification ?? null,
                routingMode: importDiagnostics.routingMode ?? null,
                selectedStrategy: importDiagnostics.selectedStrategy ?? null,
                parserWarning: importDiagnostics.warning,
                fallbackPageCount: 'pageCount' in result ? result.pageCount : null,
                fallbackChunkCount: 'chunkCount' in result ? result.chunkCount : null,
                extractedQuestionCandidates: extracted.candidateBlockCount,
                extractedQuestions: extracted.questions.length,
                questionsGenerated: finalQuestions.length,
                failedCount: result.failedCount || 0,
                generationTarget: strategy === 'AI_GENERATED' ? effectiveGenerationTarget : null,
                detectedQuestionCount: importDiagnostics.classification?.detectedQuestionCount ?? null,
                costUSD: (result.cost?.costUSD || 0) + (metadataEnrichment.cost?.costUSD || 0),
                metadataAiUsed: metadataEnrichment.aiUsed,
                metadataWarning: metadataEnrichment.warning || null,
                decision: importDecision.decision,
                failureReason: importDecision.message,
                reviewStatus: needsAdminReview ? 'NEEDS_REVIEW' : null,
                reviewIssueCount,
            } as Prisma.InputJsonValue,
            ipAddress: input.ipAddress || undefined,
        },
    })

    return {
        test,
        strategy,
        extractedQuestions: extracted.questions.length,
        generationTarget: strategy === 'AI_GENERATED' ? effectiveGenerationTarget : null,
        questionsGenerated: finalQuestions.length,
        failedCount: result.failedCount || 0,
        cost: result.cost,
        importDiagnostics,
    }
}
