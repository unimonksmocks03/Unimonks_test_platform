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

const inlineQNumberMcqText = `
Q1. Globalisation as a concept fundamentally deals with:(a) Military alliances between nations(b) Flows of ideas, capital, commodities and people(c) Only economic transactions between countries(d) Political dominance of one country over another
Answer: (b)
Q2. Which of the following has been a critical factor in causing globalisation?(a) Religion(b) Monarchy(c) Technology(d) Military power
Answer: (c)
Q3. The cultural effect of globalisation leads to the fear of:(a) Cultural heterogenisation(b) Cultural homogenisation(c) Cultural isolation(d) Cultural preservation
Answer: (b)
Q4. India embarked on a programme of economic reforms in 1991 responding to:(a) A military crisis(b) A financial crisis and desire for higher economic growth(c) Pressure from neighbouring countries(d) A cultural revolution
Answer: (b)
Q5. Arrange the following events in correct chronological order:
India's economic reforms programme
First WSF meeting in Porto Alegre
Seattle WTO protests
Fourth WSF meeting in Mumbai
(a) 1 → 3 → 2 → 4(b) 3 → 1 → 2 → 4(c) 1 → 2 → 3 → 4(d) 2 → 1 → 3 → 4
Answer: (a)
`

const quotedInlineQNumberMcqText = `
Q1. "The burger is no substitute for a masala dosa." This statement from the chapter implies:(a) American food is superior to Indian food(b) Indian food culture will disappear(c) External influences enlarge choices without replacing traditions(d) Globalisation has no cultural impact
Answer: (c)
Q2. Which of the following is a likely cultural outcome of globalisation?(a) Complete isolation(b) Total sameness in all cultures(c) Hybrid cultural combinations(d) No cultural exchange
Answer: (c)
Q3. What does cultural heterogenisation most closely describe?(a) One identical global culture(b) Multiple cultures blending in new ways(c) End of all traditions(d) Isolation from global flows
Answer: (b)
Q4. Which factor helped accelerate globalisation the most?(a) Technology and communication advances(b) Local village fairs(c) Decline of transport(d) Reduced trade
Answer: (a)
Q5. Which statement best reflects the chapter's cultural argument?(a) Foreign influence always erases local culture(b) Local traditions can adapt without disappearing(c) Only food habits change(d) Culture has no relation to globalisation
Answer: (b)
`

const lowercaseListStemMcqText = `
1. Match the Treaties (List I) with their respective years of inception/signing (List II):
List I:
a. Montreal Protocol
b. Earth Summit (Rio)
c. Kyoto Protocol
d. Antarctic Environmental Protocol
List II:
1991
1997
1987
1992
A. a-3, b-4, c-2, d-1
B. a-4, b-3, c-1, d-2
C. a-3, b-1, c-2, d-4
D. a-1, b-4, c-2, d-3
Answer: A
2. Which country is noted as the single largest producer of oil, holding a quarter of the world's total reserves?
A. United States
B. Russia
C. Iraq
D. Saudi Arabia
Answer: D
3. Assertion (A): The history of petroleum is also the history of war and struggle.
Reason (R): The immense wealth associated with oil and its indispensability to the global economy generates intense political struggles to control it.
A. Both A and R are true, and R is the correct explanation of A.
B. Both A and R are true, but R is NOT the correct explanation of A.
C. A is true, but R is false.
D. A is false, but R is true.
Answer: A
4. What is the central agenda of the "Agenda 21" document produced at the Rio Summit?
A. A list of 21 mandatory emission cuts for the North.
B. A recommended list of development practices to achieve sustainable development.
C. A charter for the rights of indigenous peoples in 21 countries.
D. A military alliance treaty to protect global oil reserves.
Answer: B
5. The concept of "Res communis humanitatis" is applied to:
A. Exclusive Economic Zones (EEZ)
B. National territorial waters
C. The Global Commons
D. Indigenous reservation lands
Answer: C
`

