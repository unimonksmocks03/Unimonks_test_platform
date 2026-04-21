import { expect, test } from 'vitest'

import {
    applySessionQuestionOrder,
    shuffleArrayDeterministic,
} from '../../../lib/utils/session-question-order'

test('shuffleArrayDeterministic is stable for the same seed', () => {
    const input = ['q1', 'q2', 'q3', 'q4']

    expect(shuffleArrayDeterministic(input, 'session-1')).toEqual(
        shuffleArrayDeterministic(input, 'session-1'),
    )
    expect(shuffleArrayDeterministic(input, 'session-1')).not.toEqual(
        shuffleArrayDeterministic(input, 'session-2'),
    )
})

test('applySessionQuestionOrder keeps sorted order when shuffle is disabled', () => {
    const ordered = applySessionQuestionOrder([
        { id: 'q-2', order: 2 },
        { id: 'q-1', order: 1 },
    ], { shuffleQuestions: false }, 'session-1')

    expect(ordered.map((question) => question.id)).toEqual(['q-1', 'q-2'])
    expect(ordered.map((question) => question.order)).toEqual([1, 2])
})

test('applySessionQuestionOrder shuffles deterministically and renumbers order', () => {
    const first = applySessionQuestionOrder([
        { id: 'q-1', order: 1 },
        { id: 'q-2', order: 2 },
        { id: 'q-3', order: 3 },
        { id: 'q-4', order: 4 },
    ], { shuffleQuestions: true }, 'session-1')

    const second = applySessionQuestionOrder([
        { id: 'q-1', order: 1 },
        { id: 'q-2', order: 2 },
        { id: 'q-3', order: 3 },
        { id: 'q-4', order: 4 },
    ], { shuffleQuestions: true }, 'session-1')

    expect(first).toEqual(second)
    expect(first.map((question) => question.order)).toEqual([1, 2, 3, 4])
})
