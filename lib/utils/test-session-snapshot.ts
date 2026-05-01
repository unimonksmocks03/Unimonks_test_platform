import type { Prisma } from '@prisma/client'

import {
    mapQuestionReferences,
    type QuestionReferenceView,
} from '@/lib/utils/question-references'
import {
    sanitizePersistedReferenceText,
    sanitizePersistedSharedContext,
    sanitizeReferenceTitle,
    shouldRenderReferencePayload,
} from '@/lib/utils/reference-sanitizer'

export type SessionQuestionSnapshot = {
    id: string
    order: number
    stem: string
    sharedContext: string | null
    options: Prisma.JsonValue
    difficulty: string
    topic: string | null
    explanation: string | null
    references: QuestionReferenceView[]
}

export type SessionTestSnapshot = {
    title: string
    description: string | null
    durationMinutes: number
    settings: Prisma.JsonValue | null
    questions: SessionQuestionSnapshot[]
}

type SnapshotQuestionSource = {
    id: string
    order: number
    stem: string
    sharedContext: string | null
    options: Prisma.JsonValue
    difficulty: string
    topic: string | null
    explanation?: string | null
    referenceLinks?: Parameters<typeof mapQuestionReferences>[0]
    references?: QuestionReferenceView[]
}

type SnapshotTestSource = {
    title: string
    description: string | null
    durationMinutes: number
    settings: Prisma.JsonValue | null
    questions: SnapshotQuestionSource[]
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeSnapshotReferences(value: unknown): QuestionReferenceView[] {
    if (!Array.isArray(value)) {
        return []
    }

    return value
        .map((reference, index): QuestionReferenceView | null => {
            if (!isObjectRecord(reference)) {
                return null
            }

            const id = typeof reference.id === 'string' ? reference.id : null
            const kind = typeof reference.kind === 'string' ? reference.kind : null
            const mode = typeof reference.mode === 'string' ? reference.mode : null
            if (!id || !kind || !mode) {
                return null
            }

            const assetUrl = typeof reference.assetUrl === 'string' ? reference.assetUrl : null
            const title = sanitizeReferenceTitle(
                typeof reference.title === 'string' ? reference.title : null,
            )
            const textContent = sanitizePersistedReferenceText(
                typeof reference.textContent === 'string' ? reference.textContent : null,
                { assetUrl },
            )

            if (!shouldRenderReferencePayload({ mode, title, textContent, assetUrl })) {
                return null
            }

            return {
                id,
                order: Number.isInteger(reference.order) ? Number(reference.order) : index + 1,
                kind: kind as QuestionReferenceView['kind'],
                mode: mode as QuestionReferenceView['mode'],
                title,
                textContent,
                assetUrl,
                sourcePage: Number.isInteger(reference.sourcePage) ? Number(reference.sourcePage) : null,
                bbox: (reference.bbox ?? null) as Prisma.JsonValue | null,
                confidence: typeof reference.confidence === 'number' ? reference.confidence : null,
                evidence: (reference.evidence ?? null) as Prisma.JsonValue | null,
            }
        })
        .filter((reference): reference is QuestionReferenceView => reference !== null)
        .sort((left, right) => left.order - right.order)
}

function parseSnapshotQuestion(value: unknown): SessionQuestionSnapshot | null {
    if (!isObjectRecord(value)) {
        return null
    }

    if (
        typeof value.id !== 'string'
        || !Number.isInteger(value.order)
        || typeof value.stem !== 'string'
        || typeof value.difficulty !== 'string'
    ) {
        return null
    }

    return {
        id: value.id,
        order: Number(value.order),
        stem: value.stem,
        sharedContext: typeof value.sharedContext === 'string'
            ? sanitizePersistedSharedContext(value.sharedContext)
            : null,
        options: (value.options ?? null) as Prisma.JsonValue,
        difficulty: value.difficulty,
        topic: typeof value.topic === 'string' ? value.topic : null,
        explanation: typeof value.explanation === 'string' ? value.explanation : null,
        references: sanitizeSnapshotReferences(value.references),
    }
}

export function buildSessionTestSnapshot(source: SnapshotTestSource): SessionTestSnapshot {
    return {
        title: source.title,
        description: source.description,
        durationMinutes: source.durationMinutes,
        settings: source.settings,
        questions: source.questions.map((question) => ({
            id: question.id,
            order: question.order,
            stem: question.stem,
            sharedContext: sanitizePersistedSharedContext(question.sharedContext),
            options: question.options,
            difficulty: question.difficulty,
            topic: question.topic,
            explanation: question.explanation ?? null,
            references: question.references
                ? sanitizeSnapshotReferences(question.references)
                : mapQuestionReferences(question.referenceLinks),
        })),
    }
}

export function parseSessionTestSnapshot(value: Prisma.JsonValue | null | undefined): SessionTestSnapshot | null {
    if (!isObjectRecord(value)) {
        return null
    }

    if (
        typeof value.title !== 'string'
        || !Number.isInteger(value.durationMinutes)
        || !Array.isArray(value.questions)
    ) {
        return null
    }

    const questions = value.questions
        .map((question) => parseSnapshotQuestion(question))
        .filter((question): question is SessionQuestionSnapshot => question !== null)

    return {
        title: value.title,
        description: typeof value.description === 'string' ? value.description : null,
        durationMinutes: Number(value.durationMinutes),
        settings: (value.settings ?? null) as Prisma.JsonValue | null,
        questions,
    }
}
