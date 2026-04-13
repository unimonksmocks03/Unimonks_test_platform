import { expect, test } from 'vitest'

import {
    mergeAIVerificationIssues,
    resolveImportVerificationOutcome,
} from '@/lib/services/import-verifier'

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
