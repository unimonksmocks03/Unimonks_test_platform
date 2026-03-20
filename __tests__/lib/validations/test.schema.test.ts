import { expect, test } from 'vitest'

import {
    AssignTestSchema,
    CreateTestSchema,
    TestQuerySchema,
    UpdateTestSchema,
} from '../../../lib/validations/test.schema'

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
        },
    })
})

test('CreateTestSchema strips legacy scheduledAt input from admin test creation', () => {
    const parsed = CreateTestSchema.parse({
        title: 'Admin Draft',
        durationMinutes: 45,
        scheduledAt: '2026-03-20T10:00:00.000Z',
    })

    expect('scheduledAt' in parsed).toBe(false)
})

test('UpdateTestSchema no longer accepts scheduledAt and keeps only supported update fields', () => {
    const parsed = UpdateTestSchema.parse({
        title: 'Updated Draft',
        scheduledAt: '2026-03-20T10:00:00.000Z',
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
