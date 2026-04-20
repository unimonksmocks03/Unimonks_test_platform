import {
    BatchKind,
    Difficulty,
    Prisma,
    QuestionReferenceKind,
    QuestionReferenceMode,
    Role,
    TestStatus,
} from '@prisma/client'

import { FREE_BATCH_KIND, STANDARD_BATCH_KIND } from '@/lib/config/platform-policy'
import { prisma } from '@/lib/prisma'
import {
    uploadManualReferenceSnapshot,
    uploadPdfReferenceSnapshots,
} from '@/lib/storage/reference-snapshots'
import {
    attachSharedContextsFromPdf,
    enrichGeneratedQuestionsMetadata,
    extractVisualReferencesFromDocxImages,
    extractVisualReferencesFromPdfImages,
    extractQuestionsFromPdfMultimodal,
    extractQuestionsFromDocumentTextPrecisely,
    generateQuestionsFromPdfVisionFallback,
    generateQuestionsFromText,
    getPdfPageCount,
    parseDocumentToText,
    reconcileGeneratedQuestionsWithTextAnswerHints,
    verifyExtractedQuestions,
    verifyExtractedQuestionsWithAI,
} from '@/lib/services/ai-service'
import type { VerificationResult } from '@/lib/services/ai-extraction-schemas'
import type { GeneratedQuestion } from '@/lib/services/ai-service.types'
import { mergeAIVerificationIssues, resolveImportVerificationOutcome } from '@/lib/services/import-verifier'
import type { DocumentClassificationResult } from '@/lib/services/document-classifier'
import { classifyDocumentForImport } from '@/lib/services/document-classifier'
import {
    executeDocumentImportPlan,
    mergeVisualReferencesIntoQuestions,
} from '@/lib/services/document-import-executor'
import {
    isClassifierRoutingEnabled,
    type DocumentImportLane,
    type DocumentImportRoutingMode,
    resolveDocumentImportPlan,
} from '@/lib/services/document-import-strategy'
import { annotateQuestionsWithReferencePolicy } from '@/lib/services/reference-classifier'
import {
    mapQuestionReferences,
    QUESTION_REFERENCE_LINK_SELECT,
} from '@/lib/utils/question-references'
import { getPreferredVisualReference as selectPreferredVisualReference } from '@/lib/utils/question-reference-selection'
import {
    sanitizeReferenceText,
    sanitizeReferenceTitle,
    shouldRenderReferencePayload,
} from '@/lib/utils/reference-sanitizer'
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

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024
const MAX_PDF_PAGE_COUNT = 60
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
    deferReferenceEnrichment?: boolean | null
    onProgress?: ((update: DocumentImportProgressUpdate) => Promise<void>) | null
}

type DocumentImportProgressUpdate = {
    stage: 'PROCESSING_CLASSIFICATION' | 'PROCESSING_EXACT' | 'VERIFYING' | 'CREATING_DRAFT'
    message: string
    progressMessage?: string | null
    lane?: DocumentImportLane
    routingMode?: DocumentImportRoutingMode
    selectedStrategy?: DocumentClassificationResult['preferredStrategy']
    resultStrategy?: 'EXTRACTED' | 'AI_GENERATED' | 'AI_VISION_FALLBACK'
    decision?: 'EXACT_ACCEPTED' | 'REVIEW_REQUIRED' | 'PARTIAL' | 'FAILED_WITH_REASON'
    tokenCostUsd?: number | null
}

type DocumentImportDiagnostics = {
    parserStatus: 'OK' | 'FAILED' | 'WEAK_OUTPUT' | 'REPAIRED'
    aiFallbackUsed: boolean
    reportParserIssue: boolean
    warning: string | null
    decision?: 'EXACT_ACCEPTED' | 'REVIEW_REQUIRED' | 'PARTIAL' | 'FAILED_WITH_REASON'
    failureReason?: string | null
    lane?: DocumentImportLane
    classification?: DocumentClassificationResult
    routingMode?: DocumentImportRoutingMode
    selectedStrategy?: DocumentClassificationResult['preferredStrategy']
    reviewRequired?: boolean
    reviewIssueCount?: number
    metadataAiUsed?: boolean
    referenceEnrichmentDeferred?: boolean
    extractedQuestions?: number
    questionsGenerated?: number
    failedCount?: number
    reviewStatus?: string | null
}

type QuestionImportEvidencePayload = {
    sourcePage: number | null
    sourceSnippet: string | null
    sharedContextEvidence: string | null
    answerSource: string | null
    confidence: number | null
    extractionMode: string | null
    referenceKind: string | null
    referenceMode: string | null
    referenceTitle: string | null
    referenceAssetUrl: string | null
}

type PersistedQuestionReferencePayload = {
    kind: QuestionReferenceKind
    mode: QuestionReferenceMode
    title: string | null
    textContent: string | null
    assetUrl: string | null
    sourcePage: number | null
    bbox: Prisma.InputJsonValue | null
    confidence: number | null
    evidence: Prisma.InputJsonValue | null
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
    decision: 'EXACT_ACCEPTED' | 'REVIEW_REQUIRED' | 'PARTIAL' | 'FAILED_WITH_REASON'
    failureReason: string | null
    reviewStatus: string | null
    verification: VerificationResult | null
}

type PdfMultimodalPreferenceInput = {
    isPdfUpload: boolean
    plan: ReturnType<typeof resolveDocumentImportPlan>
    classification: DocumentClassificationResult
}

function shouldPreferChunkedPdfExtraction(input: PdfMultimodalPreferenceInput) {
    if (!input.isPdfUpload) {
        return false
    }

    if (input.classification.hasDiagramReasoning) {
        return true
    }

    return (
        input.plan.selectedStrategy === 'HYBRID_RECONCILE'
        || input.plan.visualReferenceOverlay
        || input.classification.hasVisualReferences
        || input.classification.isScannedLike
    )
}

