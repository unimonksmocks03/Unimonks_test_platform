import { describe, expect, it } from 'vitest'

import {
    isAllowedAutoSharedContext,
    sanitizeReferenceText,
    sanitizeReferenceTitle,
    shouldRenderReferencePayload,
} from '@/lib/utils/reference-sanitizer'

describe('reference-sanitizer', () => {
    it('removes metadata-only lines from shared reference text', () => {
        expect(
            sanitizeReferenceText(
                'PDF\nleac205.pdf\nGENERATE MOCK TEST WITH ACCORDING TO THE FORMAT OF ACCOUNTANCY 8',
            ),
        ).toBeNull()
    })

    it('preserves meaningful lines while stripping surrounding metadata noise', () => {
        expect(
            sanitizeReferenceText(
                'PDF\naccountancy5.pdf\nCash Flow Data\nOperating 25 30 40',
            ),
        ).toBe('Cash Flow Data\nOperating 25 30 40')
    })

    it('drops leaked option and answer lines that are really question content, not references', () => {
        expect(
            sanitizeReferenceText(
                '(c) Changes in short-term borrowings\n(d) Only interest paid\nANSWER (a) Expenditures made for resources intended to generate future income and cash flows',
            ),
        ).toBeNull()
    })

    it('drops any block containing option answer hint leakage even when it mentions data', () => {
        expect(
            sanitizeReferenceText(
                'c) hypothesis\nd) parameter\nAnswer: c\nHint: sample data is used to infer the population value',
            ),
        ).toBeNull()
    })

    it('allows only real auto shared contexts', () => {
        expect(isAllowedAutoSharedContext(
            'Read the following passage and answer the questions that follow.\nThe passage describes monsoon winds, crops, irrigation, and regional planning in detail.',
        )).toBe(true)

        expect(isAllowedAutoSharedContext(
            'Year Sales Profit\n2021 100 25\n2022 120 30',
        )).toBe(true)

        expect(isAllowedAutoSharedContext(
            'List I\nA. River\nB. Mountain\nList II\n1. Nile\n2. Himalaya',
        )).toBe(true)

        expect(isAllowedAutoSharedContext('f(x) = x^2 + 2x + 1')).toBe(false)
    })

    it('keeps passage instructions that start with answer the following', () => {
        expect(
            sanitizeReferenceText(
                'Read the following passage carefully.\nAnswer the following questions based on the passage.\nThe author compares irrigation, rainfall, and crop choices across two regions.',
            ),
        ).toBe(
            'Read the following passage carefully.\nAnswer the following questions based on the passage.\nThe author compares irrigation, rainfall, and crop choices across two regions.',
        )
    })

    it('drops metadata-only titles but preserves useful ones', () => {
        expect(sanitizeReferenceTitle('PDF')).toBeNull()
        expect(sanitizeReferenceTitle('Figure 1')).toBe('Figure 1')
    })

    it('keeps pending visual references renderable even without text payload', () => {
        expect(
            shouldRenderReferencePayload({
                mode: 'SNAPSHOT',
                title: null,
                textContent: null,
                assetUrl: null,
            }),
        ).toBe(true)
    })
})
