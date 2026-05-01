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

const LOWERCASE_OPTION_LINE_REGEX = /^(?:\([a-d]\)|[a-d][.)])\s+.+$/
const UPPERCASE_OPTION_LINE_REGEX = /^(?:\([A-D]\)|[A-D][.)])\s+.+$/
const NUMERIC_OPTION_LINE_REGEX = /^(?:\([1-4]\)|[1-4][.)])\s+.+$/
const ANSWER_OR_EXPLANATION_LINE_REGEX =
    /^(?:(?:answer|ans(?:wer)?)(?!\s+(?:the|these|all|any)\b)|correct\s+(?:answer|option)|hint|explanation|solution|reason(?!\s*\([rR]\))|difficulty|topic)\b/i

const LIST_OR_MATCH_REFERENCE_REGEX =
    /\b(?:list\s+i|list\s+ii|column\s+i|column\s+ii|match the following|match the correct pair)\b/i
const PASSAGE_REFERENCE_REGEX =
    /\b(?:read|study|consider)\s+(?:the\s+)?following\b|\b(?:following|given)\s+(?:passage|case study|information)\b|\b(?:passage|case study)\b/i
const TABLE_REFERENCE_REGEX =
    /\b(?:table|data|dataset|tabulation|chart|graph|following data|given data)\b/i
const VISUAL_REFERENCE_REGEX =
    /\b(?:figure|diagram|venn|map|graph|chart|visual|snapshot|image|illustration|pattern)\b/i

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

    const lowercaseOptionLines = lines.filter((line) => LOWERCASE_OPTION_LINE_REGEX.test(line)).length
    const uppercaseOptionLines = lines.filter((line) => UPPERCASE_OPTION_LINE_REGEX.test(line)).length
    const numericOptionLines = lines.filter((line) => NUMERIC_OPTION_LINE_REGEX.test(line)).length
    const hasAnswerOrExplanationLine = lines.some((line) => ANSWER_OR_EXPLANATION_LINE_REGEX.test(line))

    if (hasAnswerOrExplanationLine) {
        return true
    }

    if (LIST_OR_MATCH_REFERENCE_REGEX.test(value)) {
        return false
    }

    return lowercaseOptionLines + uppercaseOptionLines + numericOptionLines >= 2
}

function looksLikeStructuredTable(value: string) {
    const lines = value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

    if (lines.length < 2) {
        return false
    }

    const tabularLines = lines.filter((line) => {
        const numericTokenCount = (line.match(/\b\d+(?:\.\d+)?%?\b/g) ?? []).length
        return (
            line.includes('|')
            || line.includes('\t')
            || numericTokenCount >= 3
            || /^[A-Za-z][A-Za-z0-9.&/()\- ]+\s+\d+(?:\s+\d+){1,}$/.test(line)
        )
    })

    return tabularLines.length >= 1 && (
        lines.length >= 3
        || TABLE_REFERENCE_REGEX.test(value)
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

    const filteredLines = normalizedLines
        .filter((line) => !isMetadataNoiseLine(line))

    if (filteredLines.length === 0) {
        return null
    }

    const joined = filteredLines.join('\n').trim()
    if (!joined) {
        return null
    }

    return looksLikeQuestionContentLeak(joined) ? null : joined
}

export function isAllowedAutoSharedContext(value: string | null | undefined) {
    const sanitized = sanitizeReferenceText(value)
    if (!sanitized) {
        return false
    }

    const lines = sanitized
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

    if (LIST_OR_MATCH_REFERENCE_REGEX.test(sanitized)) {
        return true
    }

    if (PASSAGE_REFERENCE_REGEX.test(sanitized) && sanitized.length >= 40) {
        return true
    }

    if (looksLikeStructuredTable(sanitized)) {
        return true
    }

    if (TABLE_REFERENCE_REGEX.test(sanitized) && (lines.length >= 2 || /\d/.test(sanitized))) {
        return true
    }

    if (VISUAL_REFERENCE_REGEX.test(sanitized) && sanitized.length >= 20) {
        return true
    }

    return false
}

export function sanitizePersistedSharedContext(
    value: string | null | undefined,
    options: { requireAllowedAutoContext?: boolean } = {},
) {
    const sanitized = sanitizeReferenceText(value)
    if (!sanitized) {
        return null
    }

    if (options.requireAllowedAutoContext && !isAllowedAutoSharedContext(sanitized)) {
        return null
    }

    return sanitized
}

export function sanitizePersistedReferenceText(
    value: string | null | undefined,
    options: {
        assetUrl?: string | null | undefined
        requireAllowedAutoContext?: boolean
    } = {},
) {
    if (options.assetUrl) {
        return null
    }

    const sanitized = sanitizeReferenceText(value)
    if (!sanitized) {
        return null
    }

    if (options.requireAllowedAutoContext && !isAllowedAutoSharedContext(sanitized)) {
        return null
    }

    return sanitized
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
