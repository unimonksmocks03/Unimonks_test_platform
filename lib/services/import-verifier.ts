import type {
    VerificationIssue,
    VerificationIssueCategory,
    VerificationIssueSeverity,
    VerificationResult,
} from '@/lib/services/ai-extraction-schemas'
import type {
    AIVerificationResult,
    ExtractedQuestionAnalysis,
    GeneratedQuestion,
} from '@/lib/services/ai-service.types'

type NormalizeQuestionFn = (question: Partial<GeneratedQuestion> | null | undefined) => GeneratedQuestion | null

export type VerificationContext = {
    extractionAnalysis?: Pick<
        ExtractedQuestionAnalysis,
        | 'expectedQuestionCount'
        | 'exactMatchAchieved'
        | 'invalidQuestionNumbers'
        | 'missingQuestionNumbers'
        | 'duplicateQuestionNumbers'
        | 'questions'
    > | null
    comparisonQuestions?: GeneratedQuestion[] | null
}

export type ImportVerificationDecision = 'EXACT_ACCEPTED' | 'REVIEW_REQUIRED' | 'FAILED_WITH_REASON'

export type ImportVerificationOutcome = {
    decision: ImportVerificationDecision
    message: string | null
    errorCount: number
    warningCount: number
}

const SHARED_CONTEXT_REFERENCE_PATTERN = /\b(?:following|above|below)\s+(?:table|data|chart|graph|passage|information)\b|\b(?:table|data|chart|graph|passage|information)\s+(?:given|shown|below|above)\b|\blist i\b|\blist ii\b/i
const VISUAL_REFERENCE_PATTERN = /\b(?:figure|diagram|venn|pattern|mirror image|water image|paper folding|embedded figure|missing figure|complete the figure|figure completion|figure formation|graph|chart|map|triangle|square|circle|cube|shaded region)\b/i
const VISUAL_BLOCK_PATTERN = /[┌┐└┘├┤┬┴│─╭╮╰╯★☆●○■□▲△◆◇◯◎\\/]{2,}/
const OPTION_ID_SEQUENCE = ['A', 'B', 'C', 'D']
const LOW_CONFIDENCE_THRESHOLD = 0.55
const SUSPICIOUS_ANSWER_SKEW_THRESHOLD = 0.78
const MIN_QUESTIONS_FOR_SKEW_CHECK = 20
const STEM_SIMILARITY_THRESHOLD = 0.82
const CROSS_VERIFIER_COUNT_DELTA = 2
const CROSS_VERIFIER_OVERLAP_THRESHOLD = 0.6
const VISUAL_GENERIC_STEM_PATTERN = /^(?:find the missing figure|which piece completes the pattern|which option completes the figure|which option completes the pattern|select the correct option\.?|select the figure|choose the figure|which figure)/i
function isVisualReferenceKind(kind: string | null | undefined): kind is 'DIAGRAM' | 'GRAPH' | 'MAP' {
    return kind === 'DIAGRAM' || kind === 'GRAPH' || kind === 'MAP'
}

function isTextBackedReferenceKind(kind: string | null | undefined): kind is 'PASSAGE' | 'TABLE' | 'LIST_MATCH' | 'OTHER' {
    return kind === 'PASSAGE' || kind === 'TABLE' || kind === 'LIST_MATCH' || kind === 'OTHER'
}

function normalizeWhitespace(value: string | null | undefined) {
    if (typeof value !== 'string') return ''
    return value.replace(/\s+/g, ' ').trim()
}

function normalizeStemKey(value: string | null | undefined) {
    return normalizeWhitespace(value)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .trim()
}

function normalizeSharedContextText(value: string | null | undefined) {
    const normalized = normalizeWhitespace(value)
    return normalized.length > 0 ? normalized : null
}

function looksLikeVisualEvidence(value: string | null | undefined) {
    const normalized = normalizeWhitespace(value)
    if (!normalized) {
        return false
    }

    return VISUAL_REFERENCE_PATTERN.test(normalized) || VISUAL_BLOCK_PATTERN.test(normalized)
}

