import jwt from 'jsonwebtoken'
import { expect, test, vi } from 'vitest'

vi.stubEnv('NODE_ENV', process.env.NODE_ENV ?? 'test')
vi.stubEnv('DATABASE_URL', process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
vi.stubEnv('DIRECT_URL', process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
vi.stubEnv('JWT_SECRET', 'auth-access-secret')
vi.stubEnv('JWT_REFRESH_SECRET', 'auth-refresh-secret')

const leadCaptureServicePromise = import('../../../lib/services/lead-capture-service')

test('resolveExistingLeadByContact prefers an exact email-and-phone match when both are present', async () => {
    const { resolveExistingLeadByContact } = await leadCaptureServicePromise

    const result = resolveExistingLeadByContact(
        [
            {
                id: 'lead-email-only',
                emailNormalized: 'same@example.com',
                phoneNormalized: '9999999999',
            },
            {
                id: 'lead-exact',
                emailNormalized: 'same@example.com',
                phoneNormalized: '8888888888',
            },
        ],
        'same@example.com',
        '8888888888',
    )

    expect(result?.id).toBe('lead-exact')
})

test('resolveExistingLeadByContact falls back to email or phone overlap and does not infer a name-only match', async () => {
    const { resolveExistingLeadByContact } = await leadCaptureServicePromise

    const leads = [
        {
            id: 'lead-email-match',
            emailNormalized: 'same@example.com',
            phoneNormalized: '1111111111',
        },
        {
            id: 'lead-phone-match',
            emailNormalized: 'other@example.com',
            phoneNormalized: '2222222222',
        },
    ]

    expect(resolveExistingLeadByContact(leads, 'same@example.com', '3333333333')?.id).toBe('lead-email-match')
    expect(resolveExistingLeadByContact(leads, 'fresh@example.com', '2222222222')?.id).toBe('lead-phone-match')
    expect(resolveExistingLeadByContact(leads, 'fresh@example.com', '4444444444')).toBeNull()
})

test('public lead access tokens use a dedicated signing secret instead of the auth JWT secret', async () => {
    const {
        createPublicLeadAccessToken,
        getPublicLeadTokenSecret,
        verifyPublicLeadAccessToken,
    } = await leadCaptureServicePromise

    const token = createPublicLeadAccessToken('lead-123')
    const derivedSecret = getPublicLeadTokenSecret()

    expect(derivedSecret).not.toBe('auth-access-secret')
    expect(verifyPublicLeadAccessToken(token)).toEqual({ leadId: 'lead-123' })
    expect(() => jwt.verify(token, 'auth-access-secret')).toThrow()
})
