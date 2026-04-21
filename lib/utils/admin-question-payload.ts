import type {
    CreateQuestionInput,
    UpdateQuestionInput,
} from '@/lib/validations/test.schema'

type EditableQuestionOption = {
    id: string
    text: string
    isCorrect: boolean
}

type EditableQuestion = {
    stem: string
    sharedContext: string
    options: EditableQuestionOption[]
    difficulty: 'EASY' | 'MEDIUM' | 'HARD'
    topic: string
    explanation: string
}

function normalizeOptionalString(value: string) {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

function normalizeOptions(options: EditableQuestionOption[]) {
    return options.map((option) => ({
        ...option,
        text: option.text.trim(),
    }))
}

export function buildAdminQuestionCreatePayload(question: EditableQuestion): CreateQuestionInput {
    return {
        stem: question.stem.trim(),
        sharedContext: normalizeOptionalString(question.sharedContext) ?? undefined,
        options: normalizeOptions(question.options),
        difficulty: question.difficulty,
        topic: normalizeOptionalString(question.topic) ?? undefined,
        explanation: normalizeOptionalString(question.explanation) ?? undefined,
    }
}

export function buildAdminQuestionUpdatePayload(question: EditableQuestion): UpdateQuestionInput {
    return {
        stem: question.stem.trim(),
        sharedContext: normalizeOptionalString(question.sharedContext),
        options: normalizeOptions(question.options),
        difficulty: question.difficulty,
        topic: normalizeOptionalString(question.topic),
        explanation: normalizeOptionalString(question.explanation),
    }
}