function shouldAllowOneShotFallbackAfterChunkedExtraction(input: PdfMultimodalPreferenceInput) {
    if (!input.isPdfUpload) {
        return true
    }

    if (input.classification.hasDiagramReasoning) {
        return false
    }

    if (!shouldPreferChunkedPdfExtraction(input)) {
        return true
    }

    return !(
        input.classification.hasVisualReferences
        || input.plan.selectedStrategy === 'MULTIMODAL_EXTRACT'
        || input.plan.visualReferenceOverlay
    )
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
    referenceKind?: string | null
    referenceMode?: string | null
    referenceTitle?: string | null
    referenceAssetUrl?: string | null
}): Prisma.InputJsonValue {
    const payload: QuestionImportEvidencePayload = {
        sourcePage: question.sourcePage ?? null,
        sourceSnippet: question.sourceSnippet ?? null,
        sharedContextEvidence: question.sharedContextEvidence ?? null,
        answerSource: question.answerSource ?? null,
        confidence: question.confidence ?? null,
        extractionMode: question.extractionMode ?? null,
        referenceKind: question.referenceKind ?? null,
        referenceMode: question.referenceMode ?? null,
        referenceTitle: question.referenceTitle ?? null,
        referenceAssetUrl: question.referenceAssetUrl ?? null,
    }

    return payload as Prisma.InputJsonValue
}

function parseQuestionImportEvidence(
    value: Prisma.JsonValue | null | undefined,
): Partial<QuestionImportEvidencePayload> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {}
    }

    const record = value as Record<string, unknown>
    return {
        sourcePage: typeof record.sourcePage === 'number' ? record.sourcePage : null,
        sourceSnippet: typeof record.sourceSnippet === 'string' ? record.sourceSnippet : null,
        sharedContextEvidence: typeof record.sharedContextEvidence === 'string' ? record.sharedContextEvidence : null,
        answerSource: typeof record.answerSource === 'string' ? record.answerSource : null,
        confidence: typeof record.confidence === 'number' ? record.confidence : null,
        extractionMode: typeof record.extractionMode === 'string' ? record.extractionMode : null,
        referenceKind: typeof record.referenceKind === 'string' ? record.referenceKind : null,
        referenceMode: typeof record.referenceMode === 'string' ? record.referenceMode : null,
        referenceTitle: typeof record.referenceTitle === 'string' ? record.referenceTitle : null,
        referenceAssetUrl: typeof record.referenceAssetUrl === 'string' ? record.referenceAssetUrl : null,
    }
}

function buildQuestionReferenceEvidence(question: {
    sourceSnippet?: string | null
    sharedContextEvidence?: string | null
    answerSource?: string | null
    confidence?: number | null
    extractionMode?: string | null
    referenceKind?: string | null
    referenceMode?: string | null
    referenceTitle?: string | null
}): Prisma.InputJsonValue | null {
    const payload = {
        sourceSnippet: question.sourceSnippet ?? null,
        sharedContextEvidence: question.sharedContextEvidence ?? null,
        answerSource: question.answerSource ?? null,
        confidence: question.confidence ?? null,
        extractionMode: question.extractionMode ?? null,
        referenceKind: question.referenceKind ?? null,
        referenceMode: question.referenceMode ?? null,
        referenceTitle: question.referenceTitle ?? null,
    }

    if (!Object.values(payload).some((value) => value !== null)) {
        return null
    }

    return payload as Prisma.InputJsonValue
}

function buildPersistedQuestionReferencePayload(question: {
    sharedContext?: string | null
    sourcePage?: number | null
    confidence?: number | null
    referenceKind?: string | null
    referenceMode?: string | null
    referenceTitle?: string | null
    referenceAssetUrl?: string | null
    referenceBBox?: unknown | null
    sourceSnippet?: string | null
    sharedContextEvidence?: string | null
    answerSource?: string | null
    extractionMode?: string | null
}): PersistedQuestionReferencePayload | null {
    const kind = (question.referenceKind ?? 'NONE') as QuestionReferenceKind
    const mode = (question.referenceMode ?? 'TEXT') as QuestionReferenceMode
    const textContent = sanitizeReferenceText(question.sharedContext)
    const title = sanitizeReferenceTitle(question.referenceTitle)
    const evidence = buildQuestionReferenceEvidence(question)

    if (!shouldRenderReferencePayload({
        mode,
        title,
        textContent,
        assetUrl: question.referenceAssetUrl ?? null,
    })) {
        return null
    }

    return {
        kind,
        mode,
        title,
        textContent,
        assetUrl: question.referenceAssetUrl ?? null,
        sourcePage: question.sourcePage ?? null,
        bbox: (question.referenceBBox ?? null) as Prisma.InputJsonValue | null,
        confidence: question.confidence ?? null,
        evidence,
    }
}

