import { expect, test, vi } from 'vitest'
import * as mcqFixtures from '../../fixtures/imports/mcq-fixtures'

vi.stubEnv('NODE_ENV', process.env.NODE_ENV ?? 'test')
vi.stubEnv('DATABASE_URL', process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
vi.stubEnv('DIRECT_URL', process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')

const {
  physicsPdfLikeMcqText,
  answerBeforeOptionsPdfMcqText,
  answerInHeaderPsychologyMcqText,
  emojiAnswerOutlierMcqText,
  humanGeoDocxLikeMcqText,
  statementStyleMcqText,
  markdownStyledPdfMcqText,
  decimalContinuationMcqText,
  markdownHeadingMcqText,
  inlineQuestionDocxMcqText,
  inlineQNumberMcqText,
  quotedInlineQNumberMcqText,
  lowercaseListStemMcqText,
  numberedStatementStemMcqText,
  headerOnlyAssertionReasonMcqText,
  chemUnit7StyleMcqText,
} = mcqFixtures

const aiServicePromise = import('../../../lib/services/ai-service')

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
        extractionMode: 'TEXT_EXACT',
        answerSource: 'INLINE_ANSWER',
    })
    expect(analysis.questions[0]?.sourceSnippet).toContain('Q1. Which of the following is the SI unit of electric charge?')
    expect(analysis.questions[0]?.confidence).toBeGreaterThan(0.9)
    expect(analysis.questions[0]?.options.find((option) => option.isCorrect)?.id).toBe('C')
})

test('extractQuestionsFromDocumentText keeps parsing options when answer hints appear before the option block', async () => {
    const {
        extractQuestionsFromDocumentText,
    } = await aiServicePromise

    const analysis = extractQuestionsFromDocumentText(answerBeforeOptionsPdfMcqText)

    expect(analysis.detectedAsMcqDocument).toBe(true)
    expect(analysis.questions).toHaveLength(5)
    expect(analysis.answerHintCount).toBe(5)
    expect(analysis.expectedQuestionCount).toBe(5)
    expect(analysis.exactMatchAchieved).toBe(true)
    expect(analysis.invalidQuestionNumbers).toEqual([])
    expect(analysis.missingQuestionNumbers).toEqual([])
    expect(analysis.questions[0]?.options).toEqual([
        { id: 'A', text: '1 × 3', isCorrect: true },
        { id: 'B', text: '3 × 1', isCorrect: false },
        { id: 'C', text: '1 × 1', isCorrect: false },
        { id: 'D', text: '3 × 3', isCorrect: false },
    ])
    expect(analysis.questions[1]?.options.find((option) => option.isCorrect)?.id).toBe('C')
    expect(analysis.questions[3]?.options.find((option) => option.isCorrect)?.id).toBe('D')
})

test('extractQuestionsFromDocumentText parses header-only numbered blocks that carry answer hints on the first line', async () => {
    const {
        extractQuestionsFromDocumentText,
    } = await aiServicePromise

    const analysis = extractQuestionsFromDocumentText(answerInHeaderPsychologyMcqText)

    expect(analysis.detectedAsMcqDocument).toBe(true)
    expect(analysis.questions).toHaveLength(5)
    expect(analysis.answerHintCount).toBe(5)
    expect(analysis.expectedQuestionCount).toBe(5)
    expect(analysis.exactMatchAchieved).toBe(true)
    expect(analysis.invalidQuestionNumbers).toEqual([])
    expect(analysis.duplicateQuestionNumbers).toEqual([])
    expect(analysis.questions[0]?.stem).toContain("In Jensen's hierarchical model")
    expect(analysis.questions[0]?.options.find((option) => option.isCorrect)?.id).toBe('A')
    expect(analysis.questions[2]?.stem).toBe('Match the correct pair:')
    expect(analysis.questions[2]?.sharedContext).toContain('List I (Assessment Method)')
    expect(analysis.questions[2]?.sharedContext).toContain('A. Interview — 1. In-depth study of an individual\'s psychological history')
    expect(analysis.questions[2]?.options.find((option) => option.isCorrect)?.id).toBe('A')
    expect(analysis.questions[4]?.options.find((option) => option.isCorrect)?.id).toBe('B')
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
    expect(analysis.questions[0]?.answerSource).toBe('ANSWER_KEY')
    expect(analysis.questions[0]?.extractionMode).toBe('TEXT_EXACT')
})