function hasUsableVisualEvidencePayload(values: Array<string | null | undefined>) {
    return values.some((value) => {
        const normalized = normalizeWhitespace(value)
        if (!normalized) {
            return false
        }

        if (looksLikeVisualEvidence(normalized) && !isVisualGenericStem(normalized)) {
            return true
        }

        return VISUAL_BLOCK_PATTERN.test(normalized)
    })
}

function isVisualGenericStem(value: string | null | undefined) {
    return VISUAL_GENERIC_STEM_PATTERN.test(normalizeWhitespace(value))
}

function buildDedupStemKey(question: Pick<GeneratedQuestion, 'stem' | 'sharedContext'> | null | undefined) {
    if (!question) return ''

    const stem = normalizeWhitespace(question.stem)
    const stemKey = normalizeStemKey(stem).slice(0, 160)
    if (!stemKey) return ''

    const contextKey = normalizeStemKey(normalizeSharedContextText(question.sharedContext)).slice(0, 160)
    if (isVisualGenericStem(stem) && contextKey) {
        return `${stemKey}::${contextKey}`
    }

    return stemKey
}

function buildSimilaritySource(question: Pick<GeneratedQuestion, 'stem' | 'sharedContext'> | null | undefined) {
    if (!question) return ''

    const stem = normalizeWhitespace(question.stem)
    const sharedContext = normalizeSharedContextText(question.sharedContext)
    if (isVisualGenericStem(stem) && sharedContext) {
        return `${stem}\n${sharedContext}`
    }

    return stem
}

function normalizeOptionKey(values: Array<{ text: string }> | null | undefined) {
    if (!Array.isArray(values)) return ''
    return values
        .map((option) => normalizeStemKey(option?.text ?? ''))
        .filter(Boolean)
        .join('|')
}

function hasMeaningfullyDifferentQuestionPayload(
    left: Pick<GeneratedQuestion, 'options' | 'sharedContext'> | null | undefined,
    right: Pick<GeneratedQuestion, 'options' | 'sharedContext'> | null | undefined,
) {
    if (!left || !right) return false

    const leftOptions = normalizeOptionKey(left.options)
    const rightOptions = normalizeOptionKey(right.options)
    if (leftOptions && rightOptions && leftOptions !== rightOptions) {
        return true
    }

    const leftContext = normalizeStemKey(normalizeSharedContextText(left.sharedContext))
    const rightContext = normalizeStemKey(normalizeSharedContextText(right.sharedContext))
    if (leftContext && rightContext && leftContext !== rightContext) {
        return true
    }

    return false
}

function tokenizeStem(value: string | null | undefined) {
    return new Set(
        normalizeStemKey(value)
            .split(' ')
            .filter((token) => token.length > 2 || /^\d+$/.test(token)),
    )
}

function calculateStemSimilarity(left: string | null | undefined, right: string | null | undefined) {
    const leftTokens = tokenizeStem(left)
    const rightTokens = tokenizeStem(right)
    if (leftTokens.size === 0 || rightTokens.size === 0) {
        return 0
    }

    let intersection = 0
    for (const token of leftTokens) {
        if (rightTokens.has(token)) {
            intersection += 1
        }
    }

    const denominator = new Set([...leftTokens, ...rightTokens]).size
    return denominator > 0 ? intersection / denominator : 0
}

function createIssue(
    questionNumber: number,
    issue: string,
    category: VerificationIssueCategory,
    severity: VerificationIssueSeverity = 'ERROR',
    code?: string,
): VerificationIssue {
    return {
        questionNumber,
        issue,
        category,
        severity,
        ...(code ? { code } : {}),
    }
}

