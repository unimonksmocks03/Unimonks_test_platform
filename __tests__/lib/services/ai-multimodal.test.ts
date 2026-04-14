import { expect, test, vi } from 'vitest'
import type { GeneratedQuestion } from '@/lib/services/ai-service.types'

vi.stubEnv('NODE_ENV', process.env.NODE_ENV ?? 'test')
vi.stubEnv('DATABASE_URL', process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
vi.stubEnv('DIRECT_URL', process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
vi.stubEnv('OPENAI_API_KEY', process.env.OPENAI_API_KEY ?? 'test-openai-key')

const {
    mockResponsesParse,
    mockChatCreate,
    mockGetDocumentProxy,
    mockRenderPageAsImage,
    mockExtractText,
    mockCanvasImport,
} = vi.hoisted(() => ({
    mockResponsesParse: vi.fn(),
    mockChatCreate: vi.fn(),
    mockGetDocumentProxy: vi.fn(),
    mockRenderPageAsImage: vi.fn(),
    mockExtractText: vi.fn(),
    mockCanvasImport: vi.fn(() => ({ createCanvas: vi.fn() })),
}))

vi.mock('openai', () => ({
    default: class {
        responses = { parse: mockResponsesParse }
        chat = { completions: { create: mockChatCreate } }
    },
}))

vi.mock('unpdf', () => ({
    getDocumentProxy: mockGetDocumentProxy,
    renderPageAsImage: mockRenderPageAsImage,
    extractText: mockExtractText,
}))

vi.mock('@napi-rs/canvas', () => mockCanvasImport())

const aiServicePromise = import('../../../lib/services/ai-service')

function createVerifiedQuestion(stem: string, overrides: Partial<GeneratedQuestion> = {}): GeneratedQuestion {
    return {
        stem,
        options: [
            { id: 'A', text: 'A', isCorrect: false },
            { id: 'B', text: 'B', isCorrect: true },
            { id: 'C', text: 'C', isCorrect: false },
            { id: 'D', text: 'D', isCorrect: false },
        ],
        explanation: 'E',
        difficulty: 'EASY',
        topic: 'T',
        extractionMode: 'TEXT_EXACT',
        answerSource: 'ANSWER_KEY',
        sourceSnippet: stem,
        confidence: 0.96,
        ...overrides,
    }
}

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

test('extractQuestionsFromPdfMultimodal chunks visual PDFs by page window and merges numbered questions', async () => {
    const { extractQuestionsFromPdfMultimodal } = await aiServicePromise

    mockResponsesParse.mockReset()
    mockGetDocumentProxy.mockResolvedValueOnce({
        numPages: 3,
        cleanup: vi.fn(),
    })
    mockExtractText.mockResolvedValueOnce({
        text: [
            'Q1 Find the missing figure',
            'Q2 Find the missing figure',
            'Q3 Find the missing figure',
        ],
    })
    mockRenderPageAsImage.mockResolvedValue('data:image/png;base64,fake')
    mockResponsesParse
        .mockResolvedValueOnce({
            output_parsed: {
                questions: [
                    {
                        questionNumber: 1,
                        stem: 'Find the missing figure',
                        options: [
                            { id: 'A', text: 'Option A', isCorrect: false },
                            { id: 'B', text: 'Option B', isCorrect: true },
                            { id: 'C', text: 'Option C', isCorrect: false },
                            { id: 'D', text: 'Option D', isCorrect: false },
                        ],
                        explanation: 'Pattern points to option B.',
                        difficulty: 'MEDIUM',
                        topic: 'Figure Completion',
                        sharedContext: 'Grid with stars and circles changing left to right.',
                        sourcePage: 1,
                        sourceSnippet: 'Q1 Find the missing figure',
                        answerSource: 'INFERRED',
                        confidence: 0.88,
                        sharedContextEvidence: 'Visual pattern visible on page 1.',
                        extractionMode: 'MULTIMODAL_EXTRACT',
                    },
                    {
                        questionNumber: 2,
                        stem: 'Find the missing figure',
                        options: [
                            { id: 'A', text: 'Option A2', isCorrect: false },
                            { id: 'B', text: 'Option B2', isCorrect: true },
                            { id: 'C', text: 'Option C2', isCorrect: false },
                            { id: 'D', text: 'Option D2', isCorrect: false },
                        ],
                        explanation: 'Pattern points to option B2.',
                        difficulty: 'MEDIUM',
                        topic: 'Figure Completion',
                        sharedContext: 'Longer context for question two.',
                        sourcePage: 2,
                        sourceSnippet: 'Q2 Find the missing figure',
                        answerSource: 'INFERRED',
                        confidence: 0.9,
                        sharedContextEvidence: 'Visual pattern visible on page 2.',
                        extractionMode: 'MULTIMODAL_EXTRACT',
                    },
                ],
            },
            usage: {
                input_tokens: 300,
                output_tokens: 180,
            },
        })
        .mockResolvedValueOnce({
            output_parsed: {
                questions: [
                    {
                        questionNumber: 2,
                        stem: 'Find the missing figure',
                        options: [
                            { id: 'A', text: 'Option A2', isCorrect: false },
                            { id: 'B', text: 'Option B2', isCorrect: true },
                            { id: 'C', text: 'Option C2', isCorrect: false },
                            { id: 'D', text: 'Option D2', isCorrect: false },
                        ],
                        explanation: 'Pattern points to option B2.',
                        difficulty: 'MEDIUM',
                        topic: 'Figure Completion',
                        sharedContext: 'Short',
                        sourcePage: 2,
                        sourceSnippet: 'Q2',
                        answerSource: 'INFERRED',
                        confidence: 0.61,
                        sharedContextEvidence: 'Short evidence',
                        extractionMode: 'MULTIMODAL_EXTRACT',
                    },
                    {
                        questionNumber: 3,
                        stem: 'Find the missing figure',
                        options: [
                            { id: 'A', text: 'Option A3', isCorrect: false },
                            { id: 'B', text: 'Option B3', isCorrect: true },
                            { id: 'C', text: 'Option C3', isCorrect: false },
                            { id: 'D', text: 'Option D3', isCorrect: false },
                        ],
                        explanation: 'Pattern points to option B3.',
                        difficulty: 'MEDIUM',
                        topic: 'Figure Completion',
                        sharedContext: 'Context for question three.',
                        sourcePage: 3,
                        sourceSnippet: 'Q3 Find the missing figure',
                        answerSource: 'INFERRED',
                        confidence: 0.91,
                        sharedContextEvidence: 'Visual pattern visible on page 3.',
                        extractionMode: 'MULTIMODAL_EXTRACT',
                    },
                ],
            },
            usage: {
                input_tokens: 320,
                output_tokens: 190,
            },
        })

    const result = await extractQuestionsFromPdfMultimodal(
        Buffer.from('fake-pdf'),
        3,
        undefined,
        'visual.pdf',
        { preferChunkedVisualExtraction: true },
    )

    expect(result.error).toBeUndefined()
    expect(result.questions).toHaveLength(3)
    expect(result.chunkCount).toBe(2)
    expect(result.pageCount).toBe(3)
    expect(result.questions?.[1]?.sharedContext).toBe('Longer context for question two.')
    expect(mockResponsesParse).toHaveBeenCalledTimes(2)
})

test('extractVisualReferencesFromPdfImages degrades gracefully when visual-reference rendering prerequisites are unavailable', async () => {
    vi.resetModules()
    mockRenderPageAsImage.mockReset()
    mockCanvasImport.mockImplementationOnce(() => {
        throw new Error('canvas unavailable')
    })

    const { extractVisualReferencesFromPdfImages } = await import('../../../lib/services/ai-service')

    mockGetDocumentProxy.mockResolvedValueOnce({
        numPages: 2,
        cleanup: vi.fn(),
    })

    const result = await extractVisualReferencesFromPdfImages(
        Buffer.from('fake-pdf'),
        undefined,
        'visual.pdf',
    )

    expect(result.error).toBe(true)
    expect(typeof result.message).toBe('string')
    expect(result.message?.length).toBeGreaterThan(0)
    expect(result.references).toEqual([])

    mockCanvasImport.mockImplementation(() => ({ createCanvas: vi.fn() }))
})

test('verifyExtractedQuestionsWithAI preserves global question numbering across batches', async () => {
    const { verifyExtractedQuestionsWithAI } = await aiServicePromise

    mockChatCreate.mockReset()
    mockChatCreate
        .mockResolvedValueOnce({
            choices: [{ message: { content: JSON.stringify({ issues: [], overallAssessment: 'Batch 1 OK', confidence: 0.95 }) } }],
            usage: { prompt_tokens: 100, completion_tokens: 20 },
        })
        .mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({
                        issues: [
                            {
                                questionNumber: 1,
                                issue: 'Missing context for the referenced passage.',
                                category: 'CROSS',
                                severity: 'WARNING',
                                code: 'AI_CHECK_MISSING_CONTEXT',
                            },
                        ],
                        overallAssessment: 'Batch 2 found one issue.',
                        confidence: 0.72,
                    }),
                },
            }],
            usage: { prompt_tokens: 110, completion_tokens: 22 },
        })

    const questions = Array.from({ length: 16 }, (_, index) => createVerifiedQuestion(`Question ${index + 1}`))
    const result = await verifyExtractedQuestionsWithAI(questions, 'gpt-4o-mini')

    expect(result.error).toBeUndefined()
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.questionNumber).toBe(16)
})

