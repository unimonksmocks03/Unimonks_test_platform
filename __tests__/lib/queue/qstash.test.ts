import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@upstash/qstash', () => ({
    Client: class {
        publishJSON() {
            return Promise.resolve({ messageId: 'test' })
        }
    },
}))

vi.mock('@/lib/env', () => ({
    getAppEnv: () => ({ NEXT_PUBLIC_APP_URL: 'https://example.com' }),
    getQStashEnv: () => ({ mode: 'local' as const, baseUrl: 'http://localhost:8080' }),
}))

let toSafeDeduplicationId: typeof import('@/lib/queue/qstash').toSafeDeduplicationId

beforeEach(async () => {
    ;({ toSafeDeduplicationId } = await import('@/lib/queue/qstash'))
})

describe('toSafeDeduplicationId', () => {
    it('replaces unsupported qstash delimiters with hyphens', () => {
        expect(toSafeDeduplicationId('document-import', 'abc:def:ghi')).toBe(
            'document-import-abc-def-ghi',
        )
    })

    it('preserves safe characters', () => {
        expect(toSafeDeduplicationId('force-submit', 'job_123-xyz')).toBe(
            'force-submit-job_123-xyz',
        )
    })
})