function buildIssueSummary(issues: VerificationIssue[]) {
    return issues.reduce(
        (summary, issue) => {
            if (issue.category === 'STRUCTURAL') summary.structural += 1
            if (issue.category === 'EVIDENCE') summary.evidence += 1
            if (issue.category === 'CROSS') summary.cross += 1
            if (issue.severity === 'ERROR') summary.errors += 1
            if (issue.severity === 'WARNING') summary.warnings += 1
            return summary
        },
        {
            structural: 0,
            evidence: 0,
            cross: 0,
            errors: 0,
            warnings: 0,
        },
    )
}

function buildIssueMergeKey(issue: VerificationIssue) {
    return `${issue.questionNumber}:${issue.category}:${issue.code ?? issue.issue}`
}

function buildVerificationOutcomeMessage(
    issues: VerificationIssue[],
    severity: VerificationIssueSeverity,
) {
    const relevantIssues = issues.filter((issue) => issue.severity === severity).slice(0, 3)
    if (relevantIssues.length === 0) {
        return null
    }

    return relevantIssues
        .map((issue) => {
            if (issue.questionNumber > 0) {
                return `Q${issue.questionNumber}: ${issue.issue}`
            }

            return issue.issue
        })
        .join(' | ')
}

function getCorrectOptionId(question: GeneratedQuestion) {
    return question.options.find((option) => option.isCorrect)?.id ?? null
}