test('verifyExtractedQuestions passes for a valid 50-question set', async () => {
    const { verifyExtractedQuestions } = await aiServicePromise

    const questions = Array.from({ length: 50 }, (_, index) => {
        const correctId = ['A', 'B', 'C', 'D'][index % 4]
        return {
        stem: `Question ${index + 1}: What is ${index + 1}?`,
        options: [
            { id: 'A', text: 'Wrong', isCorrect: correctId === 'A' },
            { id: 'B', text: 'Correct', isCorrect: correctId === 'B' },
            { id: 'C', text: 'Wrong', isCorrect: correctId === 'C' },
            { id: 'D', text: 'Wrong', isCorrect: correctId === 'D' },
        ],
        explanation: `${index + 1} is the answer.`,
        difficulty: 'MEDIUM',
        topic: 'Math',
        }
    })

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

test('verifyExtractedQuestions detects wrong option counts and true duplicate questions', async () => {
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
                { id: 'D', text: 'D', isCorrect: false },
            ],
            explanation: 'E',
            difficulty: 'EASY',
            topic: 'T',
        },
    ]

    const result = verifyExtractedQuestions(questions as never, 2)
    expect(result.passed).toBe(false)
    expect(result.issues.some((issue) => issue.issue.includes('Duplicate stem'))).toBe(true)
})

