import { expect, test } from 'vitest'

import {
    mergeAIVerificationIssues,
    resolveImportVerificationOutcome,
    verifyExtractedQuestionsV2,
} from '@/lib/services/import-verifier'
import type { GeneratedQuestion } from '@/lib/services/ai-service.types'

function createQuestion(overrides: Partial<GeneratedQuestion> = {}): GeneratedQuestion {
    return {
        stem: 'Question stem',
        options: [
            { id: 'A', text: 'Option A', isCorrect: true },
            { id: 'B', text: 'Option B', isCorrect: false },
            { id: 'C', text: 'Option C', isCorrect: false },
            { id: 'D', text: 'Option D', isCorrect: false },
        ],
        explanation: 'Explanation',
        difficulty: 'MEDIUM',
        topic: 'General',
        sharedContext: null,
        sourcePage: 1,
        sourceSnippet: 'Question stem source',
        answerSource: 'ANSWER_KEY',
        confidence: 0.9,
        sharedContextEvidence: null,
        extractionMode: 'TEXT_EXACT',
        referenceKind: 'NONE',
        referenceMode: 'TEXT',
        referenceTitle: null,
        ...overrides,
    }
}

function normalizeQuestion(question: Partial<GeneratedQuestion> | null | undefined) {
    return question as GeneratedQuestion
}

test('mergeAIVerificationIssues keeps AI issues even when the AI verifier partially failed', () => {
    const codeVerification = {
        totalQuestions: 20,
        validQuestions: 20,
        issues: [] as Array<{
            questionNumber: number
            issue: string
            category: 'STRUCTURAL' | 'EVIDENCE' | 'CROSS'
            severity: 'ERROR' | 'WARNING'
            code?: string
        }>,
        passed: true,
        reviewRecommended: false,
        issueSummary: {
            structural: 0,
            evidence: 0,
            cross: 0,
            errors: 0,
            warnings: 0,
        },
    }

    const aiVerification = {
        issues: [
            {
                questionNumber: 16,
                issue: 'Shared context looks incomplete.',
                category: 'CROSS' as const,
                severity: 'WARNING' as const,
                code: 'AI_CHECK_MISSING_CONTEXT',
            },
        ],
        overallAssessment: 'Partial failure after one useful finding.',
        confidence: 0.3,
        error: true,
        message: 'Second batch timed out.',
    }

    const merged = mergeAIVerificationIssues(codeVerification, aiVerification)

    expect(merged.issues).toHaveLength(1)
    expect(merged.issues[0]?.questionNumber).toBe(16)
    expect(merged.reviewRecommended).toBe(true)
    expect(merged.issueSummary?.cross).toBe(1)
})

test('mergeAIVerificationIssues keeps distinct AI issues for the same question and category', () => {
    const codeVerification = {
        totalQuestions: 2,
        validQuestions: 2,
        issues: [] as Array<{
            questionNumber: number
            issue: string
            category: 'STRUCTURAL' | 'EVIDENCE' | 'CROSS'
            severity: 'ERROR' | 'WARNING'
            code?: string
        }>,
        passed: true,
        reviewRecommended: false,
        issueSummary: {
            structural: 0,
            evidence: 0,
            cross: 0,
            errors: 0,
            warnings: 0,
        },
    }

    const aiVerification = {
        issues: [
            {
                questionNumber: 1,
                issue: 'Stem is ambiguous.',
                category: 'CROSS' as const,
                severity: 'WARNING' as const,
                code: 'AI_STEM_AMBIGUOUS',
            },
            {
                questionNumber: 1,
                issue: 'Answer explanation is weak.',
                category: 'CROSS' as const,
                severity: 'WARNING' as const,
                code: 'AI_EXPLANATION_WEAK',
            },
        ],
        overallAssessment: 'Two distinct concerns detected.',
        confidence: 0.61,
        error: false,
    }

    const merged = mergeAIVerificationIssues(codeVerification, aiVerification)

    expect(merged.issues).toHaveLength(2)
    expect(merged.issueSummary?.cross).toBe(2)
    expect(merged.reviewRecommended).toBe(true)
})

