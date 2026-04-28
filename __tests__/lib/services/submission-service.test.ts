import { beforeEach, expect, test, vi } from 'vitest'

vi.stubEnv('NODE_ENV', process.env.NODE_ENV ?? 'test')
vi.stubEnv('DATABASE_URL', process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
vi.stubEnv('DIRECT_URL', process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')

const txMock = {
    $queryRawUnsafe: vi.fn(),
    testSession: {
        update: vi.fn(),
    },
    test: {
        findUnique: vi.fn(),
    },
}

const prismaMock = {
    $transaction: vi.fn(),
}

vi.mock('@/lib/prisma', () => ({
    prisma: prismaMock,
}))

vi.mock('@/lib/queue/qstash', () => ({
    enqueueForceSubmit: vi.fn(),
}))

const servicePromise = import('../../../lib/services/submission-service')

function createSession(overrides: Record<string, unknown> = {}) {
    return {
        id: 'session-1',
        studentId: 'student-1',
        testId: 'test-1',
        status: 'IN_PROGRESS',
        startedAt: new Date(Date.now() - 60_000),
        serverDeadline: new Date(Date.now() + 60_000),
        answers: [],
        testSnapshot: {
            title: 'Mock Test',
            description: null,
            durationMinutes: 60,
            settings: {
                correctMarks: 5,
                incorrectMarks: 1,
                shuffleQuestions: false,
                showResult: true,
                passingScore: 40,
            },
            questions: [
                {
                    id: 'question-1',
                    order: 1,
                    stem: 'Question one',
                    sharedContext: null,
                    options: [
                        { id: 'A', text: 'Correct', isCorrect: true },
                        { id: 'B', text: 'Wrong', isCorrect: false },
                        { id: 'C', text: 'Wrong', isCorrect: false },
                        { id: 'D', text: 'Wrong', isCorrect: false },
                    ],
                    difficulty: 'MEDIUM',
                    topic: 'General',
                    explanation: 'Explanation',
                    references: [],
                },
            ],
        },
        ...overrides,
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock))
    txMock.testSession.update.mockResolvedValue({ id: 'session-1' })
    txMock.test.findUnique.mockResolvedValue(null)
})

test('saveBatchAnswers rejects immediately after the server deadline', async () => {
    const { saveBatchAnswers } = await servicePromise
    txMock.$queryRawUnsafe.mockResolvedValueOnce([
        createSession({
            serverDeadline: new Date(Date.now() - 1_000),
        }),
    ])

    const result = await saveBatchAnswers('student-1', 'session-1', [
        {
            questionId: 'question-1',
            optionId: 'A',
            answeredAt: new Date().toISOString(),
        },
    ])

    expect(result).toMatchObject({
        error: true,
        code: 'DEADLINE_PASSED',
    })
    expect(txMock.testSession.update).not.toHaveBeenCalled()
})

test('submitTest still accepts final answers during the submission grace period', async () => {
    const { submitTest } = await servicePromise
    txMock.$queryRawUnsafe.mockResolvedValueOnce([
        createSession({
            serverDeadline: new Date(Date.now() - 1_000),
        }),
    ])

    const result = await submitTest('student-1', 'session-1', false, [
        {
            questionId: 'question-1',
            optionId: 'A',
            markedForReview: true,
            answeredAt: new Date().toISOString(),
        },
    ])

    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(result.score).toBe(5)
    expect(result.totalMarks).toBe(5)
    expect(result.percentage).toBe(100)
    expect(txMock.testSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: expect.objectContaining({
            status: 'SUBMITTED',
            answers: [
                expect.objectContaining({
                    questionId: 'question-1',
                    optionId: 'A',
                    markedForReview: true,
                }),
            ],
        }),
    })
})