async function persistImportedQuestionReferences(input: {
    testId: string
    questions: Array<{
        order: number
        sharedContext?: string | null
        sourcePage?: number | null
        confidence?: number | null
        referenceKind?: string | null
        referenceMode?: string | null
        referenceTitle?: string | null
        referenceAssetUrl?: string | null
        referenceBBox?: unknown | null
        sourceSnippet?: string | null
        sharedContextEvidence?: string | null
        answerSource?: string | null
        extractionMode?: string | null
    }>
    persistedQuestions: Array<{ id: string; order: number }>
    tx?: Prisma.TransactionClient
}) {
    const questionIdByOrder = new Map(input.persistedQuestions.map((question) => [question.order, question.id]))
    const groupedReferences = new Map<string, PersistedQuestionReferencePayload & { questionIds: string[] }>()

    for (const question of input.questions) {
        const questionId = questionIdByOrder.get(question.order)
        if (!questionId) {
            continue
        }

        const payload = buildPersistedQuestionReferencePayload(question)
        if (!payload) {
            continue
        }

        const referenceKey = JSON.stringify({
            kind: payload.kind,
            mode: payload.mode,
            title: payload.title,
            textContent: payload.textContent,
            sourcePage: payload.sourcePage,
        })
        const existing = groupedReferences.get(referenceKey)
        if (existing) {
            existing.questionIds.push(questionId)
            continue
        }

        groupedReferences.set(referenceKey, {
            ...payload,
            questionIds: [questionId],
        })
    }

    if (groupedReferences.size === 0) {
        return
    }

    const persistWithClient = async (tx: Prisma.TransactionClient) => {
        for (const reference of groupedReferences.values()) {
            const createdReference = await tx.questionReference.create({
                data: {
                    testId: input.testId,
                    kind: reference.kind,
                    mode: reference.mode,
                    title: reference.title,
                    textContent: reference.textContent,
                    assetUrl: reference.assetUrl,
                    sourcePage: reference.sourcePage,
                    bbox: reference.bbox ?? Prisma.JsonNull,
                    confidence: reference.confidence,
                    evidence: reference.evidence ?? Prisma.JsonNull,
                },
                select: { id: true },
            })

            await tx.questionReferenceLink.createMany({
                data: reference.questionIds.map((questionId, index) => ({
                    referenceId: createdReference.id,
                    questionId,
                    order: index + 1,
                })),
            })
        }
    }

    if (input.tx) {
        await persistWithClient(input.tx)
        return
    }

    await prisma.$transaction(async (tx) => {
        await persistWithClient(tx)
    })
}

const ADMIN_QUESTION_WITH_REFERENCES_SELECT = Prisma.validator<Prisma.QuestionSelect>()({
    id: true,
    testId: true,
    order: true,
    stem: true,
    sharedContext: true,
    importEvidence: true,
    options: true,
    explanation: true,
    difficulty: true,
    topic: true,
    referenceLinks: {
        orderBy: { order: 'asc' },
        select: QUESTION_REFERENCE_LINK_SELECT,
    },
})

type AdminQuestionWithReferencesRecord = Prisma.QuestionGetPayload<{
    select: typeof ADMIN_QUESTION_WITH_REFERENCES_SELECT
}>

function mapAdminQuestionRecord(question: AdminQuestionWithReferencesRecord) {
    return {
        id: question.id,
        order: question.order,
        stem: question.stem,
        sharedContext: sanitizeReferenceText(question.sharedContext) ?? '',
        options: question.options,
        explanation: question.explanation,
        difficulty: question.difficulty,
        topic: question.topic,
        references: mapQuestionReferences(question.referenceLinks),
    }
}

function getPreferredVisualReference(
    references: ReturnType<typeof mapQuestionReferences>,
    importEvidence: Partial<QuestionImportEvidencePayload>,
) {
    const linkedVisualReference = selectPreferredVisualReference(references)

    if (linkedVisualReference) {
        return linkedVisualReference
    }

    if (
        importEvidence.referenceMode
        || importEvidence.referenceKind
        || importEvidence.referenceTitle
        || importEvidence.referenceAssetUrl
    ) {
        return {
            id: null,
            order: 0,
            kind: (importEvidence.referenceKind ?? 'DIAGRAM') as QuestionReferenceKind,
            mode: (importEvidence.referenceMode ?? 'SNAPSHOT') as QuestionReferenceMode,
            title: importEvidence.referenceTitle ?? null,
            textContent: null,
            assetUrl: importEvidence.referenceAssetUrl ?? null,
            sourcePage: importEvidence.sourcePage ?? null,
            bbox: null,
            confidence: importEvidence.confidence ?? null,
            evidence: null,
        }
    }

    return null
}

