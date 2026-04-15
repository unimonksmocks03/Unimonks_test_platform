const REFERENCE_METADATA_NOISE_PATTERNS = [
    /^pdf$/i,
    /^shared\s+reference$/i,
    /^reference(?:\s+\d+)?$/i,
    /^[\w./-]+\.(?:pdf|docx?|pptx?|xlsx?|csv|png|jpe?g|webp)$/i,
    /generate\s+(?:a\s+)?mock\s+test/i,
    /according\s+to\s+the\s+format/i,
    /^uploaded\s+(?:file|document)$/i,
    /^source\s+(?:file|document)$/i,
]

const REFERENCE_CONTEXT_HINT_REGEX =
    /\b(?:table|data|chart|dataset|figure|diagram|graph|map|venn|passage|case study|read the following|list i|list ii|column i|column ii|match the following|match the correct pair)\b/i

const LOWERCASE_OPTION_LINE_REGEX = /^(?:\([a-d]\)|[a-d][.)])\s+.+$/i
const UPPERCASE_OPTION_LINE_REGEX = /^(?:\([A-D]\)|[A-D][.)])\s+.+$/
const ANSWER_OR_EXPLANATION_LINE_REGEX =
    /^(?:answer|ans(?:wer)?|explanation|reason|difficulty|topic)\b/i

function isMetadataNoiseLine(line: string) {
    const normalized = line.trim()
    if (!normalized) {
        return true
    }

    return REFERENCE_METADATA_NOISE_PATTERNS.some((pattern) => pattern.test(normalized))
}

function normalizeMultilineText(value: string | null | undefined) {
    if (typeof value !== 'string') {
        return null
    }

    const normalized = value
        .replace(/\r\n/g, '\n')
        .replace(/\u00a0/g, ' ')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n')
        .trim()

    return normalized || null
}

function looksLikeQuestionContentLeak(value: string) {
    const lines = value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

    if (lines.length === 0) {
        return false
    }

    const hasReferenceHint = REFERENCE_CONTEXT_HINT_REGEX.test(value)
    const lowercaseOptionLines = lines.filter((line) => LOWERCASE_OPTION_LINE_REGEX.test(line)).length
    const uppercaseOptionLines = lines.filter((line) => UPPERCASE_OPTION_LINE_REGEX.test(line)).length
    const hasAnswerOrExplanationLine = lines.some((line) => ANSWER_OR_EXPLANATION_LINE_REGEX.test(line))

    if (hasReferenceHint) {
        return false
    }

    if (hasAnswerOrExplanationLine) {
        return true
    }

    return lowercaseOptionLines + uppercaseOptionLines >= 2
}

function isQuestionLeakLine(line: string) {
    const normalized = line.trim()
    if (!normalized) {
        return false
    }

    return (
        LOWERCASE_OPTION_LINE_REGEX.test(normalized)
        || UPPERCASE_OPTION_LINE_REGEX.test(normalized)
        || ANSWER_OR_EXPLANATION_LINE_REGEX.test(normalized)
    )
}

export function sanitizeReferenceText(value: string | null | undefined) {
    const normalized = normalizeMultilineText(value)
    if (!normalized) {
        return null
    }

    const normalizedLines = normalized
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

    const hasReferenceHint = normalizedLines.some((line) => REFERENCE_CONTEXT_HINT_REGEX.test(line))

    const filteredLines = normalizedLines
        .filter((line) => !isMetadataNoiseLine(line))
        .filter((line) => hasReferenceHint || !isQuestionLeakLine(line))

    if (filteredLines.length === 0) {
        return null
    }

    const joined = filteredLines.join('\n').trim()
    if (!joined) {
        return null
    }

    return looksLikeQuestionContentLeak(joined) ? null : joined
}

export function sanitizeReferenceTitle(value: string | null | undefined) {
    const normalized = normalizeMultilineText(value)
    if (!normalized) {
        return null
    }

    return isMetadataNoiseLine(normalized) ? null : normalized
}

export function isPotentialReferenceMetadataNoiseLine(line: string) {
    return isMetadataNoiseLine(line)
}

export function shouldRenderReferencePayload(input: {
    mode: string | null | undefined
    title: string | null | undefined
    textContent: string | null | undefined
    assetUrl: string | null | undefined
}) {
    if (input.assetUrl) {
        return true
    }

    if (input.mode && input.mode !== 'TEXT') {
        return true
    }

    return Boolean(input.title || input.textContent)
}