function verifyStructuralIssues(
    questions: GeneratedQuestion[],
    validatedQuestions: Array<GeneratedQuestion | null>,
    expectedCount: number | null,
    context: VerificationContext | undefined,
) {
    const issues: VerificationIssue[] = []
    const invalidQuestionNumbers = new Set<number>()
    const seenExactStems = new Map<string, { questionNumber: number; question: GeneratedQuestion | null }>()
    const priorQuestions: Array<{ questionNumber: number; stem: string; question: GeneratedQuestion | null }> = []

    if (expectedCount !== null && validatedQuestions.length !== expectedCount) {
        issues.push(
            createIssue(
                0,
                `Expected ${expectedCount} questions, got ${validatedQuestions.length} (count mismatch)`,
                'STRUCTURAL',
                'ERROR',
                'COUNT_MISMATCH',
            ),
        )
    }

    if (context?.extractionAnalysis) {
        const shouldTrustExactRecovery = context.extractionAnalysis.exactMatchAchieved

        if (!shouldTrustExactRecovery && context.extractionAnalysis.missingQuestionNumbers.length > 0) {
            issues.push(
                createIssue(
                    0,
                    `Missing numbered questions: ${context.extractionAnalysis.missingQuestionNumbers.join(', ')}`,
                    'STRUCTURAL',
                    'ERROR',
                    'NUMBERING_GAP',
                ),
            )
        }
        if (!shouldTrustExactRecovery && context.extractionAnalysis.duplicateQuestionNumbers.length > 0) {
            issues.push(
                createIssue(
                    0,
                    `Duplicate question numbers detected: ${context.extractionAnalysis.duplicateQuestionNumbers.join(', ')}`,
                    'STRUCTURAL',
                    'ERROR',
                    'NUMBERING_DUPLICATE',
                ),
            )
        }
        if (!shouldTrustExactRecovery && context.extractionAnalysis.invalidQuestionNumbers.length > 0) {
            issues.push(
                createIssue(
                    0,
                    `Invalid question numbers detected: ${context.extractionAnalysis.invalidQuestionNumbers.join(', ')}`,
                    'STRUCTURAL',
                    'ERROR',
                    'NUMBERING_INVALID',
                ),
            )
        }
    }

    for (let index = 0; index < validatedQuestions.length; index += 1) {
        const questionNumber = index + 1
        const rawQuestion = questions[index]
        const rawStem = normalizeWhitespace(rawQuestion?.stem)
        const rawStemKey = buildDedupStemKey(rawQuestion)
        const duplicateOf = rawStemKey ? seenExactStems.get(rawStemKey) : undefined
        if (duplicateOf && !hasMeaningfullyDifferentQuestionPayload(rawQuestion, duplicateOf.question)) {
            issues.push(
                createIssue(
                    questionNumber,
                    `Duplicate stem (same as question ${duplicateOf.questionNumber})`,
                    'STRUCTURAL',
                    'ERROR',
                    'DUPLICATE_STEM',
                ),
            )
            invalidQuestionNumbers.add(questionNumber)
        } else if (rawStemKey) {
            seenExactStems.set(rawStemKey, { questionNumber, question: rawQuestion })
        }

        const question = validatedQuestions[index]
        if (!question) {
            issues.push(
                createIssue(
                    questionNumber,
                    'Question failed structured validation',
                    'STRUCTURAL',
                    'ERROR',
                    'SCHEMA_INVALID',
                ),
            )
            invalidQuestionNumbers.add(questionNumber)
            continue
        }

        for (const priorQuestion of priorQuestions) {
            if (
                priorQuestion.stem !== question.stem
                && !hasMeaningfullyDifferentQuestionPayload(priorQuestion.question, question)
                && calculateStemSimilarity(priorQuestion.stem, question.stem) >= STEM_SIMILARITY_THRESHOLD
            ) {
                issues.push(
                    createIssue(
                        questionNumber,
                        `Near-duplicate stem resembles question ${priorQuestion.questionNumber}`,
                        'STRUCTURAL',
                        'ERROR',
                        'NEAR_DUPLICATE_STEM',
                    ),
                )
                invalidQuestionNumbers.add(questionNumber)
                break
            }
        }
        priorQuestions.push({
            questionNumber,
            stem: buildSimilaritySource(question),
            question,
        })

        const optionIds = question.options.map((option) => option.id)
        if (question.options.length !== 4) {
            issues.push(
                createIssue(
                    questionNumber,
                    `Has ${question.options.length} options instead of 4`,
                    'STRUCTURAL',
                    'ERROR',
                    'OPTION_COUNT',
                ),
            )
            invalidQuestionNumbers.add(questionNumber)
        }

        const optionIdSequenceMatches = optionIds.length === OPTION_ID_SEQUENCE.length
            && optionIds.every((optionId, optionIndex) => optionId === OPTION_ID_SEQUENCE[optionIndex])
        if (!optionIdSequenceMatches) {
            issues.push(
                createIssue(
                    questionNumber,
                    `Option IDs are out of order or duplicated (${optionIds.join(', ') || 'none'})`,
                    'STRUCTURAL',
                    'ERROR',
                    'OPTION_SEQUENCE',
                ),
            )
            invalidQuestionNumbers.add(questionNumber)
        }

        const correctCount = question.options.filter((option) => option.isCorrect).length
        if (correctCount !== 1) {
            issues.push(
                createIssue(
                    questionNumber,
                    `Has ${correctCount} correct options instead of 1`,
                    'STRUCTURAL',
                    'ERROR',
                    'CORRECT_OPTION_COUNT',
                ),
            )
            invalidQuestionNumbers.add(questionNumber)
        }
    }

    return { issues, invalidQuestionNumbers }
}