test('resolveImportVerificationOutcome returns EXACT_ACCEPTED for clean verification', () => {
    const outcome = resolveImportVerificationOutcome({
        totalQuestions: 10,
        validQuestions: 10,
        issues: [],
        passed: true,
        reviewRecommended: false,
        issueSummary: {
            structural: 0,
            evidence: 0,
            cross: 0,
            errors: 0,
            warnings: 0,
        },
    })

    expect(outcome.decision).toBe('EXACT_ACCEPTED')
    expect(outcome.message).toBeNull()
})

test('resolveImportVerificationOutcome returns REVIEW_REQUIRED for warning-only verification', () => {
    const outcome = resolveImportVerificationOutcome({
        totalQuestions: 10,
        validQuestions: 10,
        issues: [
            {
                questionNumber: 4,
                issue: 'Question confidence is low (0.42)',
                category: 'EVIDENCE',
                severity: 'WARNING',
                code: 'LOW_CONFIDENCE',
            },
        ],
        passed: true,
        reviewRecommended: true,
        issueSummary: {
            structural: 0,
            evidence: 1,
            cross: 0,
            errors: 0,
            warnings: 1,
        },
    })

    expect(outcome.decision).toBe('REVIEW_REQUIRED')
    expect(outcome.message).toContain('Q4:')
})

test('resolveImportVerificationOutcome returns FAILED_WITH_REASON for error verification', () => {
    const outcome = resolveImportVerificationOutcome({
        totalQuestions: 10,
        validQuestions: 8,
        issues: [
            {
                questionNumber: 0,
                issue: 'Missing numbered questions: 9, 10',
                category: 'STRUCTURAL',
                severity: 'ERROR',
                code: 'NUMBERING_GAP',
            },
        ],
        passed: false,
        reviewRecommended: true,
        issueSummary: {
            structural: 1,
            evidence: 0,
            cross: 0,
            errors: 1,
            warnings: 0,
        },
    })

    expect(outcome.decision).toBe('FAILED_WITH_REASON')
    expect(outcome.message).toContain('Missing numbered questions')
})

test('resolveImportVerificationOutcome returns REVIEW_REQUIRED for evidence-only errors', () => {
    const outcome = resolveImportVerificationOutcome({
        totalQuestions: 10,
        validQuestions: 9,
        issues: [
            {
                questionNumber: 4,
                issue: 'Question reference kind TABLE requires attached shared context',
                category: 'EVIDENCE',
                severity: 'ERROR',
                code: 'MISSING_REFERENCE_ATTACHMENT',
            },
        ],
        passed: false,
        reviewRecommended: true,
        issueSummary: {
            structural: 0,
            evidence: 1,
            cross: 0,
            errors: 1,
            warnings: 0,
        },
    })

    expect(outcome.decision).toBe('REVIEW_REQUIRED')
    expect(outcome.message).toContain('Q4:')
})

test('verifyExtractedQuestionsV2 downgrades missing audit evidence to warnings', () => {
    const verification = verifyExtractedQuestionsV2(
        [
            createQuestion({
                stem: 'Based on the following table, what is the correct answer?',
                sharedContext: null,
                sourcePage: null,
                sourceSnippet: null,
                answerSource: null,
                sharedContextEvidence: null,
                extractionMode: 'MULTIMODAL_EXTRACT',
                referenceKind: 'NONE',
                referenceMode: 'TEXT',
            }),
        ],
        1,
        normalizeQuestion,
    )

    expect(verification.passed).toBe(true)
    expect(verification.validQuestions).toBe(1)
    expect(verification.issues.some((issue) => issue.code === 'MISSING_SHARED_CONTEXT' && issue.severity === 'WARNING')).toBe(true)
    expect(verification.issues.some((issue) => issue.code === 'MISSING_SOURCE_SNIPPET' && issue.severity === 'WARNING')).toBe(true)
    expect(verification.issues.some((issue) => issue.code === 'MISSING_SOURCE_PAGE' && issue.severity === 'WARNING')).toBe(true)
    expect(verification.issues.some((issue) => issue.code === 'MISSING_ANSWER_SOURCE' && issue.severity === 'WARNING')).toBe(true)
})

