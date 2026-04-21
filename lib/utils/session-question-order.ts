import { resolveTestSettings } from '@/lib/utils/test-settings'

export function createSeededRandom(seed: string) {
    let hash = 2166136261

    for (let index = 0; index < seed.length; index += 1) {
        hash ^= seed.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }

    return () => {
        hash += 0x6d2b79f5
        let value = hash
        value = Math.imul(value ^ (value >>> 15), value | 1)
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
}

export function shuffleArrayDeterministic<T>(input: T[], seed: string) {
    const shuffled = [...input]
    const random = createSeededRandom(seed)

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1))
        ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
    }

    return shuffled
}

export function applySessionQuestionOrder<T extends { order: number }>(
    questions: T[],
    settings: unknown,
    sessionSeed?: string,
) {
    const ordered = [...questions].sort((left, right) => left.order - right.order)

    if (!resolveTestSettings(settings).shuffleQuestions || !sessionSeed) {
        return ordered
    }

    return shuffleArrayDeterministic(ordered, sessionSeed).map((question, index) => ({
        ...question,
        order: index + 1,
    }))
}