const numberedStatementStemMcqText = `
Q1. Which of the following best describes a galvanic cell?
(1) Converts chemical energy into electrical energy
(2) Converts electrical energy into chemical energy
(3) Operates only in molten salts
(4) Requires continuous heating
Answer: (1)
Q2. Correct statements about haloalkanes:
1. Generally insoluble in water
2. Denser than water (Br, I compounds)
3. Dipole moment decreases: CH3F > CH3Cl > CH3Br > CH3I
(1) 1 and 2 only
(2) 1 and 3 only
(3) 2 and 3 only
(4) 1, 2 and 3
Answer: (4)
Q3. Which reagent converts alcohols to alkyl chlorides with gaseous by-products?
(1) PCl3
(2) HCl + ZnCl2
(3) SOCl2
(4) Cl2/UV light
Answer: (3)
Q4. Which statement is INCORRECT?
(1) SN2 follows second order kinetics
(2) SN1 gives racemic mixture
(3) Primary halides prefer SN1 mechanism
(4) Carbocation stability: 3° > 2° > 1°
Answer: (3)
Q5. Which statement about Grignard reagents is correct?
(1) Prepared in water
(2) Prepared in dry ether
(3) Stable in alcohol
(4) Unreactive toward CO2
Answer: (2)
`

const headerOnlyAssertionReasonMcqText = `
Q1.
Assertion: Primary alkyl halides undergo SN2 reactions readily.
Reason: Primary carbocations are highly stable.
(1) Both A and R are true and R is the correct explanation of A
(2) Both A and R are true but R is NOT the correct explanation of A
(3) A is true but R is false
(4) A is false but R is true
Answer: (3) A is true but R is false
Q2.
Assertion: Haloalkanes have higher boiling points than corresponding alkanes.
Reason: Haloalkanes have stronger van der Waals forces due to greater molecular mass and polarity.
Answer: (1) Both A and R are true and R is the correct explanation of A
Q3.
Assertion: SN1 reactions give racemic mixture.
Reason: Planar carbocation intermediate is formed.
Answer: (1) Both A and R are true and R is the correct explanation of A
Q4.
Assertion: Vinyl chloride is less reactive than ethyl chloride.
Reason: C-Cl bond in vinyl chloride has partial double bond character.
Answer: (1) Both A and R are true and R is the correct explanation of A
Q5.
Assertion: Haloalkanes are polar but immiscible with water.
Reason: Haloalkanes cannot form hydrogen bonds with water.
Answer: (1) Both A and R are true and R is the correct explanation of A
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

test('extractQuestionsFromDocumentText parses Q-numbered MCQs with inline options on the question line', async () => {
    const {
        extractQuestionsFromDocumentText,
    } = await aiServicePromise

    const analysis = extractQuestionsFromDocumentText(inlineQNumberMcqText)

    expect(analysis.detectedAsMcqDocument).toBe(true)
    expect(analysis.questions).toHaveLength(5)
    expect(analysis.expectedQuestionCount).toBe(5)
    expect(analysis.exactMatchAchieved).toBe(true)
    expect(analysis.invalidQuestionNumbers).toEqual([])
    expect(analysis.duplicateQuestionNumbers).toEqual([])
    expect(analysis.questions[0]?.options.find((option) => option.isCorrect)?.id).toBe('B')
    expect(analysis.questions[4]?.options.find((option) => option.isCorrect)?.id).toBe('A')
})

test('extractQuestionsFromDocumentText ignores word-final punctuation when parsing quoted inline-option stems', async () => {
    const {
        extractQuestionsFromDocumentText,
    } = await aiServicePromise

    const analysis = extractQuestionsFromDocumentText(quotedInlineQNumberMcqText)

    expect(analysis.detectedAsMcqDocument).toBe(true)
    expect(analysis.questions).toHaveLength(5)
    expect(analysis.expectedQuestionCount).toBe(5)
    expect(analysis.exactMatchAchieved).toBe(true)
    expect(analysis.invalidQuestionNumbers).toEqual([])
    expect(analysis.questions[0]?.options.find((option) => option.isCorrect)?.id).toBe('C')
})

test('extractQuestionsFromDocumentText keeps lowercase list markers in the stem when uppercase options appear later', async () => {
    const {
        extractQuestionsFromDocumentText,
    } = await aiServicePromise

    const analysis = extractQuestionsFromDocumentText(lowercaseListStemMcqText)

    expect(analysis.detectedAsMcqDocument).toBe(true)
    expect(analysis.questions).toHaveLength(5)
    expect(analysis.expectedQuestionCount).toBe(5)
    expect(analysis.exactMatchAchieved).toBe(true)
    expect(analysis.invalidQuestionNumbers).toEqual([])
    expect(analysis.duplicateQuestionNumbers).toEqual([])
    expect(analysis.questions[0]?.stem).toContain('a. Montreal Protocol')
    expect(analysis.questions[0]?.stem).toContain('1991')
    expect(analysis.questions[0]?.options.find((option) => option.isCorrect)?.id).toBe('A')
})

test('extractQuestionsFromDocumentText keeps numbered stem statements inside the current question', async () => {
    const {
        extractQuestionsFromDocumentText,
    } = await aiServicePromise

    const analysis = extractQuestionsFromDocumentText(numberedStatementStemMcqText)

    expect(analysis.detectedAsMcqDocument).toBe(true)
    expect(analysis.questions).toHaveLength(5)
    expect(analysis.expectedQuestionCount).toBe(5)
    expect(analysis.exactMatchAchieved).toBe(true)
    expect(analysis.invalidQuestionNumbers).toEqual([])
    expect(analysis.duplicateQuestionNumbers).toEqual([])
    expect(analysis.questions[1]?.stem).toContain('1. Generally insoluble in water')
    expect(analysis.questions[1]?.options.find((option) => option.isCorrect)?.id).toBe('D')
})

test('extractQuestionsFromDocumentText parses header-only assertion-reason blocks with implicit standard options', async () => {
    const {
        extractQuestionsFromDocumentText,
    } = await aiServicePromise

    const analysis = extractQuestionsFromDocumentText(headerOnlyAssertionReasonMcqText)

    expect(analysis.detectedAsMcqDocument).toBe(true)
    expect(analysis.questions).toHaveLength(5)
    expect(analysis.expectedQuestionCount).toBe(5)
    expect(analysis.exactMatchAchieved).toBe(true)
    expect(analysis.invalidQuestionNumbers).toEqual([])
    expect(analysis.missingQuestionNumbers).toEqual([])
    expect(analysis.questions[0]?.stem).toContain('Assertion: Primary alkyl halides undergo SN2 reactions readily.')
    expect(analysis.questions[0]?.stem).toContain('Reason: Primary carbocations are highly stable.')
    expect(analysis.questions[1]?.options.find((option) => option.isCorrect)?.id).toBe('A')
})

// Covers the "REVISED CHEM UNIT 7 MOCK" format: Ques N: prefix, lowercase (a-d) options,
// "Answer N: (x) text" inline answers, match-the-following with uppercase List I labels +
// numeric List II items, assertion-reason, roman-numeral statements, and hyphenated
// chemical names that wrap across PDF lines.
const chemUnit7StyleMcqText = `
Ques 1: Which of the following represents an allylic alcohol?
(a) CH2=CH-OH
(b) CH2=CH-CH2-OH
(c) C6H5-OH
(d) C6H5-CH2-OH
Answer 1: (b) CH2=CH-CH2-OH

