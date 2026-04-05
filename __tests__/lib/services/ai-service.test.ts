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

const markdownStyledPdfMcqText = `
# CUET MCQs — Chapter 10:
Wave Optics
**Q1.** A wavefront is defined as:
(a) The path along which light energy travels
(b) A surface of constant phase
(c) A surface of constant amplitude only
(d) The direction of propagation of light
**Answer:** (b)
**Explanation:** A wavefront is a locus of all points that oscillate in the same phase.

**Q2.** The wavefronts from a point source of light are:
(a) Plane
(b) Cylindrical
(c) Spherical
(d) Elliptical
**Answer:** (c)
**Explanation:** A point source emits waves uniformly in all directions.

**Q3.** At a very large distance from a point source, the wavefront can be approximated as:
(a) Spherical
(b) Cylindrical
(c) Plane
(d) Conical
**Answer:** (c)
**Explanation:** At a large distance, a small portion of the spherical wavefront can be considered as a plane wavefront.

**Q4.** According to Huygens' principle, each point on a wavefront acts as:
(a) An absorber of waves
(b) A source of secondary wavelets
(c) A reflector of waves
(d) A source of longitudinal waves only
**Answer:** (b)
**Explanation:** Each point of the wavefront is the source of secondary disturbance.

**Q5.** The new wavefront at a later time, according to Huygens' construction, is the:
(a) Backward envelope of secondary wavelets
(b) Sum of all secondary wavelets
(c) Forward envelope of secondary wavelets
(d) Tangent to the incident wavefront
**Answer:** (c)
**Explanation:** The new wavefront is the forward envelope of all the secondary wavelets.
`

const decimalContinuationMcqText = `
Q29. Two incoherent sources of equal intensity I₀ produce at any point an average intensity of:
(a) 4I₀
(b) Zero
(c) 2I₀
(d) I₀
Answer: (c)
Explanation: For incoherent sources, there is no stable interference pattern.
Q30. In a Young's double slit experiment, the slits are separated by 0.28 mm and the screen is
1.4 m away. If the fourth bright fringe is at 1.2 cm from the central fringe, the wavelength of light
used is:
(a) 500 nm
(b) 600 nm
(c) 700 nm
(d) 400 nm
Answer: (b)
Explanation: Using x₄ = 4λD/d gives 600 nm.
Q31. Diffraction of light is:
(a) Bending of light around corners of an obstacle
(b) Splitting of light into colours
(c) Reflection from smooth surfaces
(d) Refraction through a prism
Answer: (a)
Explanation: Diffraction is the bending of light around obstacles or apertures.
`

const markdownHeadingMcqText = `
# CUET MCQs - Chapter 5:
Continuity and Differentiability
## 1. The function f(x)=2x+3 is continuous at x=1 because
(A) f(1)=3
(B) lim x→1 f(x)=5=f(1)
(C) f(1)=1
(D) lim x→1 f(x)=0
Answer: (B)
## 2. The function f(x)=x^2 is continuous at x=0 because
(A) lim x→0 x^2 = 1
(B) f(0)=1
(C) lim x→0 x^2 = 0 = f(0)
(D) f is not defined at 0
Answer: (C)
## 3. The modulus function f(x)=|x| is
(A) discontinuous at x=0
(B) continuous at x=0
(C) not defined at x=0
(D) differentiable at x=0 only
Answer: (B)
## 4. The constant function f(x)=k is
(A) continuous nowhere
(B) continuous only at x=0
(C) continuous at every real number
(D) discontinuous at every real number
Answer: (C)
## 5. Every polynomial function is
(A) discontinuous
(B) continuous at every real number
(C) continuous only at x=0
(D) continuous only for positive x
Answer: (B)
`