test('verifyExtractedQuestions allows repeated generic stems when options or shared context differ', async () => {
    const { verifyExtractedQuestions } = await aiServicePromise

    const questions = [
        {
            stem: 'Find the missing figure',
            sharedContext: 'Grid with stars',
            sharedContextEvidence: 'Visual grid with stars',
            options: [
                { id: 'A', text: 'Star A', isCorrect: true },
                { id: 'B', text: 'Star B', isCorrect: false },
                { id: 'C', text: 'Star C', isCorrect: false },
                { id: 'D', text: 'Star D', isCorrect: false },
            ],
            explanation: 'E',
            difficulty: 'EASY',
            topic: 'T',
        },
        {
            stem: 'Find the missing figure',
            sharedContext: 'Grid with circles',
            sharedContextEvidence: 'Visual grid with circles',
            options: [
                { id: 'A', text: 'Circle A', isCorrect: false },
                { id: 'B', text: 'Circle B', isCorrect: true },
                { id: 'C', text: 'Circle C', isCorrect: false },
                { id: 'D', text: 'Circle D', isCorrect: false },
            ],
            explanation: 'E',
            difficulty: 'EASY',
            topic: 'T',
        },
    ]

    const result = verifyExtractedQuestions(questions as never, 2)
    expect(result.passed).toBe(true)
    expect(result.issues.some((issue) => issue.code === 'DUPLICATE_STEM')).toBe(false)
})

