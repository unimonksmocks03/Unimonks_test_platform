import { expect, test } from 'vitest'

import {
    canUseImpersonationContext,
    validateImpersonationTarget,
} from '../../../lib/services/impersonation-service'

test('sub-admin cannot impersonate the protected owner admin account', () => {
    const result = validateImpersonationTarget(
        { userId: 'sub-admin-1', role: 'SUB_ADMIN' },
        { id: 'owner-admin', role: 'ADMIN', status: 'ACTIVE' },
    )

    expect(result).toEqual({
        allowed: false,
        status: 403,
        code: 'OWNER_ADMIN_PROTECTED',
        message: 'The primary admin account cannot be impersonated',
    })
})

test('sub-admin can impersonate an active student account', () => {
    const result = validateImpersonationTarget(
        { userId: 'sub-admin-1', role: 'SUB_ADMIN' },
        { id: 'student-1', role: 'STUDENT', status: 'ACTIVE' },
    )

    expect(result).toEqual({ allowed: true })
})

test('inactive users cannot be impersonated', () => {
    const result = validateImpersonationTarget(
        { userId: 'admin-1', role: 'ADMIN' },
        { id: 'student-1', role: 'STUDENT', status: 'SUSPENDED' },
    )

    expect(result).toEqual({
        allowed: false,
        status: 403,
        code: 'TARGET_USER_INACTIVE',
        message: 'Only active users can be impersonated',
    })
})

test('impersonation context can only be restored by the original admin or that exact impersonated user', () => {
    const context = {
        contextId: 'ctx-1',
        originalUserId: 'admin-1',
        originalRole: 'ADMIN' as const,
        impersonatedUserId: 'student-1',
        impersonatedUserRole: 'STUDENT' as const,
        createdAt: new Date('2026-03-22T00:00:00.000Z').toISOString(),
    }

    expect(canUseImpersonationContext(context, 'admin-1')).toBe(true)
    expect(canUseImpersonationContext(context, 'student-1')).toBe(true)
    expect(canUseImpersonationContext(context, 'student-2')).toBe(false)
})