function mergeReferenceEvidence(
    existing: Prisma.JsonValue | null | undefined,
    next: Record<string, unknown>,
) {
    const base = existing && typeof existing === 'object' && !Array.isArray(existing)
        ? existing as Record<string, unknown>
        : {}

    return ({
        ...base,
        ...next,
    }) as Prisma.InputJsonValue
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

export async function enrichImportedTestReferencesAfterDraft(input: {
    adminId: string
    testId: string
    file: File
    fileName: string
}) {
    const admin = await ensureActiveAdmin(input.adminId)
    if ('error' in admin) {
        return admin
    }

    const existingTest = await prisma.test.findUnique({
        where: { id: input.testId },
        select: {
            id: true,
            createdById: true,
            questions: {
                orderBy: { order: 'asc' },
                select: {
                    id: true,
                    order: true,
                    stem: true,
                    sharedContext: true,
                    importEvidence: true,
                    options: true,
                    explanation: true,
                    difficulty: true,
                    topic: true,
                },
            },
        },
    })

    if (!existingTest) {
        return serviceError('NOT_FOUND', 'Generated draft not found for reference enrichment.')
    }

    if (existingTest.createdById !== admin.id && admin.role !== Role.ADMIN) {
        return serviceError('FORBIDDEN', 'You can only enrich references for your own generated drafts.')
    }

    const baseQuestions: GeneratedQuestion[] = existingTest.questions.map((question) => {
        const evidence = parseQuestionImportEvidence(question.importEvidence)
        return {
            stem: question.stem,
            sharedContext: sanitizeReferenceText(question.sharedContext) ?? null,
            options: Array.isArray(question.options)
                ? question.options as GeneratedQuestion['options']
                : [],
            explanation: question.explanation ?? '',
            difficulty: question.difficulty,
            topic: question.topic ?? '',
            sourcePage: evidence.sourcePage ?? null,
            sourceSnippet: evidence.sourceSnippet ?? null,
            answerSource: (evidence.answerSource ?? null) as GeneratedQuestion['answerSource'],
            confidence: evidence.confidence ?? null,
            sharedContextEvidence: evidence.sharedContextEvidence ?? null,
            extractionMode: (evidence.extractionMode ?? null) as GeneratedQuestion['extractionMode'],
            referenceKind: (evidence.referenceKind ?? null) as GeneratedQuestion['referenceKind'],
            referenceMode: (evidence.referenceMode ?? null) as GeneratedQuestion['referenceMode'],
            referenceTitle: (evidence.referenceTitle ?? null) as GeneratedQuestion['referenceTitle'],
            referenceAssetUrl: evidence.referenceAssetUrl ?? null,
        }
    })

    const buffer = Buffer.from(await input.file.arrayBuffer())
    let enrichedQuestions = baseQuestions

    try {
        enrichedQuestions = annotateQuestionsWithReferencePolicy(
            await attachSharedContextsFromPdf(buffer, enrichedQuestions),
        )
    } catch (error) {
        console.warn('[AI-DOC][ADMIN] Deferred shared-context enrichment failed:', error)
    }

    try {
        const visualReferences = await extractVisualReferencesFromPdfImages(
            buffer,
            admin.id,
            input.fileName,
        )
        if (!visualReferences.error && visualReferences.references && visualReferences.references.length > 0) {
            enrichedQuestions = annotateQuestionsWithReferencePolicy(
                mergeVisualReferencesIntoQuestions(enrichedQuestions, visualReferences.references),
            )
        }
    } catch (error) {
        console.warn('[AI-DOC][ADMIN] Deferred visual-reference enrichment failed:', error)
    }

    try {
        const uploadedSnapshots = await uploadPdfReferenceSnapshots({
            buffer,
            fileName: input.fileName,
            testId: existingTest.id,
            questions: enrichedQuestions,
        })
        if (uploadedSnapshots.size > 0) {
            enrichedQuestions = enrichedQuestions.map((question) => {
                const snapshotAsset = Number.isInteger(question.sourcePage)
                    ? uploadedSnapshots.get(Number(question.sourcePage))
                    : undefined

                if (!snapshotAsset) {
                    return question
                }

                return {
                    ...question,
                    referenceAssetUrl: snapshotAsset.assetUrl,
                    referenceBBox: snapshotAsset.bbox,
                }
            })
        }
    } catch (error) {
        console.warn('[AI-DOC][ADMIN] Deferred snapshot upload failed:', error)
    }

    await prisma.$transaction(async (tx) => {
        for (const question of existingTest.questions) {
            const enriched = enrichedQuestions[question.order - 1]
            if (!enriched) {
                continue
            }

            await tx.question.update({
                where: { id: question.id },
                data: {
                    sharedContext: sanitizeReferenceText(enriched.sharedContext) ?? null,
                    importEvidence: buildQuestionImportEvidence(enriched),
                },
            })
        }

        await tx.questionReference.deleteMany({
            where: { testId: existingTest.id },
        })

        await persistImportedQuestionReferences({
            testId: existingTest.id,
            questions: enrichedQuestions.map((question, index) => ({
                ...question,
                order: index + 1,
            })),
            persistedQuestions: existingTest.questions.map((question) => ({
                id: question.id,
                order: question.order,
            })),
            tx,
        })
    })

    return {
        testId: existingTest.id,
        updatedQuestionCount: enrichedQuestions.length,
        enrichedReferenceCount: enrichedQuestions.filter((question) =>
            Boolean(question.sharedContext || question.referenceKind && question.referenceKind !== 'NONE'),
        ).length,
    }
}

function shouldRunInlineAiPostProcessing(input: {
    isPdfUpload: boolean
    questionCount: number
    strategy: 'EXTRACTED' | 'AI_GENERATED' | 'AI_VISION_FALLBACK'
    routingMode?: DocumentImportRoutingMode
}) {
    return input.routingMode !== 'LEGACY'
}

function appendDiagnosticWarning(
    currentWarning: string | null | undefined,
    nextWarning: string | null | undefined,
) {
    if (!nextWarning) {
        return currentWarning ?? null
    }

    if (!currentWarning) {
        return nextWarning
    }

    if (currentWarning.includes(nextWarning)) {
        return currentWarning
    }

    return `${currentWarning} ${nextWarning}`.trim()
}

function countStructuralVerificationErrors(verification: VerificationResult | null | undefined) {
    if (!verification) {
        return 0
    }

    return verification.issues.filter((issue) => (
        issue.category === 'STRUCTURAL' && issue.severity === 'ERROR'
    )).length
}

function shouldAcceptPartialImportRecovery(input: {
    verification: VerificationResult | null | undefined
    expectedCount: number | null | undefined
}) {
    const verification = input.verification
    if (!verification) {
        return false
    }

    const baselineCount = input.expectedCount && input.expectedCount > 0
        ? input.expectedCount
        : verification.totalQuestions
    const validQuestionThreshold = Math.max(5, Math.floor(baselineCount * 0.4))
    const structuralErrorThreshold = Math.max(2, Math.floor(baselineCount * 0.1))

    return (
        verification.validQuestions >= validQuestionThreshold
        && countStructuralVerificationErrors(verification) <= structuralErrorThreshold
    )
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
    if (status === 'DRAFT' || status === 'PUBLISHED') {
        return null
    }

    return serviceError(
        'NOT_EDITABLE',
        'Archived tests are read-only',
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
            isEditable: test.status !== 'ARCHIVED',
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
                    ? 'Cannot modify other fields while archiving — archive first, then edit'
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
        select: ADMIN_QUESTION_WITH_REFERENCES_SELECT,
    })

    return {
        questions: questions.map(mapAdminQuestionRecord),
    }
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
            sharedContext: sanitizeReferenceText(data.sharedContext) ?? null,
            options: data.options as unknown as Prisma.InputJsonValue,
            explanation: data.explanation,
            difficulty: (data.difficulty ?? 'MEDIUM') as Difficulty,
            topic: data.topic,
        },
        select: ADMIN_QUESTION_WITH_REFERENCES_SELECT,
    })

    return {
        question: mapAdminQuestionRecord(question),
    }
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
        updateData.sharedContext = sanitizeReferenceText(data.sharedContext) ?? null
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
        select: ADMIN_QUESTION_WITH_REFERENCES_SELECT,
    })

    return {
        question: mapAdminQuestionRecord(question),
    }
}

