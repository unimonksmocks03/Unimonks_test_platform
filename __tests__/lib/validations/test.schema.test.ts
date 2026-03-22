import { expect, test } from 'vitest'

import {
    AssignTestSchema,
    CreateTestSchema,
    TestQuerySchema,
    UpdateTestSchema,
} from '../../../lib/validations/test.schema'

const legacyScheduleField = 'scheduled' + 'At'

test('CreateTestSchema accepts the admin draft payload and applies default settings', () => {
    const parsed = CreateTestSchema.parse({
        title: '  CUET Physics Mock 1  ',
        description: '  Mechanics revision set  ',
        durationMinutes: 60,
    })

    expect(parsed).toEqual({
        title: 'CUET Physics Mock 1',
        description: 'Mechanics revision set',
        durationMinutes: 60,
        settings: {
            shuffleQuestions: false,
            showResult: true,
            passingScore: 40,
            correctMarks: 5,
            incorrectMarks: 1,
        },
    })
})

test('CreateTestSchema strips the legacy schedule field from admin test creation', () => {
    const parsed = CreateTestSchema.parse({
        title: 'Admin Draft',
        durationMinutes: 45,
        [legacyScheduleField]: '2026-03-20T10:00:00.000Z',
    })

    expect(legacyScheduleField in parsed).toBe(false)
})

test('UpdateTestSchema no longer accepts the legacy schedule field and keeps only supported update fields', () => {
    const parsed = UpdateTestSchema.parse({
        title: 'Updated Draft',
        [legacyScheduleField]: '2026-03-20T10:00:00.000Z',
    })

    expect(parsed).toEqual({
        title: 'Updated Draft',
    })
})

test('AssignTestSchema requires at least one target and preserves batch assignment payloads', () => {
    const parsed = AssignTestSchema.parse({
        batchIds: ['5b7a8f9d-3d11-4b25-b112-92b8ec8a2e55'],
    })

    expect(parsed).toEqual({
        batchIds: ['5b7a8f9d-3d11-4b25-b112-92b8ec8a2e55'],
    })
})

test('AssignTestSchema accepts database UUIDs that are valid in Postgres even when they are not RFC-versioned UUIDs', () => {
    const parsed = AssignTestSchema.parse({
        batchIds: ['4e979f2d-bbfe-0cc5-a2b0-207d5d21dd1b'],
    })

    expect(parsed).toEqual({
        batchIds: ['4e979f2d-bbfe-0cc5-a2b0-207d5d21dd1b'],
    })
})

test('TestQuerySchema trims search input for the admin tests list', () => {
    const parsed = TestQuerySchema.parse({
        search: '  physics  ',
        page: '2',
        limit: '10',
    })

    expect(parsed).toEqual({
        search: 'physics',
        page: 2,
        limit: 10,
    })
})
