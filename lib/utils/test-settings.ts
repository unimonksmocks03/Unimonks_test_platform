import { DEFAULT_TEST_SETTINGS } from '@/lib/config/platform-policy'

export type ResolvedTestSettings = {
    shuffleQuestions: boolean
    showResult: boolean
    passingScore: number
    correctMarks: number
    incorrectMarks: number
}

type QuestionAnswerEntry = {
    questionId: string
    optionId: string | null
}

type ScorableQuestion = {
    id: string
    options: unknown
}

function toSettingsObject(settings: unknown) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return {} as Record<string, unknown>
    }

    return settings as Record<string, unknown>
}

function readIntSetting(
    input: Record<string, unknown>,
    key: keyof Pick<ResolvedTestSettings, 'correctMarks' | 'incorrectMarks'>,
    fallback: number,
    min: number,
    max: number,
) {
    const rawValue = input[key]
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
        return fallback
    }

    const normalizedValue = Math.round(rawValue)
    return Math.min(max, Math.max(min, normalizedValue))
}

function readPercentageSetting(
    input: Record<string, unknown>,
    key: keyof Pick<ResolvedTestSettings, 'passingScore'>,
    fallback: number,
) {
    const rawValue = input[key]
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
        return fallback
    }

    return Math.min(100, Math.max(0, rawValue))
}

export function resolveTestSettings(settings: unknown): ResolvedTestSettings {
    const source = toSettingsObject(settings)

    return {
        shuffleQuestions: source.shuffleQuestions === true,
        showResult: source.showResult !== false,
        passingScore: readPercentageSetting(
            source,
            'passingScore',
            DEFAULT_TEST_SETTINGS.passingScore,
        ),
        correctMarks: readIntSetting(
            source,
            'correctMarks',
            DEFAULT_TEST_SETTINGS.correctMarks,
            1,
            20,
        ),
        incorrectMarks: readIntSetting(
            source,
            'incorrectMarks',
            DEFAULT_TEST_SETTINGS.incorrectMarks,
            0,
            20,
        ),
    }
}

export function getCorrectOptionId(rawOptions: unknown) {
    if (Array.isArray(rawOptions)) {
        const correctOption = (rawOptions as Array<{ id: string; isCorrect?: boolean }>).find(
            (option) => option.isCorrect,
        )

        return correctOption?.id ?? null
    }

    if (rawOptions && typeof rawOptions === 'object') {
        const optionMap = rawOptions as Record<string, string>
        return typeof optionMap.correct === 'string' ? optionMap.correct : null
    }

    return null
}

export function calculateTotalMarks(questionCount: number, settings: unknown) {
    const resolvedSettings = resolveTestSettings(settings)
    return questionCount * resolvedSettings.correctMarks
}

export function calculateQuestionAttemptSummary(
    questions: ScorableQuestion[],
    answers: QuestionAnswerEntry[],
    settings: unknown,
) {
    const resolvedSettings = resolveTestSettings(settings)
    const latestAnswers = new Map<string, string | null>()

    for (const answer of answers) {
        latestAnswers.set(answer.questionId, answer.optionId)
    }

    let correctCount = 0
    let incorrectCount = 0
    let unansweredCount = 0

    for (const question of questions) {
        const selectedOptionId = latestAnswers.get(question.id) ?? null
        const correctOptionId = getCorrectOptionId(question.options)

        if (!selectedOptionId || !correctOptionId) {
            unansweredCount += 1
            continue
        }

        if (selectedOptionId === correctOptionId) {
            correctCount += 1
            continue
        }

        incorrectCount += 1
    }

    const score = (correctCount * resolvedSettings.correctMarks) - (incorrectCount * resolvedSettings.incorrectMarks)
    const totalMarks = calculateTotalMarks(questions.length, resolvedSettings)
    const percentage = totalMarks > 0
        ? Math.round((score / totalMarks) * 10000) / 100
        : 0

    return {
        correctCount,
        incorrectCount,
        unansweredCount,
        score,
        totalMarks,
        percentage,
        settings: resolvedSettings,
    }
}