function verifyEvidenceIssues(validatedQuestions: Array<GeneratedQuestion | null>) {
    const issues: VerificationIssue[] = []
    const invalidQuestionNumbers = new Set<number>()

    for (let index = 0; index < validatedQuestions.length; index += 1) {
        const questionNumber = index + 1
        const question = validatedQuestions[index]
        if (!question) {
            continue
        }

        const sharedContext = normalizeSharedContextText(question.sharedContext)
        const sourceSnippet = normalizeWhitespace(question.sourceSnippet)
        const sharedContextEvidence = normalizeWhitespace(question.sharedContextEvidence)
        const referenceKind = question.referenceKind ?? 'NONE'
        const referenceMode = question.referenceMode ?? null
        const hasSharedContext = Boolean(sharedContext)
        const hasVisualEvidence = hasUsableVisualEvidencePayload([
            question.sharedContext,
            question.sharedContextEvidence,
            question.sourceSnippet,
        ])

        if (
            SHARED_CONTEXT_REFERENCE_PATTERN.test(question.stem)
            && !hasSharedContext
        ) {
            issues.push(
                createIssue(
                    questionNumber,
                    'Question references shared source material but has no shared context attached',
                    'EVIDENCE',
                    'ERROR',
                    'MISSING_SHARED_CONTEXT',
                ),
            )
            invalidQuestionNumbers.add(questionNumber)
        }

        if (question.extractionMode && question.extractionMode !== 'GENERATE_FROM_SOURCE' && !sourceSnippet) {
            issues.push(
                createIssue(
                    questionNumber,
                    'Question has no source snippet evidence attached',
                    'EVIDENCE',
                    'ERROR',
                    'MISSING_SOURCE_SNIPPET',
                ),
            )
            invalidQuestionNumbers.add(questionNumber)
        }

        if (question.extractionMode === 'MULTIMODAL_EXTRACT' && !Number.isInteger(question.sourcePage)) {
            issues.push(
                createIssue(
                    questionNumber,
                    'Multimodal question is missing source page evidence',
                    'EVIDENCE',
                    'ERROR',
                    'MISSING_SOURCE_PAGE',
                ),
            )
            invalidQuestionNumbers.add(questionNumber)
        }

        if (question.extractionMode && question.extractionMode !== 'GENERATE_FROM_SOURCE' && !question.answerSource) {
            issues.push(
                createIssue(
                    questionNumber,
                    'Question has no answer provenance attached',
                    'EVIDENCE',
                    'ERROR',
                    'MISSING_ANSWER_SOURCE',
                ),
            )
            invalidQuestionNumbers.add(questionNumber)
        }

        if (normalizeSharedContextText(question.sharedContext) && !normalizeWhitespace(question.sharedContextEvidence)) {
            issues.push(
                createIssue(
                    questionNumber,
                    'Question has shared context but no shared-context evidence attached',
                    'EVIDENCE',
                    'ERROR',
                    'MISSING_SHARED_CONTEXT_EVIDENCE',
                ),
            )
            invalidQuestionNumbers.add(questionNumber)
        }

        if (typeof question.confidence === 'number' && question.confidence < LOW_CONFIDENCE_THRESHOLD) {
            issues.push(
                createIssue(
                    questionNumber,
                    `Question confidence is low (${question.confidence.toFixed(2)})`,
                    'EVIDENCE',
                    'WARNING',
                    'LOW_CONFIDENCE',
                ),
            )
            invalidQuestionNumbers.add(questionNumber)
        }

        if (referenceKind !== 'NONE' && !referenceMode) {
            issues.push(
                createIssue(
                    questionNumber,
                    `Question reference kind ${referenceKind} has no representation mode`,
                    'EVIDENCE',
                    'ERROR',
                    'MISSING_REFERENCE_MODE',
                ),
            )
            invalidQuestionNumbers.add(questionNumber)
        }

        if (referenceKind === 'NONE' && hasSharedContext) {
            issues.push(
                createIssue(
                    questionNumber,
                    'Question carries shared reference content but is not classified with a reference kind',
                    'EVIDENCE',
                    'WARNING',
                    'UNCLASSIFIED_REFERENCE',
                ),
            )
        }

        if (
            referenceKind !== 'NONE'
            && isTextBackedReferenceKind(referenceKind)
            && !hasSharedContext
        ) {
            issues.push(
                createIssue(
                    questionNumber,
                    `Question reference kind ${referenceKind} requires attached shared context`,
                    'EVIDENCE',
                    'ERROR',
                    'MISSING_REFERENCE_ATTACHMENT',
                ),
            )
            invalidQuestionNumbers.add(questionNumber)
        }

        if (
            referenceKind !== 'NONE'
            && referenceMode === 'SNAPSHOT'
            && isTextBackedReferenceKind(referenceKind)
        ) {
            issues.push(
                createIssue(
                    questionNumber,
                    `Question reference kind ${referenceKind} should not rely on snapshot-only mode`,
                    'EVIDENCE',
                    'WARNING',
                    'REFERENCE_MODE_MISMATCH',
                ),
            )
        }

        if (isVisualReferenceKind(referenceKind)) {
            if (!hasVisualEvidence) {
                issues.push(
                    createIssue(
                        questionNumber,
                        `Question reference kind ${referenceKind} is missing any usable visual evidence`,
                        'EVIDENCE',
                        'WARNING',
                        'MISSING_VISUAL_REFERENCE',
                    ),
                )
            } else if (referenceMode !== 'SNAPSHOT' && referenceMode !== 'HYBRID') {
                issues.push(
                    createIssue(
                        questionNumber,
                        `Question reference kind ${referenceKind} should use snapshot-capable mode`,
                        'EVIDENCE',
                        'WARNING',
                        'VISUAL_REFERENCE_MODE_MISMATCH',
                    ),
                )
            }

            if (referenceMode === 'SNAPSHOT' && !hasSharedContext) {
                issues.push(
                    createIssue(
                        questionNumber,
                        'Visual reference is present but not yet attached as dedicated shared context',
                        'EVIDENCE',
                        'WARNING',
                        'SNAPSHOT_REFERENCE_PENDING',
                    ),
                )
            }
        }
    }

    return { issues, invalidQuestionNumbers }
}

