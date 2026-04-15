import { describe, expect, it } from 'vitest'

import {
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