const inlineQuestionDocxMcqText = `
Mock Test: Tertiary and Quaternary Activities
Question: Which of the following best describes tertiary activities?A) Production of raw materialsB) Providing services rather than goodsC) Manufacturing textilesD) Mining minerals
Answer: B.
Question: Tertiary sector workers are usually:A) Unskilled laborers in fieldsB) Skilled professionals providing servicesC) Farmer and fishermenD) Factory machine operators
Answer: B.
Question: Which of the following is not a tertiary activity?A) Trading agricultural produceB) Telecommunications serviceC) Weaving cotton fabricD) Hospital healthcare service
Answer: C.
Question: Which pair of activities is correctly matched to the tertiary sector?A) Fishing – Food processingB) Retail trading – Direct sale to consumersC) Steel production – Coal miningD) Wheat farming – Flour milling
Answer: B.
Question: The sale of goods directly to consumers is called:A) Wholesale tradeB) Retail trade[3]C) Import-export businessD) Bartering
Answer: B.
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

test('extractQuestionsFromDocumentText parses markdown-styled MCQs with bold Q, Answer, and Explanation labels', async () => {
    const {
        extractQuestionsFromDocumentText,
    } = await aiServicePromise

    const analysis = extractQuestionsFromDocumentText(markdownStyledPdfMcqText)

    expect(analysis.detectedAsMcqDocument).toBe(true)
    expect(analysis.questions).toHaveLength(5)
    expect(analysis.expectedQuestionCount).toBe(5)
    expect(analysis.exactMatchAchieved).toBe(true)
    expect(analysis.missingQuestionNumbers).toEqual([])
    expect(analysis.invalidQuestionNumbers).toEqual([])
    expect(analysis.questions[0]).toMatchObject({
        stem: 'A wavefront is defined as:',
    })
    expect(analysis.questions[0]?.options.find((option) => option.isCorrect)?.id).toBe('B')
    expect(analysis.questions[2]?.options.find((option) => option.isCorrect)?.id).toBe('C')
})

test('extractQuestionsFromDocumentText does not treat decimal continuation lines as new question numbers', async () => {
    const {
        extractQuestionsFromDocumentText,
    } = await aiServicePromise

    const analysis = extractQuestionsFromDocumentText(decimalContinuationMcqText)

    expect(analysis.questions).toHaveLength(3)
    expect(analysis.detectedAsMcqDocument).toBe(false)
    expect(analysis.expectedQuestionCount).toBeNull()
    expect(analysis.duplicateQuestionNumbers).toEqual([])
    expect(analysis.invalidQuestionNumbers).toEqual([])
    expect(analysis.questions[1]?.stem).toContain("the slits are separated by 0.28 mm")
    expect(analysis.questions[1]?.options.find((option) => option.isCorrect)?.id).toBe('B')
})

test('extractQuestionsFromDocumentText parses markdown heading numbered MCQs', async () => {
    const {
        extractQuestionsFromDocumentText,
    } = await aiServicePromise

    const analysis = extractQuestionsFromDocumentText(markdownHeadingMcqText)

    expect(analysis.detectedAsMcqDocument).toBe(true)
    expect(analysis.questions).toHaveLength(5)
    expect(analysis.expectedQuestionCount).toBe(5)
    expect(analysis.exactMatchAchieved).toBe(true)
    expect(analysis.invalidQuestionNumbers).toEqual([])
    expect(analysis.duplicateQuestionNumbers).toEqual([])
    expect(analysis.questions[0]?.stem).toBe('The function f(x)=2x+3 is continuous at x=1 because')
    expect(analysis.questions[4]?.options.find((option) => option.isCorrect)?.id).toBe('B')
})

test('extractQuestionsFromDocumentText parses inline Question-prefixed MCQs with inline options and dotted answers', async () => {
    const {
        extractQuestionsFromDocumentText,
    } = await aiServicePromise

    const analysis = extractQuestionsFromDocumentText(inlineQuestionDocxMcqText)

    expect(analysis.detectedAsMcqDocument).toBe(true)
    expect(analysis.questions).toHaveLength(5)
    expect(analysis.expectedQuestionCount).toBe(5)
    expect(analysis.exactMatchAchieved).toBe(true)
    expect(analysis.invalidQuestionNumbers).toEqual([])
    expect(analysis.duplicateQuestionNumbers).toEqual([])
    expect(analysis.questions[0]?.stem).toBe('Which of the following best describes tertiary activities?')
    expect(analysis.questions[0]?.options).toEqual([
        { id: 'A', text: 'Production of raw materials', isCorrect: false },
        { id: 'B', text: 'Providing services rather than goods', isCorrect: true },
        { id: 'C', text: 'Manufacturing textiles', isCorrect: false },
        { id: 'D', text: 'Mining minerals', isCorrect: false },
    ])
    expect(analysis.questions[4]?.options.find((option) => option.isCorrect)?.id).toBe('B')
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
