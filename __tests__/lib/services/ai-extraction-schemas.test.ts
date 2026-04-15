import { expect, test } from 'vitest'

import {
    McqExtractionResponseSchema,
    McqQuestionSchema,
    VerificationResultSchema,
} from '../../../lib/services/ai-extraction-schemas'

test('McqQuestionSchema accepts a valid MCQ question', () => {
    const valid = {
        stem: 'What is the SI unit of electric charge?',
        options: [
            { id: 'A', text: 'Ampere', isCorrect: false },
            { id: 'B', text: 'Volt', isCorrect: false },
            { id: 'C', text: 'Coulomb', isCorrect: true },
            { id: 'D', text: 'Farad', isCorrect: false },
        ],
        explanation: 'The SI unit of electric charge is the coulomb.',
        difficulty: 'EASY',
        topic: 'Units',
        sharedContext: 'Reference table: base units and derived units.',
    }

    expect(McqQuestionSchema.safeParse(valid).success).toBe(true)
})

test('McqQuestionSchema accepts question batches with 3 options so one malformed item does not reject the whole response', () => {
    const partiallyValid = {
        stem: 'Some question?',
        options: [
            { id: 'A', text: 'Opt A', isCorrect: false },
            { id: 'B', text: 'Opt B', isCorrect: true },
            { id: 'C', text: 'Opt C', isCorrect: false },
        ],
        difficulty: 'EASY',
        topic: 'Test',
    }

    expect(McqQuestionSchema.safeParse(partiallyValid).success).toBe(true)
})

test('McqQuestionSchema rejects empty stem', () => {
    const invalid = {
        stem: '',
        options: [
            { id: 'A', text: 'A', isCorrect: false },
            { id: 'B', text: 'B', isCorrect: true },
            { id: 'C', text: 'C', isCorrect: false },
            { id: 'D', text: 'D', isCorrect: false },
        ],
        explanation: 'Reason',
        difficulty: 'MEDIUM',
        topic: 'Test',
    }

    expect(McqQuestionSchema.safeParse(invalid).success).toBe(false)
})

test('McqQuestionSchema rejects invalid difficulty', () => {
    const invalid = {
        stem: 'Valid stem here?',
        options: [
            { id: 'A', text: 'A', isCorrect: false },
            { id: 'B', text: 'B', isCorrect: true },
            { id: 'C', text: 'C', isCorrect: false },
            { id: 'D', text: 'D', isCorrect: false },
        ],
        explanation: 'Reason',
        difficulty: 'SUPER_HARD',
        topic: 'Test',
    }

    expect(McqQuestionSchema.safeParse(invalid).success).toBe(false)
})

test('McqExtractionResponseSchema accepts a valid extraction response', () => {
    const valid = {
        questions: [
            {
                stem: 'What is the correct answer?',
                options: [
                    { id: 'A', text: 'Option A', isCorrect: true },
                    { id: 'B', text: 'Option B', isCorrect: false },
                    { id: 'C', text: 'Option C', isCorrect: false },
                    { id: 'D', text: 'Option D', isCorrect: false },
                ],
                explanation: 'Option A is correct for this sample question.',
                difficulty: 'HARD',
                topic: 'Sample Topic',
            },
        ],
    }

    expect(McqExtractionResponseSchema.safeParse(valid).success).toBe(true)
})

test('McqQuestionSchema fills optional explanation and difficulty defaults', () => {
    const parsed = McqQuestionSchema.parse({
        stem: 'Which option is correct?',
        options: [
            { id: 'A', text: 'Option A', isCorrect: false },
            { id: 'B', text: 'Option B', isCorrect: true },
        ],
        topic: 'General Aptitude',
    })

    expect(parsed.explanation).toBe('')
    expect(parsed.difficulty).toBe('MEDIUM')
})

test('VerificationResultSchema accepts a valid verifier result', () => {
    const valid = {
        totalQuestions: 50,
        validQuestions: 48,
        issues: [
            { questionNumber: 12, issue: 'Two options marked correct', category: 'STRUCTURAL', severity: 'ERROR' },
            { questionNumber: 37, issue: 'Missing option D', category: 'EVIDENCE', severity: 'WARNING' },
        ],
        passed: false,
        issueSummary: {
            structural: 1,
            evidence: 1,
            cross: 0,
            errors: 1,
            warnings: 1,
        },
    }

    expect(VerificationResultSchema.safeParse(valid).success).toBe(true)
})
