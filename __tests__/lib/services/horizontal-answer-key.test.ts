import { expect, test, vi } from 'vitest'
import type { GeneratedQuestion } from '@/lib/services/ai-service.types'

vi.stubEnv('NODE_ENV', process.env.NODE_ENV ?? 'test')
vi.stubEnv('DATABASE_URL', process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
vi.stubEnv('DIRECT_URL', process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
vi.stubEnv('OPENAI_API_KEY', '')

const aiServicePromise = import('../../../lib/services/ai-service')

const horizontalAnswerKeyDocxText = `
CUET UG HISTORY — CLEAN EXTRACTABLE MOCK TEST
50 questions | Answer key included at the end

Q1. Arrange the major developments in Harappan archaeology in chronological order.
(A) Alpha
(B) Beta
(C) Gamma
(D) Delta

Q2. Traces of canals have been found at the Harappan site of:
(A) Shortughai in Afghanistan
(B) Banawali in Haryana
(C) Harappa
(D) Mohenjodaro

Q3. Which rulers adopted the title devaputra, or 'son of god'?
(A) Kushanas
(B) Sakas
(C) Mauryas
(D) Satavahanas

ANSWER KEY
Answer Key Table
Horizontal Box Table
Q1B
Q2A
Q3A
`

const inlineAnswerPdfLikeText = `
REASONING MOCKTEST FIGURE FORMATION

Q1. How many triangles are in this figure?
(a) 10
(b) 12
(c) 14
(d) 16
Answer: (d)

Q2. How many squares are visible?
(a) 5
(b) 6
(c) 7
(d) 8
Answer: (b)
`

const repeatedFullSequenceText = [
    ...Array.from({ length: 10 }, (_, index) => {
        const questionNumber = index + 1
        return `Q${questionNumber}. First paper question ${questionNumber}
(A) One
(B) Two
(C) Three
(D) Four
ANSWER (A) One`
    }),
    ...Array.from({ length: 10 }, (_, index) => {
        const questionNumber = index + 1
        return `Q${questionNumber}. Second paper question ${questionNumber}
(A) Wrong
(B) Wrong
(C) Wrong
(D) Wrong
ANSWER (B) Wrong`
    }),
].join('\n\n')

test('extractQuestionsFromDocumentTextPrecisely resolves compact horizontal answer keys like Q1B', async () => {
    const { extractQuestionsFromDocumentTextPrecisely } = await aiServicePromise

    const result = await extractQuestionsFromDocumentTextPrecisely(horizontalAnswerKeyDocxText)

    expect(result.exactMatchAchieved).toBe(true)
    expect(result.questions).toHaveLength(3)
    expect(result.questions[0].options.find((option) => option.isCorrect)?.id).toBe('B')
    expect(result.questions[0].answerSource).toBe('ANSWER_KEY')
    expect(result.questions[1].options.find((option) => option.isCorrect)?.id).toBe('A')
    expect(result.questions[2].options.find((option) => option.isCorrect)?.id).toBe('A')
})

test('extractQuestionsFromDocumentTextPrecisely keeps the first complete numbered sequence when the document repeats a full paper', async () => {
    const { extractQuestionsFromDocumentTextPrecisely } = await aiServicePromise

    const result = await extractQuestionsFromDocumentTextPrecisely(repeatedFullSequenceText)

    expect(result.exactMatchAchieved).toBe(true)
    expect(result.questions).toHaveLength(10)
    expect(result.duplicateQuestionNumbers).toEqual([])
    expect(result.questions[0]?.stem).toContain('First paper question 1')
    expect(result.questions[9]?.stem).toContain('First paper question 10')
})

test('reconcileGeneratedQuestionsWithTextAnswerHints repairs missing correct options from the document answer key', async () => {
    const { reconcileGeneratedQuestionsWithTextAnswerHints } = await aiServicePromise

    const multimodalQuestions: GeneratedQuestion[] = [
        {
            stem: 'Arrange the major developments in Harappan archaeology in chronological order.',
            options: [
                { id: 'A', text: 'Alpha', isCorrect: false },
                { id: 'B', text: 'Beta', isCorrect: false },
                { id: 'C', text: 'Gamma', isCorrect: false },
                { id: 'D', text: 'Delta', isCorrect: false },
            ],
            explanation: 'Recovered visually.',
            difficulty: 'EASY',
            topic: 'History',
            answerSource: 'INFERRED',
            confidence: 0.51,
            extractionMode: 'MULTIMODAL_EXTRACT',
        },
        {
            stem: 'Traces of canals have been found at the Harappan site of:',
            options: [
                { id: 'A', text: 'Shortughai in Afghanistan', isCorrect: false },
                { id: 'B', text: 'Banawali in Haryana', isCorrect: false },
                { id: 'C', text: 'Harappa', isCorrect: false },
                { id: 'D', text: 'Mohenjodaro', isCorrect: false },
            ],
            explanation: 'Recovered visually.',
            difficulty: 'EASY',
            topic: 'History',
            answerSource: 'INFERRED',
            confidence: 0.44,
            extractionMode: 'MULTIMODAL_EXTRACT',
        },
    ]

    const reconciled = reconcileGeneratedQuestionsWithTextAnswerHints(
        multimodalQuestions,
        horizontalAnswerKeyDocxText,
    )

    expect(reconciled.repairedCount).toBe(2)
    expect(reconciled.answerHintsRecovered).toBeGreaterThanOrEqual(2)
    expect(reconciled.questions[0].options.find((option) => option.isCorrect)?.id).toBe('B')
    expect(reconciled.questions[0].answerSource).toBe('ANSWER_KEY')
    expect(reconciled.questions[1].options.find((option) => option.isCorrect)?.id).toBe('A')
    expect(reconciled.questions[1].answerSource).toBe('ANSWER_KEY')
})

test('reconcileGeneratedQuestionsWithTextAnswerHints repairs missing correct options from inline answer lines', async () => {
    const { reconcileGeneratedQuestionsWithTextAnswerHints } = await aiServicePromise

    const multimodalQuestions: GeneratedQuestion[] = [
        {
            stem: 'How many triangles are in this figure?',
            options: [
                { id: 'A', text: '10', isCorrect: false },
                { id: 'B', text: '12', isCorrect: false },
                { id: 'C', text: '14', isCorrect: false },
                { id: 'D', text: '16', isCorrect: false },
            ],
            explanation: 'Recovered visually.',
            difficulty: 'MEDIUM',
            topic: 'Reasoning',
            answerSource: 'INFERRED',
            confidence: 0.42,
            extractionMode: 'MULTIMODAL_EXTRACT',
        },
        {
            stem: 'How many squares are visible?',
            options: [
                { id: 'A', text: '5', isCorrect: false },
                { id: 'B', text: '6', isCorrect: false },
                { id: 'C', text: '7', isCorrect: false },
                { id: 'D', text: '8', isCorrect: false },
            ],
            explanation: 'Recovered visually.',
            difficulty: 'MEDIUM',
            topic: 'Reasoning',
            answerSource: 'INFERRED',
            confidence: 0.39,
            extractionMode: 'MULTIMODAL_EXTRACT',
        },
    ]

    const reconciled = reconcileGeneratedQuestionsWithTextAnswerHints(
        multimodalQuestions,
        inlineAnswerPdfLikeText,
    )

    expect(reconciled.repairedCount).toBe(2)
    expect(reconciled.questions[0].options.find((option) => option.isCorrect)?.id).toBe('D')
    expect(reconciled.questions[0].answerSource).toBe('INLINE_ANSWER')
    expect(reconciled.questions[1].options.find((option) => option.isCorrect)?.id).toBe('B')
    expect(reconciled.questions[1].answerSource).toBe('INLINE_ANSWER')
})
