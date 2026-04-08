import { expect, test, vi } from 'vitest'

vi.stubEnv('NODE_ENV', process.env.NODE_ENV ?? 'test')
vi.stubEnv('DATABASE_URL', process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
vi.stubEnv('DIRECT_URL', process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
vi.stubEnv('OPENAI_API_KEY', process.env.OPENAI_API_KEY ?? 'test-openai-key')

const { mockResponsesParse, mockGetDocumentProxy } = vi.hoisted(() => ({
    mockResponsesParse: vi.fn(),
    mockGetDocumentProxy: vi.fn(),
}))

vi.mock('openai', () => ({
    default: class {
        responses = { parse: mockResponsesParse }
        chat = { completions: { create: vi.fn() } }
    },
}))

vi.mock('unpdf', () => ({
    getDocumentProxy: mockGetDocumentProxy,
}))

const aiServicePromise = import('../../../lib/services/ai-service')

test('extractQuestionsFromPdfMultimodal sends the PDF to GPT-4o responses.parse and returns structured questions', async () => {
    const { extractQuestionsFromPdfMultimodal } = await aiServicePromise

    mockGetDocumentProxy.mockResolvedValueOnce({
        numPages: 3,
        cleanup: vi.fn(),
    })

    mockResponsesParse.mockResolvedValueOnce({
        output_parsed: {
            questions: [
                {
                    stem: 'What is the SI unit of force?',
                    options: [
                        { id: 'A', text: 'Joule', isCorrect: false },
                        { id: 'B', text: 'Newton', isCorrect: true },
                        { id: 'C', text: 'Watt', isCorrect: false },
                        { id: 'D', text: 'Pascal', isCorrect: false },
                    ],
                    explanation: 'Newton is the SI unit of force.',
                    difficulty: 'EASY',
                    topic: 'Units',
                },
            ],
        },
        usage: {
            input_tokens: 500,
            output_tokens: 200,
        },
    })

    const result = await extractQuestionsFromPdfMultimodal(
        Buffer.from('fake-pdf'),
        50,
        undefined,
        'fixture.pdf',
    )

    expect(result.error).toBeUndefined()
    expect(result.questions).toHaveLength(1)
    expect(result.questions?.[0]?.stem).toBe('What is the SI unit of force?')
    expect(result.questions?.[0]?.options).toHaveLength(4)
    expect(result.verification?.passed).toBe(false)
    expect(mockResponsesParse).toHaveBeenCalledWith(
        expect.objectContaining({
            model: 'gpt-4o',
            text: expect.objectContaining({
                format: expect.any(Object),
            }),
        }),
    )
})

test('verifyExtractedQuestions passes for a valid 50-question set', async () => {
    const { verifyExtractedQuestions } = await aiServicePromise

    const questions = Array.from({ length: 50 }, (_, index) => ({
        stem: `Question ${index + 1}: What is ${index + 1}?`,
        options: [
            { id: 'A', text: 'Wrong', isCorrect: false },
            { id: 'B', text: 'Correct', isCorrect: true },
            { id: 'C', text: 'Wrong', isCorrect: false },
            { id: 'D', text: 'Wrong', isCorrect: false },
        ],
        explanation: `${index + 1} is the answer.`,
        difficulty: 'MEDIUM',
        topic: 'Math',
    }))

    const result = verifyExtractedQuestions(questions, 50)
    expect(result.passed).toBe(true)
    expect(result.issues).toHaveLength(0)
    expect(result.validQuestions).toBe(50)
})

test('verifyExtractedQuestions fails when count mismatch occurs', async () => {
    const { verifyExtractedQuestions } = await aiServicePromise

    const questions = Array.from({ length: 30 }, (_, index) => ({
        stem: `Q${index + 1}?`,
        options: [
            { id: 'A', text: 'A', isCorrect: false },
            { id: 'B', text: 'B', isCorrect: true },
            { id: 'C', text: 'C', isCorrect: false },
            { id: 'D', text: 'D', isCorrect: false },
        ],
        explanation: 'E',
        difficulty: 'EASY',
        topic: 'T',
    }))

    const result = verifyExtractedQuestions(questions, 50)
    expect(result.passed).toBe(false)
    expect(result.issues.some((issue) => issue.issue.includes('count mismatch'))).toBe(true)
})

test('verifyExtractedQuestions detects wrong option counts and duplicate stems', async () => {
    const { verifyExtractedQuestions } = await aiServicePromise

    const questions = [
        {
            stem: 'Valid question?',
            options: [
                { id: 'A', text: 'A', isCorrect: false },
                { id: 'B', text: 'B', isCorrect: true },
                { id: 'C', text: 'C', isCorrect: false },
                { id: 'D', text: 'D', isCorrect: false },
            ],
            explanation: 'E',
            difficulty: 'EASY',
            topic: 'T',
        },
        {
            stem: 'Valid question?',
            options: [
                { id: 'A', text: 'A', isCorrect: false },
                { id: 'B', text: 'B', isCorrect: true },
                { id: 'C', text: 'C', isCorrect: false },
            ],
            explanation: 'E',
            difficulty: 'EASY',
            topic: 'T',
        },
    ]

    const result = verifyExtractedQuestions(questions as never, 2)
    expect(result.passed).toBe(false)
    expect(result.issues.some((issue) => issue.issue.includes('Duplicate stem'))).toBe(true)
    expect(result.issues.some((issue) => issue.issue.includes('structured validation'))).toBe(true)
})

test('verifyExtractedQuestions skips count checks when expectedCount is null', async () => {
    const { verifyExtractedQuestions } = await aiServicePromise

    const questions = Array.from({ length: 3 }, (_, index) => ({
        stem: `Question ${index + 1}?`,
        options: [
            { id: 'A', text: 'A', isCorrect: false },
            { id: 'B', text: 'B', isCorrect: true },
            { id: 'C', text: 'C', isCorrect: false },
            { id: 'D', text: 'D', isCorrect: false },
        ],
        explanation: 'E',
        difficulty: 'EASY',
        topic: 'T',
    }))

    const result = verifyExtractedQuestions(questions, null)
    expect(result.passed).toBe(true)
    expect(result.validQuestions).toBe(3)
})
