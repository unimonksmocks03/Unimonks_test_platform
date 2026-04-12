import { expect, test } from 'vitest'

import { mergeAIVerificationIssues } from '@/lib/services/import-verifier'

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
