import { describe, expect, it } from 'vitest'

import { mapQuestionReferences } from '@/lib/utils/question-references'

describe('mapQuestionReferences', () => {
    it('sorts links and preserves reference payload fields', () => {
        const mapped = mapQuestionReferences([
            {
                order: 2,
                reference: {
                    id: 'ref-b',
                    kind: 'DIAGRAM',
                    mode: 'SNAPSHOT',
                    title: 'Figure B',
                    textContent: null,
                    assetUrl: 'https://example.com/b.png',
                    sourcePage: 3,
                    bbox: { x: 20 },
                    confidence: 0.72,
                    evidence: { source: 'visual' },
                },
            },
            {
                order: 1,
                reference: {
                    id: 'ref-a',
                    kind: 'TABLE',
                    mode: 'TEXT',
                    title: 'Table A',
                    textContent: 'Company A 10 20 30',
                    assetUrl: null,
                    sourcePage: 2,
                    bbox: null,
                    confidence: 0.95,
                    evidence: { source: 'text' },
                },
            },
        ])

        expect(mapped).toEqual([
            {
                id: 'ref-a',
                order: 1,
                kind: 'TABLE',
                mode: 'TEXT',
                title: 'Table A',
                textContent: 'Company A 10 20 30',
                assetUrl: null,
                sourcePage: 2,
                bbox: null,
                confidence: 0.95,
                evidence: { source: 'text' },
            },
            {
                id: 'ref-b',
                order: 2,
                kind: 'DIAGRAM',
                mode: 'SNAPSHOT',
                title: 'Figure B',
                textContent: null,
                assetUrl: 'https://example.com/b.png',
                sourcePage: 3,
                bbox: { x: 20 },
                confidence: 0.72,
                evidence: { source: 'visual' },
            },
        ])
    })

    it('returns an empty array for missing links', () => {
        expect(mapQuestionReferences(undefined)).toEqual([])
        expect(mapQuestionReferences(null)).toEqual([])
    })

    it('drops metadata-only text references while preserving pending visual references', () => {
        const mapped = mapQuestionReferences([
            {
                order: 1,
                reference: {
                    id: 'ref-noise',
                    kind: 'OTHER',
                    mode: 'TEXT',
                    title: 'Reference',
                    textContent: 'PDF\nleac205.pdf\nGENERATE MOCK TEST WITH ACCORDING TO THE FORMAT OF ACCOUNTANCY 8',
                    assetUrl: null,
                    sourcePage: 1,
                    bbox: null,
                    confidence: 0.95,
                    evidence: null,
                },
            },
            {
                order: 2,
                reference: {
                    id: 'ref-pending',
                    kind: 'DIAGRAM',
                    mode: 'SNAPSHOT',
                    title: null,
                    textContent: null,
                    assetUrl: null,
                    sourcePage: 2,
                    bbox: null,
                    confidence: 0.81,
                    evidence: null,
                },
            },
        ])

        expect(mapped).toEqual([
            expect.objectContaining({
                id: 'ref-pending',
                kind: 'DIAGRAM',
                mode: 'SNAPSHOT',
                assetUrl: null,
            }),
        ])
    })
})