test('extractQuestionsFromDocumentText splits embedded explicit question starts instead of swallowing them into the previous block', async () => {
    const {
        extractQuestionsFromDocumentText,
    } = await aiServicePromise

    const embeddedExplicitQuestionText = `
Q1. Alpha beta gamma?
(A) One
(B) Two
(C) Three
(D) Four
ANSWER (A) One
Q2. Marketable securities are treated as
(A) Cash equivalents if readily convertible into cash
(B) Long-term investments only
(C) Operating assets
(D) Financing items
ANSWER (A) Cash equivalents if readily convertible into cash

Q3. Another valid question?
(A) Alpha
(B) Beta
(C) Gamma
(D) Delta
ANSWER (B) Beta

Q4. Fourth valid question?
(A) Red
(B) Blue
(C) Green
(D) Yellow
ANSWER (C) Green

Q5. Fifth valid question?
(A) Cat
(B) Dog
(C) Bird
(D) Fish
ANSWER (D) Fish
`

    const analysis = extractQuestionsFromDocumentText(embeddedExplicitQuestionText)

    expect(analysis.questions).toHaveLength(5)
    expect(analysis.expectedQuestionCount).toBe(5)
    expect(analysis.exactMatchAchieved).toBe(true)
    expect(analysis.missingQuestionNumbers).toEqual([])
    expect(analysis.invalidQuestionNumbers).toEqual([])
    expect(analysis.questions[1]?.stem).toBe('Marketable securities are treated as')
    expect(analysis.questions[1]?.options.find((option) => option.isCorrect)?.id).toBe('A')
})