function compareStemSets(leftQuestions: GeneratedQuestion[], rightQuestions: GeneratedQuestion[]) {
    const leftKeys = leftQuestions
        .map((question) => normalizeStemKey(question.stem).slice(0, 160))
        .filter(Boolean)
    const rightSet = new Set(
        rightQuestions
            .map((question) => normalizeStemKey(question.stem).slice(0, 160))
            .filter(Boolean),
    )

    if (leftKeys.length === 0 || rightSet.size === 0) {
        return 0
    }

    let overlap = 0
    for (const key of leftKeys) {
        if (rightSet.has(key)) {
            overlap += 1
        }
    }

    return overlap / Math.max(leftKeys.length, rightSet.size)
}

function verifyCrossIssues(
    validatedQuestions: Array<GeneratedQuestion | null>,
    context: VerificationContext | undefined,
) {
    const issues: VerificationIssue[] = []
    const concreteQuestions = validatedQuestions.filter((question): question is GeneratedQuestion => Boolean(question))

    if (concreteQuestions.length >= MIN_QUESTIONS_FOR_SKEW_CHECK) {
        const answerCounts = new Map<string, number>()
        for (const question of concreteQuestions) {
            const correctOptionId = getCorrectOptionId(question)
            if (!correctOptionId) continue
            answerCounts.set(correctOptionId, (answerCounts.get(correctOptionId) ?? 0) + 1)
        }

        const dominant = [...answerCounts.entries()].sort((left, right) => right[1] - left[1])[0]
        if (dominant && dominant[1] / concreteQuestions.length >= SUSPICIOUS_ANSWER_SKEW_THRESHOLD) {
            issues.push(
                createIssue(
                    0,
                    `Correct-answer distribution is unusually skewed toward option ${dominant[0]} (${dominant[1]}/${concreteQuestions.length})`,
                    'CROSS',
                    'WARNING',
                    'ANSWER_SKEW',
                ),
            )
        }
    }

    if (context?.extractionAnalysis?.expectedQuestionCount !== null && context?.extractionAnalysis?.expectedQuestionCount !== undefined) {
        const expectedCount = context.extractionAnalysis.expectedQuestionCount
        if (Math.abs(concreteQuestions.length - expectedCount) > CROSS_VERIFIER_COUNT_DELTA) {
            issues.push(
                createIssue(
                    0,
                    `Cross-check mismatch: extracted set has ${concreteQuestions.length} questions but parser expected ${expectedCount}`,
                    'CROSS',
                    'ERROR',
                    'PARSER_EXPECTATION_MISMATCH',
                ),
            )
        }
    }

    if (context?.comparisonQuestions && context.comparisonQuestions.length > 0) {
        const overlapRatio = compareStemSets(concreteQuestions, context.comparisonQuestions)
        if (
            Math.abs(concreteQuestions.length - context.comparisonQuestions.length) > CROSS_VERIFIER_COUNT_DELTA
            || overlapRatio < CROSS_VERIFIER_OVERLAP_THRESHOLD
        ) {
            issues.push(
                createIssue(
                    0,
                    `Cross-check mismatch: parser and secondary extraction disagree (stem overlap ${(overlapRatio * 100).toFixed(0)}%)`,
                    'CROSS',
                    'ERROR',
                    'SECONDARY_EXTRACTION_DISAGREEMENT',
                ),
            )
        }
    }

    return issues
}

