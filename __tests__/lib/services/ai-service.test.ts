import { expect, test, vi } from 'vitest'

vi.stubEnv('NODE_ENV', process.env.NODE_ENV ?? 'test')
vi.stubEnv('DATABASE_URL', process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
vi.stubEnv('DIRECT_URL', process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')

const aiServicePromise = import('../../../lib/services/ai-service')

const physicsPdfLikeMcqText = `
50 MCQs (CUET Pattern)

CUET PHYSICS — Chapter 1:
Electric Charges and Fields

Q1. Which of the following is the SI unit of electric charge?
(A) Ampere
(B) Volt
(C) Coulomb
(D) Farad
Answer: (C)
Explanation: The SI unit of electric charge is the coulomb (C).
Di culty: Easy

ffi

Q2. When a glass rod is rubbed with silk cloth, the rod acquires positive charge because:
(A) Protons are transferred from silk to glass
(B) Electrons are transferred from glass to silk
(C) Electrons are created on silk
(D) Protons are created on glass
Answer: (B)
Explanation: During rubbing, electrons are transferred from the glass rod to the silk cloth.
Di culty: Easy

Q3. The value of the elementary charge e is:
(A) 1.6 × 10⁻¹⁹ C
(B) 1.6 × 10⁻²⁰ C
(C) 1.6 × 10⁻¹⁸ C
(D) 9.1 × 10⁻³¹ C
Answer: (A)
Explanation: The basic unit of charge e = 1.6 × 10⁻¹⁹ C.
Di culty: Easy

Q4. A body has a charge of –3.2 × 10⁻¹⁸ C. The number of excess electrons on this body is:
(A) 10
(B) 20
(C) 30
(D) 40
Answer: (B)
Explanation: n = q/e = 20 electrons.
Di culty: Easy

Q5. Which of the following is NOT a property of electric charge?
(A) Additivity
(B) Conservation
(C) Quantisation
(D) Vectorisation
Answer: (D)
Explanation: Charge is a scalar quantity.
Di culty: Easy
`

const humanGeoDocxLikeMcqText = `
45 Minutes
Section A

Q1. Which of the following best defines Human Geography?
(1) Study of rivers only
(2) Study of the relationship between people and earth
(3) Study of plants only
(4) Study of stars only

Q2. Possibilism in human geography suggests that:
(1) Nature controls every human act
(2) Humans have no relation with nature
(3) Nature offers opportunities and humans create possibilities
(4) Technology makes geography irrelevant

Q3. Neodeterminism is associated with:
(1) Griffith Taylor
(2) Vidal de la Blache
(3) Ratzel
(4) Semple

Q4. Which sub-field deals with the spatial organisation of economic activities?
(1) Political Geography
(2) Economic Geography
(3) Historical Geography
(4) Medical Geography

Q5. Human geography is best described as:
(1) An integrative discipline
(2) A branch of astronomy
(3) The study of fossils
(4) A branch of pure geology

ANSWER KEY WITH EXPLANATIONS
Quick Answer Grid
Q1
Q2
Q3
Q4
Q5
2)
3)
1)
2)
1)

Detailed Answers and Explanations
Q1. Which of the following best defines Human Geography?
Correct Answer: (2) Study of the relationship between people and earth
Explanation: Human geography studies people, place, and environment together.
Q2. Possibilism in human geography suggests that:
Correct Answer: (3) Nature offers opportunities and humans create possibilities
Explanation: Possibilism argues that humans can respond creatively to environmental opportunities.
Q3. Neodeterminism is associated with:
Correct Answer: (1) Griffith Taylor
Explanation: Griffith Taylor proposed Neodeterminism or Stop-and-Go Determinism.
Q4. Which sub-field deals with the spatial organisation of economic activities?
Correct Answer: (2) Economic Geography
Explanation: Economic geography studies the location and spatial organisation of production and exchange.
Q5. Human geography is best described as:
Correct Answer: (1) An integrative discipline
Explanation: Human geography integrates society, space, and environment.
`

const statementStyleMcqText = `
Q48. Consider statements about the nature of geography:
(A) Geography as a discipline is integrative, empirical, and practical
(B) The dichotomy between physical and human geography is entirely valid
(C) Both physical and human phenomena are described in metaphors using symbols from human anatomy
(D) Geography studies phenomena varying over space and time
Which are correct?
(1) (A), (C) and (D) only
(2) (B) and (C) only
(3) All of the above
(4) (A) and (B) only
Answer: (1)
Explanation: Statements A, C and D are correct, while B is not.
Difficulty: Medium
`

test('extractQuestionsFromDocumentText parses PDF-like CUET MCQs with parenthesized answers and pdf artifacts', async () => {
    const {
        extractQuestionsFromDocumentText,
    } = await aiServicePromise

    const analysis = extractQuestionsFromDocumentText(physicsPdfLikeMcqText)

    expect(analysis.detectedAsMcqDocument).toBe(true)
    expect(analysis.questions).toHaveLength(5)
    expect(analysis.answerHintCount).toBeGreaterThanOrEqual(5)
    expect(analysis.expectedQuestionCount).toBe(5)
    expect(analysis.exactMatchAchieved).toBe(true)
    expect(analysis.missingQuestionNumbers).toEqual([])
    expect(analysis.invalidQuestionNumbers).toEqual([])
    expect(analysis.questions[0]).toMatchObject({
        stem: 'Which of the following is the SI unit of electric charge?',
        difficulty: 'EASY',
    })
    expect(analysis.questions[0]?.options.find((option) => option.isCorrect)?.id).toBe('C')
})

test('extractQuestionsFromDocumentText uses answer-key sections without overcounting detailed-answer duplicates', async () => {
    const {
        extractQuestionsFromDocumentText,
    } = await aiServicePromise

    const analysis = extractQuestionsFromDocumentText(humanGeoDocxLikeMcqText)

    expect(analysis.detectedAsMcqDocument).toBe(true)
    expect(analysis.questions).toHaveLength(5)
    expect(analysis.answerHintCount).toBe(5)
    expect(analysis.expectedQuestionCount).toBe(5)
    expect(analysis.exactMatchAchieved).toBe(true)
    expect(analysis.missingQuestionNumbers).toEqual([])
    expect(analysis.duplicateQuestionNumbers).toEqual([])
    expect(analysis.questions[0]?.options.find((option) => option.isCorrect)?.id).toBe('B')
    expect(analysis.questions[1]?.options.find((option) => option.isCorrect)?.id).toBe('C')
})

test('extractQuestionsFromDocumentText treats statement blocks as stem content when numeric options appear later', async () => {
    const {
        extractQuestionsFromDocumentText,
    } = await aiServicePromise

    const analysis = extractQuestionsFromDocumentText(statementStyleMcqText)
    const question = analysis.questions[0]

    expect(analysis.questions).toHaveLength(1)
    expect(question?.stem).toContain('Consider statements about the nature of geography:')
    expect(question?.stem).toContain('(A) Geography as a discipline is integrative, empirical, and practical')
    expect(question?.stem).toContain('(D) Geography studies phenomena varying over space and time')
    expect(question?.stem).toContain('Which are correct?')
    expect(question?.options).toEqual([
        { id: 'A', text: '(A), (C) and (D) only', isCorrect: true },
        { id: 'B', text: '(B) and (C) only', isCorrect: false },
        { id: 'C', text: 'All of the above', isCorrect: false },
        { id: 'D', text: '(A) and (B) only', isCorrect: false },
    ])
})

test('chunkDocumentTextForGeneration advances through the tail chunk without repeating forever', async () => {
    const {
        chunkDocumentTextForGeneration,
    } = await aiServicePromise

    const source = 'A'.repeat(20500)
    const chunks = chunkDocumentTextForGeneration(source, 10000, 500)

    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(10000)
    expect(chunks[1]).toHaveLength(10000)
    expect(chunks[2]).toHaveLength(1500)
    expect(chunks.join('').length).toBeGreaterThanOrEqual(source.length)
    expect(chunks[1]).not.toBe(chunks[2])
})

test('enrichGeneratedQuestionsMetadata falls back gracefully when OpenAI metadata enrichment is unavailable', async () => {
    vi.resetModules()
    vi.stubEnv('OPENAI_API_KEY', '')
    const { enrichGeneratedQuestionsMetadata } = await import('../../../lib/services/ai-service')

    const result = await enrichGeneratedQuestionsMetadata({
        sourceLabel: 'physics-1-mcq.pdf',
        questions: [
            {
                stem: 'Which of the following is the SI unit of electric charge?',
                options: [
                    { id: 'A', text: 'Ampere', isCorrect: false },
                    { id: 'B', text: 'Volt', isCorrect: false },
                    { id: 'C', text: 'Coulomb', isCorrect: true },
                    { id: 'D', text: 'Farad', isCorrect: false },
                ],
                explanation: 'The SI unit of electric charge is coulomb.',
                difficulty: 'EASY',
                topic: 'Electrostatics',
            },
            {
                stem: 'Assertion (A): Geography as a field of study is subjected to dualism. Reason (R): Wide-ranging debates started whether geography should be nomothetic or idiographic.',
                options: [
                    { id: 'A', text: 'Both A and R are true and R is the correct explanation of A', isCorrect: true },
                    { id: 'B', text: 'Both A and R are true but R is not the correct explanation of A', isCorrect: false },
                    { id: 'C', text: 'A is true but R is false', isCorrect: false },
                    { id: 'D', text: 'A is false but R is true', isCorrect: false },
                ],
                explanation: 'The reason explains the disciplinary dualism.',
                difficulty: 'HARD',
                topic: 'Human Geography',
            },
        ],
    })

    expect(result.aiUsed).toBe(false)
    expect(result.warning).toBeTruthy()
    expect(result.questions).toHaveLength(2)
    expect(result.questions[0]?.topic).toBe('Electrostatics')
    expect(result.questions[1]?.difficulty).toBe('HARD')
    expect(result.description).toContain('physics 1 mcq')

    vi.unstubAllEnvs()
    vi.stubEnv('NODE_ENV', process.env.NODE_ENV ?? 'test')
    vi.stubEnv('DATABASE_URL', process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
    vi.stubEnv('DIRECT_URL', process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
})
