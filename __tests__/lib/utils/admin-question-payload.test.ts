import { expect, test } from 'vitest'

import {
    buildAdminQuestionCreatePayload,
    buildAdminQuestionUpdatePayload,
} from '../../../lib/utils/admin-question-payload'

const baseQuestion = {
    stem: '  Ratio analysis question  ',
    sharedContext: '  Shared ratio table  ',
    options: [
        { id: 'A', text: '  Option A  ', isCorrect: true },
        { id: 'B', text: ' Option B ', isCorrect: false },
        { id: 'C', text: ' Option C ', isCorrect: false },
        { id: 'D', text: ' Option D ', isCorrect: false },
    ],
    difficulty: 'MEDIUM' as const,
    topic: '  Ratios  ',
    explanation: '  Because this is the correct ratio.  ',
}

test('buildAdminQuestionCreatePayload omits cleared optional fields', () => {
    expect(buildAdminQuestionCreatePayload({
        ...baseQuestion,
        sharedContext: '   ',
        topic: '   ',
        explanation: '   ',
    })).toEqual({
        stem: 'Ratio analysis question',
        sharedContext: undefined,
        options: [
            { id: 'A', text: 'Option A', isCorrect: true },
            { id: 'B', text: 'Option B', isCorrect: false },
            { id: 'C', text: 'Option C', isCorrect: false },
            { id: 'D', text: 'Option D', isCorrect: false },
        ],
        difficulty: 'MEDIUM',
        topic: undefined,
        explanation: undefined,
    })
})

test('buildAdminQuestionUpdatePayload sends null when optional fields are cleared', () => {
    expect(buildAdminQuestionUpdatePayload({
        ...baseQuestion,
        sharedContext: '   ',
        topic: '   ',
        explanation: '   ',
    })).toEqual({
        stem: 'Ratio analysis question',
        sharedContext: null,
        options: [
            { id: 'A', text: 'Option A', isCorrect: true },
            { id: 'B', text: 'Option B', isCorrect: false },
            { id: 'C', text: 'Option C', isCorrect: false },
            { id: 'D', text: 'Option D', isCorrect: false },
        ],
        difficulty: 'MEDIUM',
        topic: null,
        explanation: null,
    })
})
