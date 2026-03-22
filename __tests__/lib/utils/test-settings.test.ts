import { expect, test } from 'vitest'

import {
    calculateQuestionAttemptSummary,
    resolveTestSettings,
} from '../../../lib/utils/test-settings'

test('resolveTestSettings falls back to CUET defaults', () => {
    expect(resolveTestSettings(undefined)).toEqual({
        shuffleQuestions: false,
        showResult: true,
        passingScore: 40,
        correctMarks: 5,
        incorrectMarks: 1,
    })
})

test('calculateQuestionAttemptSummary applies +5 and -1 scoring', () => {
    const result = calculateQuestionAttemptSummary([
        {
            id: 'q1',
            options: [
                { id: 'A', isCorrect: false },
                { id: 'B', isCorrect: true },
                { id: 'C', isCorrect: false },
                { id: 'D', isCorrect: false },
            ],
        },
        {
            id: 'q2',
            options: [
                { id: 'A', isCorrect: true },
                { id: 'B', isCorrect: false },
                { id: 'C', isCorrect: false },
                { id: 'D', isCorrect: false },
            ],
        },
        {
            id: 'q3',
            options: [
                { id: 'A', isCorrect: false },
                { id: 'B', isCorrect: false },
                { id: 'C', isCorrect: true },
                { id: 'D', isCorrect: false },
            ],
        },
        {
            id: 'q4',
            options: [
                { id: 'A', isCorrect: false },
                { id: 'B', isCorrect: false },
                { id: 'C', isCorrect: false },
                { id: 'D', isCorrect: true },
            ],
        },
    ], [
        { questionId: 'q1', optionId: 'B' },
        { questionId: 'q2', optionId: 'A' },
        { questionId: 'q3', optionId: 'A' },
        { questionId: 'q4', optionId: null },
    ], undefined)

    expect(result).toMatchObject({
        correctCount: 2,
        incorrectCount: 1,
        unansweredCount: 1,
        score: 9,
        totalMarks: 20,
        percentage: 45,
    })
})
