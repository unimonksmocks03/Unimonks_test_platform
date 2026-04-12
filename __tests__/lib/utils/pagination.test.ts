import { expect, test } from 'vitest'

import { buildPaginationItems, getPaginationSummary } from '../../../lib/utils/pagination'

test('buildPaginationItems returns all pages when the page count is small', () => {
    expect(buildPaginationItems(2, 4)).toEqual([1, 2, 3, 4])
})

test('buildPaginationItems collapses distant pages with ellipses', () => {
    expect(buildPaginationItems(5, 10)).toEqual([1, 'ellipsis', 4, 5, 6, 'ellipsis', 10])
})

test('buildPaginationItems keeps the leading range visible near the start', () => {
    expect(buildPaginationItems(2, 10)).toEqual([1, 2, 3, 4, 'ellipsis', 10])
})

test('buildPaginationItems keeps the trailing range visible near the end', () => {
    expect(buildPaginationItems(9, 10)).toEqual([1, 'ellipsis', 7, 8, 9, 10])
})

test('getPaginationSummary returns the visible item range for a populated page', () => {
    expect(getPaginationSummary(3, 20, 78)).toEqual({ start: 41, end: 60 })
})

test('getPaginationSummary returns zeroes when there are no items', () => {
    expect(getPaginationSummary(1, 20, 0)).toEqual({ start: 0, end: 0 })
})
