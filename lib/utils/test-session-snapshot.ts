import type { Prisma } from '@prisma/client'

import {
    mapQuestionReferences,
    type QuestionReferenceView,
} from '@/lib/utils/question-references'
import { sanitizeReferenceText } from '@/lib/utils/reference-sanitizer'

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
            ? sanitizeReferenceText(value.sharedContext)
            : null,
        options: (value.options ?? null) as Prisma.JsonValue,
        difficulty: value.difficulty,
        topic: typeof value.topic === 'string' ? value.topic : null,
        explanation: typeof value.explanation === 'string' ? value.explanation : null,
        references: Array.isArray(value.references)
            ? value.references as QuestionReferenceView[]
            : [],
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
            sharedContext: sanitizeReferenceText(question.sharedContext),
            options: question.options,
            difficulty: question.difficulty,
            topic: question.topic,
            explanation: question.explanation ?? null,
            references: question.references ?? mapQuestionReferences(question.referenceLinks),
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
