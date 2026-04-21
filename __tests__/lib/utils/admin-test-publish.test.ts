import { expect, test } from 'vitest'

import {
    buildPublishedTestUpdatePayload,
    hasPersistablePublishedQuestionChanges,
    hasPublishedBuilderChanges,
} from '../../../lib/utils/admin-test-publish'

test('buildPublishedTestUpdatePayload only includes changed published metadata', () => {
    expect(buildPublishedTestUpdatePayload({
        title: '  Updated title  ',
        savedTitle: 'Original title',
        description: '  ',
        savedDescription: 'Existing description',
        durationMinutes: 90,
        savedDurationMinutes: 60,
        questions: [],
    })).toEqual({
        title: 'Updated title',
        description: null,
        durationMinutes: 90,
    })
})

test('hasPersistablePublishedQuestionChanges ignores empty unsaved shells', () => {
    expect(hasPersistablePublishedQuestionChanges([
        { saved: false, stem: '   ' },
        { saved: true, stem: 'Existing question' },
    ])).toBe(false)

    expect(hasPersistablePublishedQuestionChanges([
        { saved: false, stem: 'Updated live question' },
    ])).toBe(true)
})

test('hasPublishedBuilderChanges returns true for metadata or question edits', () => {
    expect(hasPublishedBuilderChanges({
        title: 'Published title',
        savedTitle: 'Published title',
        description: 'Description',
        savedDescription: 'Description',
        durationMinutes: 60,
        savedDurationMinutes: 60,
        questions: [{ saved: true, stem: 'Saved question' }],
    })).toBe(false)

    expect(hasPublishedBuilderChanges({
        title: 'Published title v2',
        savedTitle: 'Published title',
        description: 'Description',
        savedDescription: 'Description',
        durationMinutes: 60,
        savedDurationMinutes: 60,
        questions: [{ saved: true, stem: 'Saved question' }],
    })).toBe(true)

    expect(hasPublishedBuilderChanges({
        title: 'Published title',
        savedTitle: 'Published title',
        description: 'Description',
        savedDescription: 'Description',
        durationMinutes: 60,
        savedDurationMinutes: 60,
        questions: [{ saved: false, stem: 'Updated question text' }],
    })).toBe(true)
})