test('verifyExtractedQuestionsV2 fails when a text-backed reference has no shared context attached', () => {
    const verification = verifyExtractedQuestionsV2(
        [
            createQuestion({
                stem: 'Based on the following table, what is the correct answer?',
                referenceKind: 'TABLE',
                referenceMode: 'TEXT',
                sharedContext: null,
                sharedContextEvidence: null,
            }),
        ],
        1,
        normalizeQuestion,
    )

    expect(verification.passed).toBe(false)
    expect(verification.issues.some((issue) => issue.code === 'MISSING_REFERENCE_ATTACHMENT')).toBe(true)
})

test('verifyExtractedQuestionsV2 ignores stale numbering diagnostics when exact recovery succeeded', () => {
    const verification = verifyExtractedQuestionsV2(
        [createQuestion({ stem: 'Recovered question 1' })],
        1,
        normalizeQuestion,
        {
            extractionAnalysis: {
                expectedQuestionCount: 1,
                exactMatchAchieved: true,
                missingQuestionNumbers: [1],
                duplicateQuestionNumbers: [1],
                invalidQuestionNumbers: [1],
                questions: [createQuestion({ stem: 'Recovered question 1' })],
            },
        },
    )

    expect(verification.passed).toBe(true)
    expect(verification.issues.some((issue) => issue.code === 'NUMBERING_DUPLICATE')).toBe(false)
    expect(verification.issues.some((issue) => issue.code === 'NUMBERING_GAP')).toBe(false)
    expect(verification.issues.some((issue) => issue.code === 'NUMBERING_INVALID')).toBe(false)
})

test('verifyExtractedQuestionsV2 warns when visual references are still text-backed only', () => {
    const verification = verifyExtractedQuestionsV2(
        [
            createQuestion({
                stem: 'Find the missing figure.',
                referenceKind: 'DIAGRAM',
                referenceMode: 'SNAPSHOT',
                sharedContext: null,
                sharedContextEvidence: 'Figure with alternating triangles and circles.',
                sourceSnippet: 'Find the missing figure in the pattern.',
            }),
        ],
        1,
        normalizeQuestion,
    )

    expect(verification.passed).toBe(true)
    expect(verification.reviewRecommended).toBe(true)
    expect(verification.issues.some((issue) => issue.code === 'SNAPSHOT_REFERENCE_PENDING')).toBe(true)
})

test('verifyExtractedQuestionsV2 warns when a diagram question has no usable visual evidence yet', () => {
    const verification = verifyExtractedQuestionsV2(
        [
            createQuestion({
                stem: 'Find the missing figure.',
                referenceKind: 'DIAGRAM',
                referenceMode: 'SNAPSHOT',
                sharedContext: null,
                sharedContextEvidence: null,
                sourceSnippet: 'Question stem source',
            }),
        ],
        1,
        normalizeQuestion,
    )

    expect(verification.passed).toBe(true)
    expect(verification.reviewRecommended).toBe(true)
    expect(verification.issues.some((issue) => issue.code === 'MISSING_VISUAL_REFERENCE')).toBe(true)
})

test('verifyExtractedQuestionsV2 warns when shared context exists but reference kind was never classified', () => {
    const verification = verifyExtractedQuestionsV2(
        [
            createQuestion({
                sharedContext: 'List I: Author. List II: Work.',
                sharedContextEvidence: 'List I: Author. List II: Work.',
                referenceKind: 'NONE',
                referenceMode: 'TEXT',
            }),
        ],
        1,
        normalizeQuestion,
    )

    expect(verification.passed).toBe(true)
    expect(verification.reviewRecommended).toBe(true)
    expect(verification.issues.some((issue) => issue.code === 'UNCLASSIFIED_REFERENCE')).toBe(true)
})
