export type PublishedBuilderQuestionLike = {
    saved: boolean
    stem: string
}

export type PublishedBuilderState = {
    title: string
    savedTitle: string
    description: string
    savedDescription: string
    durationMinutes: number
    savedDurationMinutes: number
    questions: PublishedBuilderQuestionLike[]
}

function normalizeTitle(value: string) {
    return value.trim()
}

function normalizeDescription(value: string) {
    const normalized = value.trim()
    return normalized.length > 0 ? normalized : null
}

export function buildPublishedTestUpdatePayload(input: PublishedBuilderState) {
    const payload: {
        title?: string
        description?: string | null
        durationMinutes?: number
    } = {}

    const nextTitle = normalizeTitle(input.title)
    const previousTitle = normalizeTitle(input.savedTitle)
    if (nextTitle !== previousTitle) {
        payload.title = nextTitle
    }

    const nextDescription = normalizeDescription(input.description)
    const previousDescription = normalizeDescription(input.savedDescription)
    if (nextDescription !== previousDescription) {
        payload.description = nextDescription
    }

    if (input.durationMinutes !== input.savedDurationMinutes) {
        payload.durationMinutes = input.durationMinutes
    }

    return payload
}

export function hasPersistablePublishedQuestionChanges(
    questions: PublishedBuilderQuestionLike[],
) {
    return questions.some((question) => !question.saved && question.stem.trim().length > 0)
}

export function hasPublishedBuilderChanges(input: PublishedBuilderState) {
    const metadataChanges = Object.keys(buildPublishedTestUpdatePayload(input)).length > 0
    return metadataChanges || hasPersistablePublishedQuestionChanges(input.questions)
}
