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

export function sanitizeReferenceText(value: string | null | undefined) {
    const normalized = normalizeMultilineText(value)
    if (!normalized) {
        return null
    }

    const filteredLines = normalized
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => !isMetadataNoiseLine(line))

    if (filteredLines.length === 0) {
        return null
    }

    return filteredLines.join('\n').trim() || null
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