export async function upsertAdminQuestionReferenceImage(
    adminId: string,
    testId: string,
    questionId: string,
    file: File,
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

    const existingQuestion = await prisma.question.findUnique({
        where: { id: questionId },
        select: ADMIN_QUESTION_WITH_REFERENCES_SELECT,
    })

    if (!existingQuestion || existingQuestion.testId !== testId) {
        return serviceError('NOT_FOUND', 'Question not found in this test')
    }

    let uploadedSnapshot: Awaited<ReturnType<typeof uploadManualReferenceSnapshot>>
    try {
        uploadedSnapshot = await uploadManualReferenceSnapshot({
            testId,
            questionId,
            file,
        })
    } catch (error) {
        return serviceError(
            'BAD_REQUEST',
            error instanceof Error ? error.message : 'Could not upload the reference image.',
        )
    }

    const mappedReferences = mapQuestionReferences(existingQuestion.referenceLinks)
    const importEvidence = parseQuestionImportEvidence(existingQuestion.importEvidence)
    const existingVisualReference = getPreferredVisualReference(mappedReferences, importEvidence)

    const nextKind = existingVisualReference?.kind && existingVisualReference.kind !== 'NONE'
        ? existingVisualReference.kind
        : (importEvidence.referenceKind && importEvidence.referenceKind !== 'NONE'
            ? importEvidence.referenceKind as QuestionReferenceKind
            : 'DIAGRAM')

    const nextMode = (() => {
        const existingMode = existingVisualReference?.mode ?? (importEvidence.referenceMode as QuestionReferenceMode | null) ?? null
        if (existingMode === 'HYBRID' || existingMode === 'SNAPSHOT') {
            return existingMode
        }

        return existingQuestion.sharedContext?.trim() ? 'HYBRID' : 'SNAPSHOT'
    })()

        const nextTitle = sanitizeReferenceTitle(existingVisualReference?.title)
        ?? sanitizeReferenceTitle(importEvidence.referenceTitle)
        ?? null

    const nextEvidence = buildQuestionImportEvidence({
        ...importEvidence,
        referenceKind: nextKind,
        referenceMode: nextMode,
        referenceTitle: nextTitle,
        referenceAssetUrl: uploadedSnapshot.assetUrl,
    })

    await prisma.$transaction(async (tx) => {
        if (existingVisualReference?.id) {
            const linkCount = await tx.questionReferenceLink.count({
                where: { referenceId: existingVisualReference.id },
            })

            if (linkCount > 1) {
                await tx.questionReferenceLink.deleteMany({
                    where: { questionId, referenceId: existingVisualReference.id },
                })

                const forkedReference = await tx.questionReference.create({
                    data: {
                        testId,
                        kind: nextKind,
                        mode: nextMode,
                        title: nextTitle,
                        textContent:
                            sanitizeReferenceText(existingVisualReference.textContent)
                            ?? sanitizeReferenceText(existingQuestion.sharedContext)
                            ?? null,
                        assetUrl: uploadedSnapshot.assetUrl,
                        sourcePage: existingVisualReference.sourcePage,
                        bbox: uploadedSnapshot.bbox ?? Prisma.JsonNull,
                        confidence: existingVisualReference.confidence,
                        evidence: {
                            source: 'MANUAL_UPLOAD',
                            forkedFrom: existingVisualReference.id,
                            uploadedAt: new Date().toISOString(),
                        } satisfies Prisma.InputJsonValue,
                    },
                    select: { id: true },
                })

                await tx.questionReferenceLink.create({
                    data: {
                        questionId,
                        referenceId: forkedReference.id,
                        order: 1,
                    },
                })
            } else {
                await tx.questionReference.update({
                    where: { id: existingVisualReference.id },
                    data: {
                        kind: nextKind,
                        mode: nextMode,
                        title: nextTitle,
                        textContent:
                            sanitizeReferenceText(existingVisualReference.textContent)
                            ?? sanitizeReferenceText(existingQuestion.sharedContext)
                            ?? null,
                        assetUrl: uploadedSnapshot.assetUrl,
                        bbox: uploadedSnapshot.bbox ?? Prisma.JsonNull,
                        evidence: mergeReferenceEvidence(existingVisualReference.evidence as Prisma.JsonValue | null, {
                            source: 'MANUAL_UPLOAD',
                            uploadedAt: new Date().toISOString(),
                        }),
                    },
                })
            }
        } else {
            const createdReference = await tx.questionReference.create({
                data: {
                    testId,
                    kind: nextKind,
                    mode: nextMode,
                    title: nextTitle,
                    textContent: sanitizeReferenceText(existingQuestion.sharedContext) ?? null,
                    assetUrl: uploadedSnapshot.assetUrl,
                    sourcePage: importEvidence.sourcePage ?? null,
                    bbox: uploadedSnapshot.bbox ?? Prisma.JsonNull,
                    confidence: importEvidence.confidence ?? null,
                    evidence: {
                        source: 'MANUAL_UPLOAD',
                        uploadedAt: new Date().toISOString(),
                    } satisfies Prisma.InputJsonValue,
                },
                select: { id: true },
            })

            await tx.questionReferenceLink.create({
                data: {
                    questionId,
                    referenceId: createdReference.id,
                    order: mappedReferences.length + 1,
                },
            })
        }

        await tx.question.update({
            where: { id: questionId },
            data: {
                importEvidence: nextEvidence,
            },
        })
    })

    const refreshedQuestion = await prisma.question.findUnique({
        where: { id: questionId },
        select: ADMIN_QUESTION_WITH_REFERENCES_SELECT,
    })

    if (!refreshedQuestion) {
        return serviceError('NOT_FOUND', 'Question not found after updating reference image.')
    }

    return {
        question: mapAdminQuestionRecord(refreshedQuestion),
    }
}

