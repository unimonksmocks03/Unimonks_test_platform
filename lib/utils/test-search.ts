function normalizeSearchValue(value: string) {
    return value
        .toLowerCase()
        .replace(/([a-z])(\d)/g, '$1 $2')
        .replace(/(\d)([a-z])/g, '$1 $2')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
}

export function getTestSearchTokens(value: string) {
    const normalized = normalizeSearchValue(value)

    if (!normalized) {
        return []
    }

    return [...new Set(normalized.split(/\s+/).filter(Boolean))]
}

export function matchesTestSearch(candidate: string, query: string) {
    const tokens = getTestSearchTokens(query)

    if (tokens.length === 0) {
        return true
    }

    const normalizedCandidate = normalizeSearchValue(candidate)
    return tokens.every((token) => normalizedCandidate.includes(token))
}