Ques 2: Match the following common names of phenols with their IUPAC names:
List I
A. Catechol
B. Resorcinol
C. Hydroquinone
D. o-Cresol
List II
1. Benzene-1,4-diol
2. Benzene-1,2-diol
3. 2-Methylphenol
4. Benzene-1,3-diol
(a) A-2, B-4, C-1, D-3
(b) A-2, B-1, C-4, D-3
(c) A-4, B-2, C-1, D-3
(d) A-1, B-4, C-2, D-3
Answer 2: (a) A-2, B-4, C-1, D-3

Ques 3: Assertion (A): The C-O-H bond angle in alcohols is slightly less than the tetrahedral angle.
Reason (R): It is due to the repulsion between the unshared electron pairs of oxygen.
(a) Both A and R are correct and R is the correct explanation of A.
(b) Both A and R are correct but R is not the correct explanation of A.
(c) A is correct but R is incorrect.
(d) A is incorrect but R is correct.
Answer 3: (a) Both A and R are correct and R is the correct explanation of A.

Ques 4: Which of the following statements is correct regarding the hydration of alkenes?
I. Acid-catalysed hydration follows Markovnikov's rule.
II. Hydroboration-oxidation gives anti-Markovnikov alcohol.
III. Both methods give primary alcohols exclusively.
(a) I only
(b) I and II only
(c) II and III only
(d) I, II, and III
Answer 4: (b) I and II only

