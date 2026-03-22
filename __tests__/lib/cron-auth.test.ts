import { afterEach, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { isAuthorizedCronRequest } from '../../lib/cron-auth'

afterEach(() => {
    vi.unstubAllEnvs()
})

function createRequest(headers: Record<string, string> = {}) {
    return new NextRequest('https://unimonks.test/api/cron/reconcile-jobs', {
        headers,
    })
}

test('production cron requests require the configured bearer secret', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CRON_SECRET', 'super-secret')

    expect(isAuthorizedCronRequest(createRequest({
        authorization: 'Bearer super-secret',
    }))).toBe(true)

    expect(isAuthorizedCronRequest(createRequest({
        authorization: 'Bearer wrong-secret',
        'user-agent': 'vercel-cron/1.0',
    }))).toBe(false)

    expect(isAuthorizedCronRequest(createRequest({
        'user-agent': 'vercel-cron/1.0',
    }))).toBe(false)
})

test('non-production cron requests remain open for local development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    delete process.env.CRON_SECRET

    expect(isAuthorizedCronRequest(createRequest())).toBe(true)
})
