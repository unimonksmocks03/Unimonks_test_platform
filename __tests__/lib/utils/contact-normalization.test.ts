import { expect, test } from 'vitest'

import {
    isValidPhoneNumber,
    normalizeEmail,
    normalizeOptionalEmail,
    normalizeOptionalPhone,
    normalizePhone,
} from '../../../lib/utils/contact-normalization'

test('normalizeEmail trims and lowercases emails', () => {
    expect(normalizeEmail('  Student@Example.COM  ')).toBe('student@example.com')
})

test('normalizeOptionalEmail returns null for blank values', () => {
    expect(normalizeOptionalEmail('   ')).toBeNull()
    expect(normalizeOptionalEmail(undefined)).toBeNull()
})

test('normalizePhone removes formatting characters and unifies 00-prefixed international numbers', () => {
    expect(normalizePhone('+91 98765-43210')).toBe('919876543210')
    expect(normalizePhone('0091 (98765) 43210')).toBe('919876543210')
})

test('normalizeOptionalPhone returns null for blank values', () => {
    expect(normalizeOptionalPhone('   ')).toBeNull()
    expect(normalizeOptionalPhone(null)).toBeNull()
})

test('isValidPhoneNumber enforces the shared digit-length bounds', () => {
    expect(isValidPhoneNumber('9876543210')).toBe(true)
    expect(isValidPhoneNumber('+1 202-555-0142')).toBe(true)
    expect(isValidPhoneNumber('12345')).toBe(false)
})