Ques 5: Which of the following is an appropriate set of reactants for the preparation of 2-methylprop-
1-ene instead of an ether?
(a) Sodium ethoxide + tert-Butyl bromide
(b) Sodium tert-butoxide + Ethyl bromide
(c) Sodium methoxide + Isopropyl bromide
(d) Sodium isopropoxide + Methyl bromide
Answer 5: (a) Sodium ethoxide + tert-Butyl bromide
`

test('extractQuestionsFromDocumentText handles Ques-N prefix, Answer-N inline answers, match-the-following, assertion-reason, and hyphenated chemical name line-wraps', async () => {
    const {
        extractQuestionsFromDocumentText,
    } = await aiServicePromise

    const analysis = extractQuestionsFromDocumentText(chemUnit7StyleMcqText)

    expect(analysis.detectedAsMcqDocument).toBe(true)
    expect(analysis.questions).toHaveLength(5)
    expect(analysis.expectedQuestionCount).toBe(5)
    expect(analysis.exactMatchAchieved).toBe(true)
    expect(analysis.answerHintCount).toBe(5)
    expect(analysis.invalidQuestionNumbers).toEqual([])
    expect(analysis.missingQuestionNumbers).toEqual([])

    // Q1 – simple MCQ, answer B
    expect(analysis.questions[0]?.stem).toBe('Which of the following represents an allylic alcohol?')
    expect(analysis.questions[0]?.options.find((o) => o.isCorrect)?.id).toBe('B')
    expect(analysis.questions[0]?.options.find((o) => o.isCorrect)?.text).toBe('CH2=CH-CH2-OH')

    // Q2 – match-the-following: List I labels and List II items must be in the stem,
    // lowercase (a-d) must be the answer options
    expect(analysis.questions[1]?.stem).toContain('A. Catechol')
    expect(analysis.questions[1]?.stem).toContain('1. Benzene-1,4-diol')
    expect(analysis.questions[1]?.options).toEqual([
        { id: 'A', text: 'A-2, B-4, C-1, D-3', isCorrect: true },
        { id: 'B', text: 'A-2, B-1, C-4, D-3', isCorrect: false },
        { id: 'C', text: 'A-4, B-2, C-1, D-3', isCorrect: false },
        { id: 'D', text: 'A-1, B-4, C-2, D-3', isCorrect: false },
    ])

    // Q3 – assertion-reason with lowercase (a-d) options, answer A
    expect(analysis.questions[2]?.stem).toContain('Assertion (A):')
    expect(analysis.questions[2]?.stem).toContain('Reason (R):')
    expect(analysis.questions[2]?.options.find((o) => o.isCorrect)?.id).toBe('A')

    // Q4 – roman-numeral statements in stem, answer B
    expect(analysis.questions[3]?.stem).toContain('I. Acid-catalysed hydration')
    expect(analysis.questions[3]?.options.find((o) => o.isCorrect)?.id).toBe('B')

    // Q5 – hyphenated chemical name "2-methylprop-1-ene" split across PDF lines
    expect(analysis.questions[4]?.stem).toContain('2-methylprop-1-ene instead of an ether')
    expect(analysis.questions[4]?.options.find((o) => o.isCorrect)?.id).toBe('A')
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

test('attachSharedContextsFromPageText propagates a shared table across later question pages', async () => {
    const { attachSharedContextsFromPageText } = await aiServicePromise

    const questions = Array.from({ length: 4 }, (_, index) => ({
        stem: `Question ${index + 1} based on the following table`,
        options: [
            { id: 'A', text: 'Option A', isCorrect: index === 0 },
            { id: 'B', text: 'Option B', isCorrect: index === 1 },
            { id: 'C', text: 'Option C', isCorrect: index === 2 },
            { id: 'D', text: 'Option D', isCorrect: index === 3 },
        ],
        explanation: 'Explanation',
        difficulty: 'MEDIUM',
        topic: 'Data Interpretation',
    }))

    const pages = [
        `SECTIONAL MOCKTEST
UNIT 12: DATA INTERPRETATION
SET 1: TABLE – PRODUCTION OF CARS (in thousands)
Year Sedan SUV EV
2021 110 90 25
2022 125 95 40
Q1. Based on the following table, which year had the highest EV output?
(A) 2021
(B) 2022
(C) 2023
(D) 2024
Answer: (B)
Q2. Based on the following table, which category grew the most?
(A) Sedan
(B) SUV
(C) EV
(D) None
Answer: (C)`,
        `Q3. Based on the following table, what is the total production in 2022?
(A) 260
(B) 250
(C) 240
(D) 270
Answer: (A)
Q4. Based on the following table, what is the EV increase?
(A) 5
(B) 10
(C) 15
(D) 20
Answer: (C)`,
    ]

    const enriched = attachSharedContextsFromPageText(questions, pages)

    expect(enriched).toHaveLength(4)
    expect(enriched.every((question) => question.sharedContext?.includes('TABLE – PRODUCTION OF CARS'))).toBe(true)
    expect(enriched[2]?.sharedContext).toContain('2022 125 95 40')
    expect(enriched[3]?.sharedContext).toContain('Year Sedan SUV EV')
})
