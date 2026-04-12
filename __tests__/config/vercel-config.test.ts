import fs from 'node:fs'
import path from 'node:path'

import { expect, test } from 'vitest'

test('AI document import function is configured with the extended Vercel timeout', () => {
    const vercelConfigPath = path.resolve(__dirname, '../../vercel.json')
    const vercelConfig = JSON.parse(fs.readFileSync(vercelConfigPath, 'utf-8')) as {
        functions?: Record<string, { maxDuration?: number }>
    }

    expect(vercelConfig.functions?.['app/api/admin/tests/generate-from-doc/route.ts']?.maxDuration).toBe(300)
})
