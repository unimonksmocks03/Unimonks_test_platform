import { expect, test, vi } from 'vitest'

vi.stubEnv('NODE_ENV', process.env.NODE_ENV ?? 'test')
vi.stubEnv('DATABASE_URL', process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
vi.stubEnv('DIRECT_URL', process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')

const lifecyclePromise = import('../../../lib/services/test-lifecycle')

test('hardDeleteTestsById returns zero when called with no ids', async () => {
    const { hardDeleteTestsById } = await lifecyclePromise

    await expect(hardDeleteTestsById([])).resolves.toEqual({ deletedCount: 0 })
})
