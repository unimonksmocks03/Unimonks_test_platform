import { describe, expect, test } from 'vitest'

import { getTestSearchTokens, matchesTestSearch } from '../../../lib/utils/test-search'

describe('test search helpers', () => {
    test('splits alpha numeric terms into stable tokens', () => {
        expect(getTestSearchTokens('math1')).toEqual(['math', '1'])
        expect(getTestSearchTokens('Math-13')).toEqual(['math', '13'])
        expect(getTestSearchTokens('  reasoning   number-series  ')).toEqual(['reasoning', 'number', 'series'])
    })

    test('matches title text using all normalized tokens', () => {
        expect(matchesTestSearch('REASONING WORD FORMATION', 'reasoning')).toBe(true)
        expect(matchesTestSearch('AI Test - Math-13', 'math13')).toBe(true)
        expect(matchesTestSearch('AI Test - Math-13', 'math 13')).toBe(true)
        expect(matchesTestSearch('India: People and Economy CH 5 XII', 'reasoning')).toBe(false)
        expect(matchesTestSearch('CUET UG political science contemporary wp 1', 'reasoning')).toBe(false)
    })
})
