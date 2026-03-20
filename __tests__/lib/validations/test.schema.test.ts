import assert from 'node:assert/strict'
import test from 'node:test'

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

    assert.deepEqual(parsed, {
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

    assert.equal('scheduledAt' in parsed, false)
})

test('UpdateTestSchema no longer accepts scheduledAt and keeps only supported update fields', () => {
    const parsed = UpdateTestSchema.parse({
        title: 'Updated Draft',
        scheduledAt: '2026-03-20T10:00:00.000Z',
    })

    assert.deepEqual(parsed, {
        title: 'Updated Draft',
    })
})

test('AssignTestSchema requires at least one target and preserves batch assignment payloads', () => {
    const parsed = AssignTestSchema.parse({
        batchIds: ['5b7a8f9d-3d11-4b25-b112-92b8ec8a2e55'],
    })

    assert.deepEqual(parsed, {
        batchIds: ['5b7a8f9d-3d11-4b25-b112-92b8ec8a2e55'],
    })
})

test('TestQuerySchema trims search input for the admin tests list', () => {
    const parsed = TestQuerySchema.parse({
        search: '  physics  ',
        page: '2',
        limit: '10',
    })

    assert.deepEqual(parsed, {
        search: 'physics',
        page: 2,
        limit: 10,
    })
})