export function verifyExtractedQuestionsV2(
    questions: GeneratedQuestion[],
    expectedCount: number | null,
    normalizeQuestion: NormalizeQuestionFn,
    context?: VerificationContext,
): VerificationResult {
    const validatedQuestions = questions.map((question) => normalizeQuestion(question))
    const structural = verifyStructuralIssues(questions, validatedQuestions, expectedCount, context)
    const evidence = verifyEvidenceIssues(validatedQuestions)
    const cross = verifyCrossIssues(validatedQuestions, context)

    const invalidQuestionNumbers = new Set<number>([
        ...structural.invalidQuestionNumbers,
        ...evidence.invalidQuestionNumbers,
    ])

    const issues = [...structural.issues, ...evidence.issues, ...cross]
    const issueSummary = buildIssueSummary(issues)
    return {
        totalQuestions: questions.length,
        validQuestions: questions.length - invalidQuestionNumbers.size,
        issues,
        passed: issueSummary.errors === 0,
        reviewRecommended: issues.length > 0,
        issueSummary,
    }
}

export function resolveImportVerificationOutcome(
    verification: VerificationResult | null | undefined,
): ImportVerificationOutcome {
    if (!verification) {
        return {
            decision: 'EXACT_ACCEPTED',
            message: null,
            errorCount: 0,
            warningCount: 0,
        }
    }

    const issueSummary = verification.issueSummary ?? buildIssueSummary(verification.issues)
    if (issueSummary.errors > 0) {
        return {
            decision: 'FAILED_WITH_REASON',
            message: buildVerificationOutcomeMessage(verification.issues, 'ERROR'),
            errorCount: issueSummary.errors,
            warningCount: issueSummary.warnings,
        }
    }

    if (issueSummary.warnings > 0 || verification.reviewRecommended) {
        return {
            decision: 'REVIEW_REQUIRED',
            message: buildVerificationOutcomeMessage(verification.issues, 'WARNING'),
            errorCount: issueSummary.errors,
            warningCount: issueSummary.warnings,
        }
    }

    return {
        decision: 'EXACT_ACCEPTED',
        message: null,
        errorCount: issueSummary.errors,
        warningCount: issueSummary.warnings,
    }
}

export function mergeAIVerificationIssues(
    codeVerification: VerificationResult,
    aiVerification: AIVerificationResult,
): VerificationResult {
    if (aiVerification.issues.length === 0) {
        return codeVerification
    }

    // Deduplicate: skip AI issues where code already flagged the same question + category
    const existingKeys = new Set(codeVerification.issues.map(buildIssueMergeKey))

    const newAIIssues = aiVerification.issues.filter(issue => {
        const key = buildIssueMergeKey(issue)
        return !existingKeys.has(key)
    })

    if (newAIIssues.length === 0) {
        return codeVerification
    }

    const mergedIssues = [...codeVerification.issues, ...newAIIssues]
    const issueSummary = buildIssueSummary(mergedIssues)

    return {
        totalQuestions: codeVerification.totalQuestions,
        validQuestions: codeVerification.validQuestions,
        issues: mergedIssues,
        passed: issueSummary.errors === 0,
        reviewRecommended: mergedIssues.length > 0,
        issueSummary,
    }
}
