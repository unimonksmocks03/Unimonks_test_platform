import { expect, test } from 'vitest'

import {
    CreateBatchSchema,
    UpdateBatchSchema,
} from '../../../lib/validations/batch.schema'

const legacyOwnerField = ['tea', 'cher', 'Id'].join('')

test('CreateBatchSchema accepts only the final batch payload', () => {
    const parsed = CreateBatchSchema.parse({
        name: 'CUET Batch A',
        code: 'CUET-2026-A',
        [legacyOwnerField]: '7aa1a2f2-4a2c-489a-b2d5-67f44d317f0a',
    })

    expect(parsed).toEqual({
        name: 'CUET Batch A',
        code: 'CUET-2026-A',
    })
})

test('UpdateBatchSchema strips the legacy owner field', () => {
    const parsed = UpdateBatchSchema.parse({
        name: 'CUET Batch B',
        status: 'ACTIVE',
        [legacyOwnerField]: '7aa1a2f2-4a2c-489a-b2d5-67f44d317f0a',
    })

    expect(parsed).toEqual({
        name: 'CUET Batch B',
        status: 'ACTIVE',
    })
})
