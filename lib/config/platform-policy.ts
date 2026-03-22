export const MAX_PAID_REATTEMPTS = 3
export const MAX_PAID_TOTAL_ATTEMPTS = MAX_PAID_REATTEMPTS + 1
export const MAX_FREE_TOTAL_ATTEMPTS = 1

export const DEFAULT_TEST_CORRECT_MARKS = 5
export const DEFAULT_TEST_INCORRECT_MARKS = 1
export const DEFAULT_TEST_PASSING_SCORE = 40

export const FREE_BATCH_NAME = 'FREE-Batch' as const
export const FREE_BATCH_CODE = 'FREE-BATCH' as const
export const FREE_BATCH_KIND = 'FREE_SYSTEM' as const
export const STANDARD_BATCH_KIND = 'STANDARD' as const

export const FREE_BATCH_IDENTIFIERS = Object.freeze({
    name: FREE_BATCH_NAME,
    code: FREE_BATCH_CODE,
    kind: FREE_BATCH_KIND,
})

export const DEFAULT_TEST_SETTINGS = Object.freeze({
    shuffleQuestions: false,
    showResult: true,
    passingScore: DEFAULT_TEST_PASSING_SCORE,
    correctMarks: DEFAULT_TEST_CORRECT_MARKS,
    incorrectMarks: DEFAULT_TEST_INCORRECT_MARKS,
})

export const PLATFORM_POLICY = Object.freeze({
    maxPaidReattempts: MAX_PAID_REATTEMPTS,
    maxPaidTotalAttempts: MAX_PAID_TOTAL_ATTEMPTS,
    maxFreeTotalAttempts: MAX_FREE_TOTAL_ATTEMPTS,
    defaultTestSettings: DEFAULT_TEST_SETTINGS,
    freeBatch: FREE_BATCH_IDENTIFIERS,
})
