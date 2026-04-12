import { describe, expect, test } from 'vitest'

import {
    ALL_TESTS_BATCH_FILTER,
    DIRECT_ASSIGNMENTS_BATCH_FILTER,
    buildStudentBatchCards,
    filterStudentTests,
    matchesStudentTestSearch,
} from '../../../lib/utils/student-dashboard'

const batches = [
    { id: 'batch-2', name: 'Humanities', code: 'HUM-XII' },
    { id: 'batch-1', name: 'Reasoning', code: 'REASON-XII' },
]

const tests = [
    {
        id: 'test-1',
        title: 'Reasoning Number Series',
        assignedBatches: [{ id: 'batch-1', name: 'Reasoning', code: 'REASON-XII' }],
    },
    {
        id: 'test-2',
        title: 'History Mock 1',
        assignedBatches: [{ id: 'batch-2', name: 'Humanities', code: 'HUM-XII' }],
    },
    {
        id: 'test-3',
        title: 'Reasoning Statements',
        assignedBatches: [],
    },
]

describe('matchesStudentTestSearch', () => {
    test('matches titles with normalized spacing and case', () => {
        expect(matchesStudentTestSearch('Reasoning Number Series', 'reasoning')).toBe(true)
        expect(matchesStudentTestSearch('Math-13 Mock', 'math 13')).toBe(true)
        expect(matchesStudentTestSearch('History Mock 1', 'physics')).toBe(false)
    })
})

describe('filterStudentTests', () => {
    test('filters by title and selected batch and sorts alphabetically', () => {
        const filtered = filterStudentTests(tests, 'reasoning', ALL_TESTS_BATCH_FILTER)
        expect(filtered.map((test) => test.title)).toEqual([
            'Reasoning Number Series',
            'Reasoning Statements',
        ])
    })

    test('filters direct assignments separately', () => {
        const filtered = filterStudentTests(tests, '', DIRECT_ASSIGNMENTS_BATCH_FILTER)
        expect(filtered.map((test) => test.id)).toEqual(['test-3'])
    })

    test('filters by batch id', () => {
        const filtered = filterStudentTests(tests, '', 'batch-2')
        expect(filtered.map((test) => test.id)).toEqual(['test-2'])
    })
})

describe('buildStudentBatchCards', () => {
    test('builds all, direct, and batch cards with counts', () => {
        const cards = buildStudentBatchCards(tests, batches)

        expect(cards).toEqual([
            { id: ALL_TESTS_BATCH_FILTER, name: 'All Tests', code: '3 total', count: 3 },
            { id: DIRECT_ASSIGNMENTS_BATCH_FILTER, name: 'Direct Assignments', code: 'PERSONAL', count: 1 },
            { id: 'batch-2', name: 'Humanities', code: 'HUM-XII', count: 1 },
            { id: 'batch-1', name: 'Reasoning', code: 'REASON-XII', count: 1 },
        ])
    })
})