export async function removeAdminQuestionReferenceImage(
    adminId: string,
    testId: string,
    questionId: string,
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

    const existingQuestion = await prisma.question.findUnique({
        where: { id: questionId },
        select: ADMIN_QUESTION_WITH_REFERENCES_SELECT,
    })

    if (!existingQuestion || existingQuestion.testId !== testId) {
        return serviceError('NOT_FOUND', 'Question not found in this test')
    }

    const mappedReferences = mapQuestionReferences(existingQuestion.referenceLinks)
    const importEvidence = parseQuestionImportEvidence(existingQuestion.importEvidence)
    const existingVisualReference = getPreferredVisualReference(mappedReferences, importEvidence)

    if (!existingVisualReference?.id) {
        return {
            question: mapAdminQuestionRecord(existingQuestion),
        }
    }

    const fallbackTextContent =
        sanitizeReferenceText(existingVisualReference.textContent)
        ?? sanitizeReferenceText(existingQuestion.sharedContext)
        ?? null

    const nextMode: QuestionReferenceMode = fallbackTextContent ? 'TEXT' : 'SNAPSHOT'

    const nextEvidence = buildQuestionImportEvidence({
        ...importEvidence,
        referenceAssetUrl: null,
        referenceMode: fallbackTextContent ? nextMode : null,
        referenceTitle: fallbackTextContent ? sanitizeReferenceTitle(existingVisualReference.title) : null,
    })

    await prisma.$transaction(async (tx) => {
        const linkCount = await tx.questionReferenceLink.count({
            where: { referenceId: existingVisualReference.id },
        })
        const isShared = linkCount > 1

        if (isShared) {
            await tx.questionReferenceLink.deleteMany({
                where: { questionId, referenceId: existingVisualReference.id },
            })

            if (fallbackTextContent) {
                const textOnlyReference = await tx.questionReference.create({
                    data: {
                        testId,
                        kind: existingVisualReference.kind,
                        mode: nextMode,
                        title: sanitizeReferenceTitle(existingVisualReference.title),
                        textContent: fallbackTextContent,
                        assetUrl: null,
                        sourcePage: existingVisualReference.sourcePage,
                        confidence: existingVisualReference.confidence,
                        evidence: {
                            source: 'MANUAL_REMOVE',
                            forkedFrom: existingVisualReference.id,
                            removedAt: new Date().toISOString(),
                        } satisfies Prisma.InputJsonValue,
                    },
                    select: { id: true },
                })

                await tx.questionReferenceLink.create({
                    data: {
                        questionId,
                        referenceId: textOnlyReference.id,
                        order: 1,
                    },
                })
            }
        } else if (fallbackTextContent) {
            await tx.questionReference.update({
                where: { id: existingVisualReference.id },
                data: {
                    mode: nextMode,
                    assetUrl: null,
                    bbox: Prisma.JsonNull,
                    textContent: fallbackTextContent,
                },
            })
        } else {
            await tx.questionReferenceLink.deleteMany({
                where: { questionId, referenceId: existingVisualReference.id },
            })
            await tx.questionReference.delete({
                where: { id: existingVisualReference.id },
            })
        }

        await tx.question.update({
            where: { id: questionId },
            data: {
                importEvidence: nextEvidence,
            },
        })
    })

    const refreshedQuestion = await prisma.question.findUnique({
        where: { id: questionId },
        select: ADMIN_QUESTION_WITH_REFERENCES_SELECT,
    })

    if (!refreshedQuestion) {
        return serviceError('NOT_FOUND', 'Question not found in this test')
    }

    return {
        question: mapAdminQuestionRecord(refreshedQuestion),
    }
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
    const isPdfUpload = uploadValidation.sanitizedFileName.toLowerCase().endsWith('.pdf')
    if (isPdfUpload) {
        try {
            const pageCount = await getPdfPageCount(buffer)
            if (pageCount > MAX_PDF_PAGE_COUNT) {
                return serviceError(
                    'BAD_REQUEST',
                    `PDF too large. Max ${MAX_PDF_PAGE_COUNT} pages.`,
                )
            }
        } catch (error) {
            console.warn('[AI-DOC][ADMIN] Failed to determine PDF page count before import:', error)
        }
    }

    const reportProgress = async (update: DocumentImportProgressUpdate) => {
        await input.onProgress?.(update)
    }
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

    const shouldDeferReferenceEnrichment = Boolean(input.deferReferenceEnrichment && isPdfUpload)
    const importPlan = resolveDocumentImportPlan({
        classifierRoutingEnabled: isClassifierRoutingEnabled(),
        classification: importDiagnostics.classification,
        isPdfUpload,
    })
    importDiagnostics.lane = importPlan.lane
    const preferChunkedPdfExtraction = shouldPreferChunkedPdfExtraction({
        isPdfUpload,
        plan: importPlan,
        classification: importDiagnostics.classification,
    })
    const allowOneShotFallbackAfterChunked = shouldAllowOneShotFallbackAfterChunkedExtraction({
        isPdfUpload,
        plan: importPlan,
        classification: importDiagnostics.classification,
    })
    // Skip the full AI repair loop when:
    //   a) We will run reference enrichment as a second phase (HYBRID_RECONCILE
    //      deferred case) and the document is not diagram-heavy, OR
    //   b) The plan requires manual visual-reference capture. Diagram PDFs
    //      (Figure Completion, Venn, etc.) are normalized to TEXT_EXACT +
    //      STABLE lane so the admin can attach visuals by hand — running
    //      batch-after-batch repair against those questions burns the entire
    //      job budget (10+ batches × sequential OpenAI calls) and blows past
    //      both our 210s import timeout and Vercel's 300s serverless cap,
    //      leaving the user with a hung "Building your draft…" screen.
    const shouldKeepExactPassCheap =
        (
            shouldDeferReferenceEnrichment
            && importPlan.selectedStrategy === 'HYBRID_RECONCILE'
            && !importDiagnostics.classification.hasDiagramReasoning
        )
        || importPlan.manualVisualReferenceCapture === true
    const effectiveGenerationTarget =
        importDiagnostics.classification.documentType === 'MCQ_PAPER'
        && importDiagnostics.classification.detectedQuestionCount
            ? importDiagnostics.classification.detectedQuestionCount
            : uploadValidation.generationTarget
    importDiagnostics.routingMode = importPlan.routingMode
    importDiagnostics.selectedStrategy = importPlan.selectedStrategy

    await reportProgress({
        stage: 'PROCESSING_CLASSIFICATION',
        message: 'Import classified. Choosing the safest extraction lane.',
        progressMessage: `Lane ${importPlan.lane.toLowerCase()} selected via ${importPlan.routingMode.toLowerCase()} routing.`,
        lane: importPlan.lane,
        routingMode: importPlan.routingMode,
        selectedStrategy: importPlan.selectedStrategy,
    })

    let needsAdminReview = false
    let reviewIssueCount = 0

    let strategy: 'EXTRACTED' | 'AI_GENERATED' | 'AI_VISION_FALLBACK'
    let result: DocumentGenerationResult
    await reportProgress({
        stage: 'PROCESSING_EXACT',
        message: 'Running document extraction and reconciliation.',
        progressMessage: `Executing ${importPlan.selectedStrategy.toLowerCase()} in the ${importPlan.lane.toLowerCase()} lane.`,
        lane: importPlan.lane,
        routingMode: importPlan.routingMode,
        selectedStrategy: importPlan.selectedStrategy,
    })
    const dispatched = await executeDocumentImportPlan(
        {
            plan: importPlan,
            isPdfUpload,
            textLength: text.length,
            parseFailed: Boolean(parseError),
            generationTarget: effectiveGenerationTarget,
            deferReferenceEnrichment: shouldDeferReferenceEnrichment,
        },
        {
            extractTextExact: async () => {
                if (text.length < 50) {
                    return extracted
                }

                const exact = await extractQuestionsFromDocumentTextPrecisely(
                    text,
                    admin.id,
                    shouldKeepExactPassCheap
                        ? {
                            allowAiFallback: false,
                            allowAiRepair: false,
                        }
                        : undefined,
                )
                extracted = exact
                return exact
            },
            extractMultimodal: (target) => extractQuestionsFromPdfMultimodal(
                buffer,
                target,
                admin.id,
                uploadValidation.sanitizedFileName,
                {
                    preferChunkedVisualExtraction: preferChunkedPdfExtraction,
                    allowOneShotFallbackAfterChunked,
                },
            ),
            extractVisualReferences: () => (
                isPdfUpload
                    ? extractVisualReferencesFromPdfImages(
                        buffer,
                        admin.id,
                        uploadValidation.sanitizedFileName,
                    )
                    : extractVisualReferencesFromDocxImages(
                        buffer,
                        admin.id,
                        uploadValidation.sanitizedFileName,
                    )
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
                {
                    preferChunkedVisualExtraction: preferChunkedPdfExtraction,
                    allowOneShotFallbackAfterChunked,
                },
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
        // Diagram-heavy PDFs routed through manualVisualReferenceCapture can
        // legitimately hit this branch when no clean text Qs survive the
        // parser and the multimodal fallback cannot recover them either.
        // Surface a targeted, actionable message so the admin knows they
        // need to either re-upload a cleaner scan or create the test
        // manually — rather than the generic "Failed to generate questions"
        // they'd see from a catastrophic failure.
        if (importPlan.manualVisualReferenceCapture) {
            return serviceError(
                'GENERATION_FAILED',
                result.message
                    || 'This diagram-heavy PDF did not yield any text-extractable questions. The visuals in this file cannot be parsed automatically — please create the test manually from the uploaded source, or re-upload a version with a cleaner text layer.',
            )
        }
        return serviceError(
            'GENERATION_FAILED',
            result.message || 'Failed to generate questions.',
        )
    }

    importDiagnostics.warning = appendDiagnosticWarning(importDiagnostics.warning, result.message)

    if (isPdfUpload && text.length >= 50 && strategy !== 'AI_GENERATED') {
        const reconciledAnswers = reconcileGeneratedQuestionsWithTextAnswerHints(result.questions, text)
        if (reconciledAnswers.repairedCount > 0) {
            result.questions = annotateQuestionsWithReferencePolicy(reconciledAnswers.questions)
            importDiagnostics.warning = appendDiagnosticWarning(
                importDiagnostics.warning,
                `Reconciled ${reconciledAnswers.repairedCount} question answer(s) from the PDF text layer.`,
            )
        } else {
            result.questions = annotateQuestionsWithReferencePolicy(reconciledAnswers.questions)
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

    const partialRecoveryExpectedCount = strategy === 'AI_GENERATED'
        ? effectiveGenerationTarget
        : extracted.expectedQuestionCount ?? verification?.totalQuestions ?? result.questions.length
    if (
        importDecision.decision === 'FAILED_WITH_REASON'
        && shouldAcceptPartialImportRecovery({
            verification,
            expectedCount: partialRecoveryExpectedCount,
        })
    ) {
        const validQuestions = verification?.validQuestions ?? result.questions.length
        importDecision = {
            decision: 'PARTIAL',
            message: `Recovered ${validQuestions} usable question(s) from an expected ${partialRecoveryExpectedCount}. The draft has been kept for admin review instead of failing the entire import.`,
            errorCount: countStructuralVerificationErrors(verification),
            warningCount: verification?.issueSummary?.warnings ?? 0,
        }
        importDiagnostics.warning = appendDiagnosticWarning(
            importDiagnostics.warning,
            result.message,
        )
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

    if (importDecision.decision === 'REVIEW_REQUIRED' || importDecision.decision === 'PARTIAL') {
        needsAdminReview = true
        reviewIssueCount = verification?.issues.length ?? Math.max(reviewIssueCount, 1)
        importDiagnostics.reviewRequired = true
        importDiagnostics.reviewIssueCount = reviewIssueCount
        importDiagnostics.reportParserIssue = true
        importDiagnostics.warning = appendDiagnosticWarning(
            importDiagnostics.warning,
            importDecision.message
                ? `${importDecision.message} The draft has been flagged for admin review before publishing.`
                : `Verification found ${reviewIssueCount} issue(s), so the draft has been flagged for admin review before publishing.`,
        )
    }
    importDiagnostics.decision = importDecision.decision
    importDiagnostics.failureReason = importDecision.message
    importDiagnostics.referenceEnrichmentDeferred = shouldDeferReferenceEnrichment
    importDiagnostics.extractedQuestions = extracted.questions.length
    importDiagnostics.failedCount = result.failedCount || 0

    await reportProgress({
        stage: 'VERIFYING',
        message: 'Verification complete. Preparing the draft result.',
        progressMessage: importDecision.message
            ? `${importDecision.message} Finalizing the draft payload.`
            : 'Verification completed. Finalizing the draft payload.',
        lane: importPlan.lane,
        routingMode: importPlan.routingMode,
        selectedStrategy: importPlan.selectedStrategy,
        resultStrategy: strategy,
        decision: importDecision.decision,
        tokenCostUsd: result.cost?.costUSD ?? null,
    })

    const baseTitle = uploadValidation.sanitizedFileName.replace(/\.(docx|pdf)$/i, '')
    let questionsWithSharedContext = result.questions
    if (isPdfUpload && !shouldDeferReferenceEnrichment) {
        try {
            questionsWithSharedContext = annotateQuestionsWithReferencePolicy(
                await attachSharedContextsFromPdf(buffer, result.questions),
            )
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
    const allAnnotatedQuestions = annotateQuestionsWithReferencePolicy(metadataEnrichment.questions)
    const finalQuestions = allAnnotatedQuestions.filter((question) => {
        const correctCount = question.options.filter((option) => option.isCorrect).length
        return correctCount === 1
    })
    if (finalQuestions.length < allAnnotatedQuestions.length) {
        const dropped = allAnnotatedQuestions.length - finalQuestions.length
        importDiagnostics.warning = appendDiagnosticWarning(
            importDiagnostics.warning,
            `Dropped ${dropped} question(s) with missing or ambiguous correct answers.`,
        )
    }
    if (finalQuestions.length === 0) {
        return serviceError(
            strategy === 'AI_GENERATED' ? 'GENERATION_FAILED' : 'PARSE_ERROR',
            'No questions survived answer-key validation. Every extracted question was missing a correct answer.',
        )
    }
    const finalDescription = metadataEnrichment.description
    const testTitle = input.title?.trim()
        || metadataEnrichment.suggestedTitle
        || `AI Generated Test - ${baseTitle || new Date().toLocaleDateString()}`
    const testDuration = 60
    importDiagnostics.metadataAiUsed = metadataEnrichment.aiUsed
    importDiagnostics.questionsGenerated = finalQuestions.length
    importDiagnostics.reviewStatus = needsAdminReview ? 'NEEDS_REVIEW' : null

    if (metadataEnrichment.warning) {
        importDiagnostics.warning = importDiagnostics.warning
            ? `${importDiagnostics.warning} ${metadataEnrichment.warning}`
            : metadataEnrichment.warning
    }

    await reportProgress({
        stage: 'CREATING_DRAFT',
        message: 'Creating the draft test in the database.',
        progressMessage: shouldDeferReferenceEnrichment
            ? 'Draft creation is running now. Reference enrichment will continue in the background.'
            : 'Draft creation is running now.',
        lane: importPlan.lane,
        routingMode: importPlan.routingMode,
        selectedStrategy: importPlan.selectedStrategy,
        resultStrategy: strategy,
        decision: importDecision.decision,
        tokenCostUsd: (result.cost?.costUSD || 0) + (metadataEnrichment.cost?.costUSD || 0),
    })

    const createdTest = await prisma.test.create({
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
                    sharedContext: sanitizeReferenceText(question.sharedContext) ?? null,
                    importEvidence: buildQuestionImportEvidence(question),
                })),
            },
        },
        select: {
            id: true,
            title: true,
            reviewStatus: true,
            questions: {
                select: {
                    id: true,
                    order: true,
                },
            },
        },
    })

    let finalQuestionsWithAssets = finalQuestions
    if (isPdfUpload && !shouldDeferReferenceEnrichment) {
        try {
            const uploadedSnapshots = await uploadPdfReferenceSnapshots({
                buffer,
                fileName: uploadValidation.sanitizedFileName,
                testId: createdTest.id,
                questions: finalQuestions,
            })
            if (uploadedSnapshots.size > 0) {
                finalQuestionsWithAssets = finalQuestions.map((question) => {
                    const snapshotAsset = Number.isInteger(question.sourcePage)
                        ? uploadedSnapshots.get(Number(question.sourcePage))
                        : undefined

                    if (!snapshotAsset) {
                        return question
                    }

                    return {
                        ...question,
                        referenceAssetUrl: snapshotAsset.assetUrl,
                        referenceBBox: snapshotAsset.bbox,
                    }
                })
            }
        } catch (error) {
            console.warn('[AI-DOC][ADMIN] Failed to upload inline reference snapshots:', error)
        }
    }

    try {
        await persistImportedQuestionReferences({
            testId: createdTest.id,
            questions: finalQuestionsWithAssets.map((question, index) => ({
                ...question,
                order: index + 1,
            })),
            persistedQuestions: createdTest.questions,
        })
    } catch (error) {
        console.warn('[AI-DOC][ADMIN] Failed to persist normalized question references:', error)
    }

    const test = {
        id: createdTest.id,
        title: createdTest.title,
        reviewStatus: createdTest.reviewStatus,
    }

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
