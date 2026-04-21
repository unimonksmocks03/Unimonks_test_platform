import { expect, test } from 'vitest'

import {
    buildSessionTestSnapshot,
    parseSessionTestSnapshot,
} from '../../../lib/utils/test-session-snapshot'

test('buildSessionTestSnapshot sanitizes shared context and maps references', () => {
    const snapshot = buildSessionTestSnapshot({
        title: 'Ratios Test',
        description: 'Accounting chapter',
        durationMinutes: 60,
        settings: {
            shuffleQuestions: true,
        },
        questions: [
            {
                id: 'q-1',
                order: 1,
                stem: 'Question stem',
                sharedContext: '  Shared context  ',
                options: [
                    { id: 'A', text: 'Option A', isCorrect: true },
                    { id: 'B', text: 'Option B', isCorrect: false },
                ],
                difficulty: 'MEDIUM',
                topic: 'Ratios',
                explanation: 'Because it matches the definition.',
                referenceLinks: [
                    {
                        order: 1,
                        reference: {
                            id: 'ref-1',
                            kind: 'TABLE',
                            mode: 'TEXT',
                            title: '  Ratio table  ',
                            textContent: '  Working capital  ',
                            assetUrl: null,
                            sourcePage: 2,
                            bbox: null,
                            confidence: 0.98,
                            evidence: null,
                        },
                    },
                ],
            },
        ],
    })

    expect(snapshot.questions[0].sharedContext).toBe('Shared context')
    expect(snapshot.questions[0].references).toEqual([
        expect.objectContaining({
            id: 'ref-1',
            title: 'Ratio table',
            textContent: 'Working capital',
        }),
    ])
})

test('parseSessionTestSnapshot rejects malformed payloads and parses valid ones', () => {
    expect(parseSessionTestSnapshot({ title: 'Bad payload' })).toBeNull()

    expect(parseSessionTestSnapshot({
        title: 'Snapshot title',
        description: null,
        durationMinutes: 75,
        settings: { shuffleQuestions: false },
        questions: [
            {
                id: 'q-1',
                order: 1,
                stem: 'Question',
                sharedContext: null,
                options: [],
                difficulty: 'EASY',
                topic: null,
                explanation: null,
                references: [],
            },
        ],
    })).toEqual({
        title: 'Snapshot title',
        description: null,
        durationMinutes: 75,
        settings: { shuffleQuestions: false },
        questions: [
            {
                id: 'q-1',
                order: 1,
                stem: 'Question',
                sharedContext: null,
                options: [],
                difficulty: 'EASY',
                topic: null,
                explanation: null,
                references: [],
            },
        ],
    })
})
