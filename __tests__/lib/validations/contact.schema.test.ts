import { expect, test } from 'vitest'

import { CreateLeadContactSchema } from '../../../lib/validations/contact.schema'

test('CreateLeadContactSchema accepts email-only leads', () => {
    const parsed = CreateLeadContactSchema.parse({
        name: 'Alice Lead',
        email: ' alice@example.com ',
        phone: '   ',
    })

    expect(parsed).toEqual({
        name: 'Alice Lead',
        email: 'alice@example.com',
        phone: undefined,
    })
})

test('CreateLeadContactSchema accepts phone-only leads', () => {
    const parsed = CreateLeadContactSchema.parse({
        name: 'Bob Lead',
        phone: '+91 98765 43210',
    })

    expect(parsed.name).toBe('Bob Lead')
    expect(parsed.phone).toBe('+91 98765 43210')
    expect(parsed.email).toBeUndefined()
})

test('CreateLeadContactSchema rejects leads without any contact method', () => {
    const result = CreateLeadContactSchema.safeParse({
        name: 'Charlie Lead',
        email: '   ',
        phone: '   ',
    })

    expect(result.success).toBe(false)
    if (result.success) return

    expect(result.error.issues.some((issue) => issue.message === 'Email or phone is required')).toBe(true)
})

test('CreateLeadContactSchema rejects invalid phones', () => {
    const result = CreateLeadContactSchema.safeParse({
        name: 'Dana Lead',
        phone: '12345',
    })

    expect(result.success).toBe(false)
})
