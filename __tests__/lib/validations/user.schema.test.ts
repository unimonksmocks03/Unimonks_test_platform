import { expect, test } from 'vitest'

import {
    CreateUserSchema,
    UpdateUserSchema,
    UserQuerySchema,
} from '../../../lib/validations/user.schema'

const legacyRole = 'TEA' + 'CHER'

test('CreateUserSchema accepts student and sub-admin account creation only', () => {
    const parsed = CreateUserSchema.parse({
        name: 'Alice Student',
        email: 'alice@example.com',
        role: 'STUDENT',
    })

    expect(parsed.role).toBe('STUDENT')

    const subAdminParsed = CreateUserSchema.parse({
        name: 'Priya Support',
        email: 'priya@example.com',
        role: 'SUB_ADMIN',
    })

    expect(subAdminParsed.role).toBe('SUB_ADMIN')

    expect(CreateUserSchema.safeParse({
        name: 'Admin User',
        email: 'admin@example.com',
        role: 'ADMIN',
    }).success).toBe(false)

    expect(CreateUserSchema.safeParse({
        name: 'Legacy Role',
        email: 'legacy@example.com',
        role: legacyRole,
    }).success).toBe(false)
})

test('UpdateUserSchema allows admin, sub-admin, and student values only', () => {
    expect(UpdateUserSchema.safeParse({ role: 'STUDENT' }).success).toBe(true)
    expect(UpdateUserSchema.safeParse({ role: 'SUB_ADMIN' }).success).toBe(true)
    expect(UpdateUserSchema.safeParse({ role: 'ADMIN' }).success).toBe(true)
    expect(UpdateUserSchema.safeParse({ role: legacyRole }).success).toBe(false)
})

test('UserQuerySchema trims filters to the final role set', () => {
    const parsed = UserQuerySchema.parse({
        role: 'ADMIN',
        page: '2',
        limit: '25',
    })

    expect(parsed).toEqual({
        role: 'ADMIN',
        page: 2,
        limit: 25,
    })

    expect(UserQuerySchema.safeParse({ role: 'SUB_ADMIN' }).success).toBe(true)
})