test('verifyExtractedQuestions allows visual figure prompts when the shared diagrams differ', async () => {
    const { verifyExtractedQuestions } = await aiServicePromise

    const questions = [
        createVerifiedQuestion('Which option completes the figure?', {
            sharedContext: 'Grid with stars and a missing final cell',
            sharedContextEvidence: 'Page 1 figure grid',
            options: [
                { id: 'A', text: '☆ ☆ ☆', isCorrect: true },
                { id: 'B', text: '★ ★ ★', isCorrect: false },
                { id: 'C', text: '☆ ★ ☆', isCorrect: false },
                { id: 'D', text: '★ ☆ ★', isCorrect: false },
            ],
        }),
        createVerifiedQuestion('Which option completes the figure?', {
            sharedContext: 'Grid with circles and a missing final cell',
            sharedContextEvidence: 'Page 2 figure grid',
            options: [
                { id: 'A', text: '○ ○ ●', isCorrect: false },
                { id: 'B', text: '● ○ ○', isCorrect: true },
                { id: 'C', text: '○ ● ○', isCorrect: false },
                { id: 'D', text: '● ● ○', isCorrect: false },
            ],
        }),
    ]

    const result = verifyExtractedQuestions(questions as never, 2)
    expect(result.passed).toBe(true)
    expect(result.issues.some((issue) => issue.code === 'DUPLICATE_STEM' || issue.code === 'NEAR_DUPLICATE_STEM')).toBe(false)
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

test('verifyExtractedQuestions flags missing shared context for table-referenced questions', async () => {
    const { verifyExtractedQuestions } = await aiServicePromise

    const questions = [
        {
            stem: 'Based on the following table, which year had the highest output?',
            options: [
                { id: 'A', text: '2021', isCorrect: false },
                { id: 'B', text: '2022', isCorrect: true },
                { id: 'C', text: '2023', isCorrect: false },
                { id: 'D', text: '2024', isCorrect: false },
            ],
            explanation: '2022 had the highest output.',
            difficulty: 'MEDIUM',
            topic: 'Data Interpretation',
            sharedContext: null,
        },
    ]

    const result = verifyExtractedQuestions(questions, 1)

    expect(result.passed).toBe(false)
    expect(result.issues.some((issue) => issue.issue.includes('shared context'))).toBe(true)
})

test('verifyExtractedQuestions categorizes structural, evidence, and cross issues', async () => {
    const { verifyExtractedQuestions } = await aiServicePromise

    const questions = [
        createVerifiedQuestion('Question 1 duplicated stem'),
        createVerifiedQuestion('Question 1 duplicated stem', {
            options: [
                { id: 'A', text: 'A', isCorrect: false },
                { id: 'A', text: 'B', isCorrect: true },
                { id: 'C', text: 'C', isCorrect: false },
                { id: 'D', text: 'D', isCorrect: false },
            ],
            confidence: 0.32,
        }),
    ]

    const result = verifyExtractedQuestions(
        questions as never,
        5,
        {
            extractionAnalysis: {
                expectedQuestionCount: 5,
                exactMatchAchieved: false,
                invalidQuestionNumbers: [4],
                missingQuestionNumbers: [3, 5],
                duplicateQuestionNumbers: [1],
                questions,
            },
            comparisonQuestions: [createVerifiedQuestion('Completely different stem')],
        },
    )

    expect(result.passed).toBe(false)
    expect(result.issueSummary).toBeDefined()
    expect(result.issues.some((issue) => issue.category === 'STRUCTURAL')).toBe(true)
    expect(result.issues.some((issue) => issue.category === 'EVIDENCE')).toBe(true)
    expect(result.issues.some((issue) => issue.category === 'CROSS')).toBe(true)
    expect(result.issues.some((issue) => issue.code === 'NUMBERING_GAP')).toBe(true)
    expect(result.issues.some((issue) => issue.code === 'LOW_CONFIDENCE')).toBe(true)
    expect(result.issues.some((issue) => issue.code === 'SECONDARY_EXTRACTION_DISAGREEMENT')).toBe(true)
})

test('verifyExtractedQuestions flags multimodal questions without source pages and suspicious answer skew', async () => {
    const { verifyExtractedQuestions } = await aiServicePromise

    const questions = Array.from({ length: 20 }, (_, index) => createVerifiedQuestion(
        `Question ${index + 1}?`,
        {
            extractionMode: 'MULTIMODAL_EXTRACT',
            sourcePage: null,
            options: [
                { id: 'A', text: 'A', isCorrect: false },
                { id: 'B', text: 'B', isCorrect: true },
                { id: 'C', text: 'C', isCorrect: false },
                { id: 'D', text: 'D', isCorrect: false },
            ],
        },
    ))

    const result = verifyExtractedQuestions(questions as never, 20)

    expect(result.passed).toBe(false)
    expect(result.issues.some((issue) => issue.code === 'MISSING_SOURCE_PAGE')).toBe(true)
    expect(result.issues.some((issue) => issue.code === 'ANSWER_SKEW')).toBe(true)
})

test('extractVisualReferencesFromPdfImages returns structured visual references from page OCR and images', async () => {
    const { extractVisualReferencesFromPdfImages } = await aiServicePromise

    mockResponsesParse.mockClear()
    mockGetDocumentProxy.mockClear()
    mockExtractText.mockClear()
    mockRenderPageAsImage.mockClear()

    mockGetDocumentProxy.mockResolvedValueOnce({
        numPages: 2,
        cleanup: vi.fn(),
    })
    mockExtractText.mockResolvedValueOnce({
        text: [
            'Study the following Venn diagram and answer Q1.',
            'Q2 is based on the figure below.',
        ],
    })
    mockRenderPageAsImage
        .mockResolvedValueOnce('data:image/png;base64,page-1')
        .mockResolvedValueOnce('data:image/png;base64,page-2')
    mockResponsesParse.mockResolvedValueOnce({
        output_parsed: {
            references: [
                {
                    questionNumber: 1,
                    sharedContext: 'Venn diagram showing overlap between sets A and B.',
                    sourcePage: 1,
                    sourceSnippet: 'Study the following Venn diagram and answer Q1.',
                    sharedContextEvidence: 'Question 1 explicitly points to the page 1 Venn diagram.',
                    confidence: 0.91,
                },
            ],
        },
        usage: {
            input_tokens: 320,
            output_tokens: 90,
        },
    })

    const result = await extractVisualReferencesFromPdfImages(
        Buffer.from('fake-pdf'),
        undefined,
        'venn.pdf',
    )

    expect(result.error).toBeUndefined()
    expect(result.references).toHaveLength(1)
    expect(result.references?.[0]).toMatchObject({
        questionNumber: 1,
        sharedContext: 'Venn diagram showing overlap between sets A and B.',
        sourcePage: 1,
        sourceSnippet: 'Study the following Venn diagram and answer Q1.',
    })
    expect(mockResponsesParse).toHaveBeenCalledOnce()
    expect(mockRenderPageAsImage).toHaveBeenCalledTimes(2)
})
