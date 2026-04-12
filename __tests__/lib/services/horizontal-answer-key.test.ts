import { expect, test, vi } from 'vitest'

vi.stubEnv('NODE_ENV', process.env.NODE_ENV ?? 'test')
vi.stubEnv('DATABASE_URL', process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
vi.stubEnv('DIRECT_URL', process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')

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
