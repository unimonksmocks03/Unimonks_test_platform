export type DocumentType = 'MCQ_PAPER' | 'SOURCE_MATERIAL'
export type DocumentLayoutRisk = 'LOW' | 'MEDIUM' | 'HIGH'
export type RecommendedExtractionStrategy =
    | 'TEXT_EXACT'
    | 'MULTIMODAL_EXTRACT'
    | 'HYBRID_RECONCILE'
    | 'GENERATE_FROM_SOURCE'

export type DocumentClassificationResult = {
    documentType: DocumentType
    detectedQuestionCount: number | null
    layoutRisk: DocumentLayoutRisk
    hasTables: boolean
    hasPassages: boolean
    hasVisualReferences: boolean
    hasEmbeddedImages: boolean
    hasDiagramReasoning: boolean
    hasMatchFollowing: boolean
    hasAssertionReason: boolean
    isScannedLike: boolean
    isMixedLayout: boolean
    preferredStrategy: RecommendedExtractionStrategy
    reasons: string[]
}

type ClassifyDocumentForImportInput = {
    fileName: string
    text: string
    parseFailed?: boolean
}

function normalizeText(text: string) {
    return text
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function countMatches(text: string, regex: RegExp) {
    return [...text.matchAll(regex)].length
}

function getNonEmptyLines(text: string) {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
}

function determineLayoutRisk(input: {
    isScannedLike: boolean
    hasTables: boolean
    hasPassages: boolean
    hasVisualReferences: boolean
    hasMatchFollowing: boolean
    hasAssertionReason: boolean
    isMixedLayout: boolean
}) {
    if (
        input.isScannedLike
        || input.hasTables
        || input.hasPassages
        || input.hasVisualReferences
        || input.isMixedLayout
    ) {
        return 'HIGH' as const
    }

    if (input.hasMatchFollowing || input.hasAssertionReason) {
        return 'MEDIUM' as const
    }

    return 'LOW' as const
}

export function classifyDocumentForImport(input: ClassifyDocumentForImportInput): DocumentClassificationResult {
    const normalizedText = normalizeText(input.text)
    const lowerFileName = input.fileName.toLowerCase()
    const isPdf = lowerFileName.endsWith('.pdf')
    const nonEmptyLines = getNonEmptyLines(normalizedText)
    const oddOneOutSignature = `${normalizedText}\n${lowerFileName}`

    const questionCount = countMatches(
        normalizedText,
        /(?:^|\n)\s*(?:question\s*|ques(?:tion)?\s*|ues\s*|q\s*)?\d+\s*(?:[.):\-]|\banswer\b)/gi,
    )
    const inlineOptionBurstCount = nonEmptyLines.filter((line) => {
        const optionMarkers = line.match(/\([A-Da-d1-4]\)|[A-Da-d1-4][.)\-:]/g) ?? []
        return optionMarkers.length >= 3
    }).length
    const optionCount = countMatches(
        normalizedText,
        /(?:^|\n)\s*(?:\([A-Da-d1-4]\)|[A-Da-d1-4][.)\-:])\s+/g,
    )
    const answerHintCount = countMatches(
        normalizedText,
        /(?:^|\n)\s*(?:answer|correct answer)\s*\d*\s*[:(]/gi,
    )
    const hasAnswerKeySection = /(answer key|quick answer grid|detailed answers|correct answer)/i.test(normalizedText)
    const tableLikeRowCount = nonEmptyLines.filter((line) => {
        if (/\b(table|data interpretation|chart|graph|dataset|tabulation)\b/i.test(line)) {
            return false
        }

        const numericTokenCount = (line.match(/\b\d+\b/g) ?? []).length
        if (numericTokenCount < 4) {
            return false
        }

        return /^[A-Za-z][A-Za-z0-9.&/()\- ]*\s+\d+(?:\s+\d+){3,}$/i.test(line)
            || /^(?:[A-Za-z]|\d+)\s+\d+(?:\s+\d+){3,}$/i.test(line)
    }).length
    const hasTables = /\b(table(?!\s+tennis\b)|data interpretation|chart|graph|dataset|tabulation)\b/i.test(normalizedText)
        || tableLikeRowCount >= 2
    const hasPassages = /(read the passage|following passage|based on the passage|study the following passage|case study based|case-study based|case based)/i.test(normalizedText)
    const hasEmbeddedImages = /\[image(?:[:\]])/i.test(normalizedText)
    const isOddOneOutOnly = /\bodd\s*[- ]\s*one\s*out\b|\bodd\s+man\s+out\b|\bfind\s+the\s+odd\b/i.test(oddOneOutSignature)
    const hasDiagramReasoning = !isOddOneOutOnly && (
        /\b(venn diagram|figure completion|figure formation|figure series|embedded figure|mirror image|paper folding|paper cutting|water image|cube(?:s)? and dice|counting (?:triangle|square|figure)|how many triangles|how many squares|how many rectangles|how many circles|how many lines)\b/i.test(normalizedText)
        || /\b(venn|figure completion|figure formation|mirror image|paper folding|water image|triangle counting|square counting)\b/i.test(lowerFileName)
    )
    const hasVisualReferences = !isOddOneOutOnly && (
        /\b(venn diagram|diagram-based|figure completion|figure formation|figure series|embedded figure|mirror image|paper folding|paper cutting|water image|cube(?:s)? and dice|analogy figure|choose the figure|select the figure|which figure|counting (?:triangle|square|figure)|how many triangles|how many squares)\b/i.test(normalizedText)
        || /\b(venn|diagram|figure|formation|completion)\b/i.test(lowerFileName)
        || hasEmbeddedImages
    )
    const hasMatchFollowing = /(match the following|match the correct pair|list i|list ii)/i.test(normalizedText)
    const hasAssertionReason = /\bassertion\b/i.test(normalizedText) && /\breason\b/i.test(normalizedText)
    const hasStrongExtractableMcqText =
        questionCount >= 3
        && (
            optionCount >= Math.max(12, questionCount * 2)
            || inlineOptionBurstCount >= Math.max(1, Math.floor(questionCount * 0.3))
            || answerHintCount >= Math.max(3, Math.floor(questionCount * 0.4))
            || hasAnswerKeySection
        )
    const fragmentedLineCount = nonEmptyLines.filter((line) => line.length <= 8).length
    const isScannedLike = Boolean(input.parseFailed)
        || (isPdf && normalizedText.length < 300 && questionCount === 0 && optionCount < 4 && inlineOptionBurstCount === 0)
        || (isPdf && questionCount <= 2 && fragmentedLineCount >= 3 && optionCount < 4 && inlineOptionBurstCount === 0 && answerHintCount === 0)
    const isMixedLayout =
        (hasTables || hasPassages || hasVisualReferences)
        && (hasMatchFollowing || hasAssertionReason)
    const looksLikeMcqPaper =
        (
            questionCount >= 3
            && (
                optionCount >= Math.max(8, questionCount * 2)
                || answerHintCount >= Math.max(2, Math.floor(questionCount * 0.4))
                || hasAnswerKeySection
            )
        )
        || (
            questionCount >= 1
            && (optionCount >= 4 || inlineOptionBurstCount >= 1)
            && (
                hasTables
                || hasPassages
                || hasMatchFollowing
                || hasAssertionReason
                || answerHintCount >= 1
                || hasAnswerKeySection
                || inlineOptionBurstCount >= 1
            )
        )

    const documentType: DocumentType = looksLikeMcqPaper || (isPdf && isScannedLike)
        ? 'MCQ_PAPER'
        : 'SOURCE_MATERIAL'

    const layoutRisk = determineLayoutRisk({
        isScannedLike,
        hasTables,
        hasPassages,
        hasVisualReferences,
        hasMatchFollowing,
        hasAssertionReason,
        isMixedLayout,
    })

    let preferredStrategy: RecommendedExtractionStrategy
    if (documentType === 'SOURCE_MATERIAL') {
        preferredStrategy = 'GENERATE_FROM_SOURCE'
    } else if (isScannedLike) {
        preferredStrategy = 'MULTIMODAL_EXTRACT'
    } else if (hasDiagramReasoning) {
        preferredStrategy = hasStrongExtractableMcqText
            ? 'HYBRID_RECONCILE'
            : 'MULTIMODAL_EXTRACT'
    } else if (hasVisualReferences) {
        preferredStrategy = hasStrongExtractableMcqText
            ? 'HYBRID_RECONCILE'
            : 'MULTIMODAL_EXTRACT'
    } else if (hasTables || hasPassages || isMixedLayout) {
        preferredStrategy = 'MULTIMODAL_EXTRACT'
    } else if (hasMatchFollowing || hasAssertionReason) {
        preferredStrategy = 'MULTIMODAL_EXTRACT'
    } else {
        preferredStrategy = 'TEXT_EXACT'
    }

    const reasons: string[] = []
    if (documentType === 'MCQ_PAPER') reasons.push('Detected numbered questions with option/answer patterns')
    else reasons.push('Did not detect a stable MCQ-paper structure')
    if (hasTables) reasons.push('Detected table/data-heavy layout')
    if (hasPassages) reasons.push('Detected passage/case-study layout')
    if (hasVisualReferences) reasons.push('Detected visual-reference or diagram-heavy layout')
    if (hasEmbeddedImages) reasons.push('Detected embedded document images that may need multimodal visual-reference recovery')
    if (hasDiagramReasoning) reasons.push(
        hasStrongExtractableMcqText
            ? 'Detected diagram-heavy reasoning format with strong OCR signals; using text-first extraction and manual visual-reference capture.'
            : 'Detected diagram-heavy reasoning format that should be extracted visually first',
    )
    if (hasVisualReferences && hasStrongExtractableMcqText) reasons.push('Detected strong OCR/text signals, so visual references can be layered onto exact extraction')
    if (hasMatchFollowing) reasons.push('Detected match-the-following/list-based format')
    if (hasAssertionReason) reasons.push('Detected assertion-reason format')
    if (isScannedLike) reasons.push('Low-text or parse-failed PDF resembles scanned content')
    if (isMixedLayout) reasons.push('Detected mixed layout traits that increase extraction risk')

    return {
        documentType,
        detectedQuestionCount: questionCount > 0 ? questionCount : null,
        layoutRisk,
        hasTables,
        hasPassages,
        hasVisualReferences,
        hasEmbeddedImages,
        hasDiagramReasoning,
        hasMatchFollowing,
        hasAssertionReason,
        isScannedLike,
        isMixedLayout,
        preferredStrategy,
        reasons,
    }
}
