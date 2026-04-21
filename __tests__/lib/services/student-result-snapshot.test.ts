import { beforeEach, expect, test, vi } from 'vitest'

const prismaMock = {
    testSession: {
        findUnique: vi.fn(),
    },
}

vi.mock('@/lib/prisma', () => ({
    prisma: prismaMock,
}))

const servicePromise = import('../../../lib/services/student-service')

beforeEach(() => {
    vi.clearAllMocks()
})

test('getResult prefers the stored session snapshot over mutated live test content', async () => {
    const { getResult } = await servicePromise

    prismaMock.testSession.findUnique.mockResolvedValue({
        id: 'session-1',
        studentId: 'student-1',
        attemptNumber: 1,
        status: 'SUBMITTED',
        score: 4,
        totalMarks: 5,
        percentage: 80,
        answers: [],
        submittedAt: new Date('2026-04-21T10:15:00.000Z'),
        startedAt: new Date('2026-04-21T09:30:00.000Z'),
        tabSwitchCount: 0,
        testSnapshot: {
            title: 'Snapshot title',
            description: 'Snapshot description',
            durationMinutes: 45,
            settings: {
                shuffleQuestions: false,
            },
            questions: [
                {
                    id: 'q-1',
                    order: 1,
                    stem: 'Snapshot question stem',
                    sharedContext: ' Snapshot context ',
                    options: [
                        { id: 'A', text: 'Correct', isCorrect: true },
                        { id: 'B', text: 'Wrong', isCorrect: false },
                    ],
                    difficulty: 'MEDIUM',
                    topic: 'Ratios',
                    explanation: 'Snapshot explanation',
                    references: [],
                },
            ],
        },
        test: {
            id: 'test-1',
            title: 'Mutated live title',
            description: 'Mutated live description',
            durationMinutes: 120,
            settings: {
                shuffleQuestions: false,
            },
            questions: [
                {
                    id: 'q-1',
                    order: 1,
                    stem: 'Mutated live question',
                    sharedContext: null,
                    options: [
                        { id: 'A', text: 'New correct', isCorrect: true },
                        { id: 'B', text: 'New wrong', isCorrect: false },
                    ],
                    explanation: 'Mutated explanation',
                    difficulty: 'HARD',
                    topic: 'Liquidity',
                    referenceLinks: [],
                },
            ],
            sessions: [
                {
                    id: 'session-1',
                    attemptNumber: 1,
                    status: 'SUBMITTED',
                    score: 4,
                    totalMarks: 5,
                    percentage: 80,
                    startedAt: new Date('2026-04-21T09:30:00.000Z'),
                    submittedAt: new Date('2026-04-21T10:15:00.000Z'),
                },
            ],
        },
        aiFeedback: null,
    })

    const result = await getResult('student-1', 'session-1')

    if ('error' in result) {
        throw new Error(`Expected snapshot-backed result, got ${result.code}`)
    }

    expect(result.test.title).toBe('Snapshot title')
    expect(result.test.durationMinutes).toBe(45)
    expect(result.test.questions).toEqual([
        expect.objectContaining({
            stem: 'Snapshot question stem',
            sharedContext: 'Snapshot context',
            explanation: 'Snapshot explanation',
        }),
    ])
})
