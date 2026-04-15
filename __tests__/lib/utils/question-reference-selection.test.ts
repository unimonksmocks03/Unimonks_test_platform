import { expect, test } from 'vitest'

import type { QuestionReferencePayload } from '@/lib/types/question-reference'
import {
    getPreferredVisualReference,
    mergeQuestionReferenceState,
} from '@/lib/utils/question-reference-selection'

function createReference(overrides: Partial<QuestionReferencePayload> = {}): QuestionReferencePayload {
    return {
        id: 'reference-1',
        order: 1,
        kind: 'DIAGRAM',
        mode: 'SNAPSHOT',
        title: 'Figure reference',
        textContent: null,
        assetUrl: null,
        sourcePage: 2,
        bbox: null,
        confidence: 0.92,
        evidence: null,
        ...overrides,
    }
}

test('getPreferredVisualReference prefers an attached image over an older missing-image placeholder', () => {
    const preferred = getPreferredVisualReference([
        createReference({
            id: 'reference-table',
            order: 1,
            kind: 'TABLE',
            mode: 'HYBRID',
            title: 'Data table',
            textContent: 'Cash flow statement',
            assetUrl: null,
        }),
        createReference({
            id: 'reference-image',
            order: 2,
            kind: 'DIAGRAM',
            mode: 'SNAPSHOT',
            title: 'Uploaded diagram',
            assetUrl: 'https://blob.vercel-storage.com/manual-reference.png',
        }),
    ])

    expect(preferred?.id).toBe('reference-image')
})

test('getPreferredVisualReference prefers an explicit visual placeholder over a hybrid table block', () => {
    const preferred = getPreferredVisualReference([
        createReference({
            id: 'reference-table',
            order: 1,
            kind: 'TABLE',
            mode: 'HYBRID',
            title: 'Data table',
            textContent: 'Cash flow statement',
            assetUrl: null,
        }),
        createReference({
            id: 'reference-diagram',
            order: 2,
            kind: 'DIAGRAM',
            mode: 'SNAPSHOT',
            title: 'Question figure',
            assetUrl: null,
        }),
    ])

    expect(preferred?.id).toBe('reference-diagram')
})

test('mergeQuestionReferenceState keeps new server references on the refreshed question', () => {
    const currentSharedReference = createReference({
        id: 'reference-placeholder',
        order: 1,
        kind: 'TABLE',
        mode: 'HYBRID',
        title: 'Data table',
        textContent: 'Cash flow statement',
        assetUrl: null,
    })

    const refreshedSharedReference = createReference({
        ...currentSharedReference,
        textContent: 'Cash flow statement (updated)',
    })

    const newUploadedReference = createReference({
        id: 'reference-image',
        order: 2,
        kind: 'DIAGRAM',
        mode: 'SNAPSHOT',
        title: 'Uploaded diagram',
        assetUrl: 'https://blob.vercel-storage.com/manual-reference.png',
    })

    const currentQuestions = [
        {
            dbId: 'question-1',
            references: [currentSharedReference],
            stem: 'Question 1',
        },
        {
            dbId: 'question-2',
            references: [currentSharedReference],
            stem: 'Question 2',
        },
    ]

    const merged = mergeQuestionReferenceState(currentQuestions, {
        dbId: 'question-1',
        references: [refreshedSharedReference, newUploadedReference],
        stem: 'Question 1',
    })

    expect(merged[0]?.references).toEqual([refreshedSharedReference, newUploadedReference])
    expect(merged[1]?.references).toEqual([refreshedSharedReference])
})