test('extractQuestionsFromDocumentText keeps the first numbered blocks when a later partial paper repeats question numbers', async () => {
    const {
        extractQuestionsFromDocumentText,
    } = await aiServicePromise

    const partialRepeatedSequenceText = `
Q1. First section question 1
(A) One
(B) Two
(C) Three
(D) Four
ANSWER (A) One

Q2. First section question 2
(A) One
(B) Two
(C) Three
(D) Four
ANSWER (B) Two

Q3. First section question 3
(A) One
(B) Two
(C) Three
(D) Four
ANSWER (C) Three

Q4. First section question 4
(A) One
(B) Two
(C) Three
(D) Four
ANSWER (D) Four

Q5. First section question 5
(A) One
(B) Two
(C) Three
(D) Four
ANSWER (A) One

Q4. Second section repeated question 4 with a longer explanation line that should not replace the original.
(A) Wrong
(B) Wrong
(C) Wrong
(D) Wrong
ANSWER (B) Wrong

Q5. Second section repeated question 5 with a longer explanation line that should not replace the original.
(A) Wrong
(B) Wrong
(C) Wrong
(D) Wrong
ANSWER (C) Wrong
`

    const analysis = extractQuestionsFromDocumentText(partialRepeatedSequenceText)

    expect(analysis.exactMatchAchieved).toBe(true)
    expect(analysis.questions).toHaveLength(5)
    expect(analysis.missingQuestionNumbers).toEqual([])
    expect(analysis.questions[3]?.stem).toContain('First section question 4')
    expect(analysis.questions[4]?.stem).toContain('First section question 5')
    expect(analysis.questions[3]?.options.find((option) => option.isCorrect)?.id).toBe('D')
    expect(analysis.questions[4]?.options.find((option) => option.isCorrect)?.id).toBe('A')
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

test('extractQuestionsFromDocumentText tolerates OCR-dropped Q in "ues 1." prefixes', async () => {
    const {
        extractQuestionsFromDocumentText,
    } = await aiServicePromise

    const analysis = extractQuestionsFromDocumentText(`
REASONING
UNIT 5: RANKINGS
ues 1. Rajiv is 10th from the top and 20th from the bottom in a class. How many students are there in the class?
(a) 29
(b) 30
(c) 31
(d) 28
Answer (c)
Ques 2. Sita is 15th from the left and 18th from the right in a row. What is the total number of girls in the row?
(a) 32
(b) 33
(c) 31
(d) 30
Answer (a)
`)

    expect(analysis.detectedAsMcqDocument).toBe(false)
    expect(analysis.questions).toHaveLength(2)
    expect(analysis.expectedQuestionCount).toBeNull()
    expect(analysis.exactMatchAchieved).toBe(true)
    expect(analysis.questions[0]?.stem).toContain('Rajiv is 10th from the top')
    expect(analysis.questions[0]?.options.find((option) => option.isCorrect)?.id).toBe('C')
    expect(analysis.questions[1]?.options.find((option) => option.isCorrect)?.id).toBe('A')
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

test('extractQuestionsFromDocumentText derives a generic stem for options-only odd-one-out papers', async () => {
    const {
        extractQuestionsFromDocumentText,
    } = await aiServicePromise

    const analysis = extractQuestionsFromDocumentText(`
SECTIONAL MOCKTEST
REASONING
UNIT : ODD - ONE OUT
Q1.
(a) 16
(b) 36
(c) 64
(d) 98
ANSWER: (d)
Q2.
(a) Bat
(b) Sparrow
(c) Eagle
(d) Crow
ANSWER: (a)
`)

    expect(analysis.detectedAsMcqDocument).toBe(false)
    expect(analysis.questions).toHaveLength(2)
    expect(analysis.questions[0]?.stem).toBe('Select the odd one out.')
    expect(analysis.questions[1]?.stem).toBe('Select the odd one out.')
    expect(analysis.questions[0]?.options.find((option) => option.isCorrect)?.id).toBe('D')
    expect(analysis.questions[1]?.options.find((option) => option.isCorrect)?.id).toBe('A')
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

    // Q2 – match-the-following: List I/List II rows should be preserved as shared context,
    // while lowercase (a-d) lines remain the answer options.
    expect(analysis.questions[1]?.stem).toBe('Match the following common names of phenols with their IUPAC names:')
    expect(analysis.questions[1]?.sharedContext).toContain('List I')
    expect(analysis.questions[1]?.sharedContext).toContain('A. Catechol')
    expect(analysis.questions[1]?.sharedContext).toContain('1. Benzene-1,4-diol')
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

test('extractQuestionsFromDocumentText keeps emoji answer lines and explanation numbers inside the current block', async () => {
    const {
        extractQuestionsFromDocumentText,
    } = await aiServicePromise

    const analysis = extractQuestionsFromDocumentText(emojiAnswerOutlierMcqText)

    expect(analysis.detectedAsMcqDocument).toBe(true)
    expect(analysis.questions).toHaveLength(5)
    expect(analysis.candidateBlockCount).toBe(5)
    expect(analysis.expectedQuestionCount).toBe(5)
    expect(analysis.exactMatchAchieved).toBe(true)
    expect(analysis.answerHintCount).toBe(5)
    expect(analysis.invalidQuestionNumbers).toEqual([])
    expect(analysis.missingQuestionNumbers).toEqual([])
    expect(analysis.duplicateQuestionNumbers).toEqual([])
    expect(analysis.questions[0]?.options.find((option) => option.isCorrect)?.id).toBe('C')
    expect(analysis.questions[0]?.options[3]?.text).toBe('Meteors')
    expect(analysis.questions[2]?.options.find((option) => option.isCorrect)?.id).toBe('A')
    expect(analysis.questions[2]?.explanation).toContain("That's 363 not 364")
    expect(analysis.questions[3]?.options.find((option) => option.isCorrect)?.id).toBe('C')
    expect(analysis.questions[4]?.options.find((option) => option.isCorrect)?.id).toBe('B')
    expect(analysis.questions[4]?.options[3]?.text).toBe('Rabbit')
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
