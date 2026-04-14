export type ImportRegressionFixture = {
    id: string
    sourceLabel: string
    fileName: string
    expectedQuestionCount: number
    expectedDocumentType: 'MCQ_PAPER' | 'SOURCE_MATERIAL'
    expectedPreferredStrategy: 'TEXT_EXACT' | 'MULTIMODAL_EXTRACT' | 'HYBRID_RECONCILE' | 'GENERATE_FROM_SOURCE'
    expectedSelectedStrategy: 'TEXT_EXACT' | 'MULTIMODAL_EXTRACT' | 'HYBRID_RECONCILE' | 'GENERATE_FROM_SOURCE'
    expectedLane: 'STABLE' | 'ADVANCED'
    requiresVisualSnapshot: boolean
    acceptableDecision: 'EXACT_ACCEPTED' | 'REVIEW_REQUIRED'
    tags: string[]
    text: string
}

export const physicsPdfLikeMcqText = `
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

export const humanGeoDocxLikeMcqText = `
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

export const answerInHeaderPsychologyMcqText = `
GAT MOCKTEST
UNIT 1 : VARIATIONS IN PSYCHOLOGICAL ATTRIBUTES
1 ANSWER(a)
Assertion (A): In Jensen's hierarchical model, Level I involves associative learning where output is more or less similar to input.
Reason (R): Level I mainly includes rote learning and memory-type tasks.
(a) Both A and R are true, and R is the correct explanation of A
(b) Both A and R are true, but R is not the correct explanation of A
(c) A is true but R is false
(d) A is false but R is true
2 ANSWER(a)
Assertion (A): In Sternberg's triarchic theory, contextual intelligence is also called practical intelligence.
Reason (R): Contextual intelligence helps people deal with everyday environmental demands and is often termed "street smartness".
(a) Both A and R are true, and R is the correct explanation of A
(b) Both A and R are true, but R is not the correct explanation of A
(c) A is true but R is false
(d) A is false but R is true
3 ANSWER(a)
Match the correct pair:
List I (Assessment Method) — List II (Description)
A. Interview — 1. In-depth study of an individual's psychological history
B. Case Study — 2. One-to-one seeking information
C. Observation — 3. Systematic recording of behaviour in real time
D. Self-report — 4. Person provides factual information/opinions about self
(a) A-2, B-1, C-3, D-4
(b) A-1, B-2, C-4, D-3
(c) A-3, B-1, C-2, D-4
(d) A-2, B-3, C-1, D-4
4 ANSWER(b)
Which statement(s) is/are correct?
1. Psychometric approach treats intelligence as an aggregate of abilities.
2. Information-processing approach focuses on how an intelligent person acts.
3. Information-processing approach primarily focuses on a single index score.
(a) 1 and 3 only
(b) 1 and 2 only
(c) 2 and 3 only
(d) 1, 2 and 3
5 ANSWER(b)
Alfred Binet was the first psychologist to:
(a) Propose multiple intelligences theory
(b) Work on intelligence and formally measure it
(c) Develop the concept of IQ
(d) Study twins for intelligence research
`

export const tableHeavyQuantPdfText = `
UNIT 12: DATA INTERPRETATION
SET 1: TABLE – PRODUCTION OF CARS (in thousands)
The following table shows the production of cars by 5 companies over 5 years:
Company 2018 2019 2020 2021 2022
A 45 50 40 55 60
B 30 35 25 40 50
C 55 60 45 50 65
D 40 45 35 60 55
E 35 40 30 45 70

Q1. What is the total production of Company A over all five years?
(A) 240
(B) 250
(C) 260
(D) 270
Answer: (B)

Q2. Which company had the highest production in 2022?
(A) A
(B) C
(C) D
(D) E
Answer: (E)
`

export const visualReasoningPdfText = `
SECTIONAL MOCKTEST
REASONING
UNIT : VENN DIAGRAM
Directions (Q1-Q5):
Study the following Venn diagram and answer the questions:
[diagram omitted]
Q1. How many students play exactly two games?
(a) 22 (b) 24 (c) 27 (d) 29
Answer: (c)
Q2. How many students play at least one game?
(a) 92 (b) 96 (c) 98 (d) 104
Answer: (c)
`

export const extractableFigureReasoningPdfText = `
SECTIONAL MOCKTEST
REASONING
UNIT : FIGURE COMPLETION
Q1. Find the missing figure:
┌─────────┬─────────┬─────────┐
│ ★ ★ ★ │ ★ ★ ☆ │ ★ ☆ ☆ │
├─────────┼─────────┼─────────┤
│ ☆ ★ ★ │ ☆ ★ ☆ │ ☆ ☆ ☆ │
├─────────┼─────────┼─────────┤
│ ☆ ☆ ★ │ ☆ ☆ ☆ │ ? │
└─────────┴─────────┴─────────┘
(a) ☆ ☆ ☆
(b) ★ ★ ★
(c) ☆ ★ ☆
(d) ★ ☆ ★
Answer: (a)
Q2. Find the missing figure:
┌─────────┬─────────┬─────────┐
│ ● ○ ○ │ ○ ● ○ │ ○ ○ ● │
├─────────┼─────────┼─────────┤
│ ○ ○ ● │ ● ○ ○ │ ○ ● ○ │
├─────────┼─────────┼─────────┤
│ ○ ● ○ │ ○ ○ ● │ ? │
└─────────┴─────────┴─────────┘
(a) ○ ○ ●
(b) ● ○ ○
(c) ○ ● ○
(d) ● ● ○
Answer: (b)
Q3. Find the missing figure:
┌─────────┬─────────┬─────────┐
│ △ │ □ │ ○ │
│ ■ ■ │ ● ● │ ▲ ▲ │
│ △ △ △ │ □ □ □ │ ○ ○ ○ │
├─────────┼─────────┼─────────┤
│ □ │ ○ │ △ │
│ ● ● │ ▲ ▲ │ ■ ■ │
│ □ □ □ │ ○ ○ ○ │ △ △ △ │
├─────────┼─────────┼─────────┤
│ ○ │ △ │ ? │
│ ▲ ▲ │ ■ ■ │ ? │
│ ○ ○ ○ │ △ △ △ │ ? │
└─────────┴─────────┴─────────┘
(a) □ / ● ● / □ □ □
(b) △ / ■ ■ / △ △ △
(c) ○ / ▲ ▲ / ○ ○ ○
(d) □ / ▲ ▲ / □ □ □
Answer: (a)
`

export const figureFormationPdfText = `
SECTIONAL MOCKTEST
REASONING
UNIT : FIGURE FORMATION

Q1. How many triangles are in the following figure?
/\\ /\\ /\\
\\//\\//\\/
(a) 10
(b) 12
(c) 14
(d) 16
Answer: (d)

Q2. Which option can be formed by joining the pieces shown in the figure?
[shape omitted]
(a) Option A
(b) Option B
(c) Option C
(d) Option D
Answer: (b)

Q3. Which option completes the figure pattern?
[pattern omitted]
(a) Option A
(b) Option B
(c) Option C
(d) Option D
Answer: (a)
`

export const oddOneOutPdfText = `
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
Q30.
(a) Badminton
(b) Tennis
(c) Football
(d) Table Tennis
ANSWER: (d)
`

export const rankingsPdfText = `
SECTIONAL MOCKTEST
REASONING
UNIT : RANKINGS
Q1. In a class, A is ranked 5th from the left and 18th from the right. How many students are there?
(a) 20
(b) 21
(c) 22
(d) 23
Answer: (c)
Q2. P is 9 ranks ahead of Q in a class of 40. If Q's rank from the last is 17, what is P's rank from the front?
(a) 15
(b) 16
(c) 17
(d) 18
Answer: (a)
Q3. In a row of girls, Reena is 7th from the left and Kavya is 11th from the right. If they interchange positions, Reena becomes 19th from the left. How many girls are there?
(a) 28
(b) 29
(c) 30
(d) 31
Answer: (b)
`

export const studyMaterialNotesText = `
Tertiary activities involve the exchange and movement of goods and services.
Quaternary activities are knowledge-oriented and include education, research, and information services.
The chapter explains the difference between producer services and consumer services.
It also covers transport, communication, trade, and tourism as major service-sector examples.
There are no ready-made MCQs, answer keys, or options in this material.
`

export const lowTextScannedPdfText = `
SECTIONAL MOCK TEST
Page 1
Q1
(a)
(b)
`

export const historyHorizontalAnswerKeyDocxText = `
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

export const importRegressionFixtures: ImportRegressionFixture[] = [
    {
        id: 'clean-physics-pdf',
        sourceLabel: 'physics-1-mcq.pdf',
        fileName: 'physics-1-mcq.pdf',
        expectedQuestionCount: 5,
        expectedDocumentType: 'MCQ_PAPER',
        expectedPreferredStrategy: 'TEXT_EXACT',
        expectedSelectedStrategy: 'TEXT_EXACT',
        expectedLane: 'STABLE',
        requiresVisualSnapshot: false,
        acceptableDecision: 'EXACT_ACCEPTED',
        tags: ['pdf', 'born-digital', 'mcq-paper', 'clean-layout'],
        text: physicsPdfLikeMcqText,
    },
    {
        id: 'human-geo-docx',
        sourceLabel: 'XII_human_geography_chapter_1.docx',
        fileName: 'XII_human_geography_chapter_1.docx',
        expectedQuestionCount: 15,
        expectedDocumentType: 'MCQ_PAPER',
        expectedPreferredStrategy: 'TEXT_EXACT',
        expectedSelectedStrategy: 'TEXT_EXACT',
        expectedLane: 'STABLE',
        requiresVisualSnapshot: false,
        acceptableDecision: 'EXACT_ACCEPTED',
        tags: ['docx', 'mcq-paper', 'answer-key'],
        text: humanGeoDocxLikeMcqText,
    },
    {
        id: 'history-horizontal-answer-key-docx',
        sourceLabel: 'CUET_History_Clean_Extractable_50Q_HorizontalAnswerKey.docx',
        fileName: 'CUET_History_Clean_Extractable_50Q_HorizontalAnswerKey.docx',
        expectedQuestionCount: 3,
        expectedDocumentType: 'MCQ_PAPER',
        expectedPreferredStrategy: 'MULTIMODAL_EXTRACT',
        expectedSelectedStrategy: 'HYBRID_RECONCILE',
        expectedLane: 'ADVANCED',
        requiresVisualSnapshot: false,
        acceptableDecision: 'REVIEW_REQUIRED',
        tags: ['docx', 'mcq-paper', 'horizontal-answer-key'],
        text: historyHorizontalAnswerKeyDocxText,
    },
    {
        id: 'psychology-header-answer',
        sourceLabel: 'SECTIONAL MOCKTEST PSYCHOLOGY 1.pdf',
        fileName: 'SECTIONAL MOCKTEST PSYCHOLOGY 1.pdf',
        expectedQuestionCount: 8,
        expectedDocumentType: 'MCQ_PAPER',
        expectedPreferredStrategy: 'MULTIMODAL_EXTRACT',
        expectedSelectedStrategy: 'MULTIMODAL_EXTRACT',
        expectedLane: 'ADVANCED',
        requiresVisualSnapshot: false,
        acceptableDecision: 'REVIEW_REQUIRED',
        tags: ['pdf', 'mcq-paper', 'assertion-reason', 'match-following', 'header-answer'],
        text: answerInHeaderPsychologyMcqText,
    },
    {
        id: 'quant-table-pdf',
        sourceLabel: 'QUANT MOCKTEST DATA INTERPRETATION.pdf',
        fileName: 'QUANT MOCKTEST DATA INTERPRETATION.pdf',
        expectedQuestionCount: 2,
        expectedDocumentType: 'MCQ_PAPER',
        expectedPreferredStrategy: 'MULTIMODAL_EXTRACT',
        expectedSelectedStrategy: 'MULTIMODAL_EXTRACT',
        expectedLane: 'ADVANCED',
        requiresVisualSnapshot: false,
        acceptableDecision: 'REVIEW_REQUIRED',
        tags: ['pdf', 'mcq-paper', 'table-heavy', 'shared-context'],
        text: tableHeavyQuantPdfText,
    },
    {
        id: 'venn-diagram-pdf',
        sourceLabel: 'REASONING MOCKTEST VENN DIAGRAM.pdf',
        fileName: 'REASONING MOCKTEST VENN DIAGRAM.pdf',
        expectedQuestionCount: 2,
        expectedDocumentType: 'MCQ_PAPER',
        expectedPreferredStrategy: 'MULTIMODAL_EXTRACT',
        expectedSelectedStrategy: 'MULTIMODAL_EXTRACT',
        expectedLane: 'ADVANCED',
        requiresVisualSnapshot: true,
        acceptableDecision: 'REVIEW_REQUIRED',
        tags: ['pdf', 'mcq-paper', 'visual-reference', 'diagram'],
        text: visualReasoningPdfText,
    },
    {
        id: 'figure-completion-pdf',
        sourceLabel: 'REASONING MOCKTEST FIGURE COMPLETION.pdf',
        fileName: 'REASONING MOCKTEST FIGURE COMPLETION.pdf',
        expectedQuestionCount: 3,
        expectedDocumentType: 'MCQ_PAPER',
        expectedPreferredStrategy: 'HYBRID_RECONCILE',
        expectedSelectedStrategy: 'HYBRID_RECONCILE',
        expectedLane: 'ADVANCED',
        requiresVisualSnapshot: true,
        acceptableDecision: 'REVIEW_REQUIRED',
        tags: ['pdf', 'mcq-paper', 'figure-completion', 'diagram'],
        text: extractableFigureReasoningPdfText,
    },
    {
        id: 'figure-formation-pdf',
        sourceLabel: 'REASONING MOCKTEST FIGURE FORMATION.pdf',
        fileName: 'REASONING MOCKTEST FIGURE FORMATION.pdf',
        expectedQuestionCount: 3,
        expectedDocumentType: 'MCQ_PAPER',
        expectedPreferredStrategy: 'HYBRID_RECONCILE',
        expectedSelectedStrategy: 'HYBRID_RECONCILE',
        expectedLane: 'ADVANCED',
        requiresVisualSnapshot: true,
        acceptableDecision: 'REVIEW_REQUIRED',
        tags: ['pdf', 'mcq-paper', 'figure-formation', 'diagram'],
        text: figureFormationPdfText,
    },
    {
        id: 'odd-one-out-pdf',
        sourceLabel: 'REASONING MOCKTEST ODD ONE OUT.pdf',
        fileName: 'REASONING MOCKTEST ODD ONE OUT.pdf',
        expectedQuestionCount: 3,
        expectedDocumentType: 'MCQ_PAPER',
        expectedPreferredStrategy: 'TEXT_EXACT',
        expectedSelectedStrategy: 'TEXT_EXACT',
        expectedLane: 'STABLE',
        requiresVisualSnapshot: false,
        acceptableDecision: 'EXACT_ACCEPTED',
        tags: ['pdf', 'mcq-paper', 'odd-one-out', 'text-first'],
        text: oddOneOutPdfText,
    },
    {
        id: 'rankings-pdf',
        sourceLabel: 'REASONING MOCKTEST RANKINGS.pdf',
        fileName: 'REASONING MOCKTEST RANKINGS.pdf',
        expectedQuestionCount: 3,
        expectedDocumentType: 'MCQ_PAPER',
        expectedPreferredStrategy: 'TEXT_EXACT',
        expectedSelectedStrategy: 'TEXT_EXACT',
        expectedLane: 'STABLE',
        requiresVisualSnapshot: false,
        acceptableDecision: 'EXACT_ACCEPTED',
        tags: ['pdf', 'mcq-paper', 'rankings', 'text-first'],
        text: rankingsPdfText,
    },
    {
        id: 'source-material-notes',
        sourceLabel: 'chapter-6-notes.docx',
        fileName: 'chapter-6-notes.docx',
        expectedQuestionCount: 0,
        expectedDocumentType: 'SOURCE_MATERIAL',
        expectedPreferredStrategy: 'GENERATE_FROM_SOURCE',
        expectedSelectedStrategy: 'GENERATE_FROM_SOURCE',
        expectedLane: 'ADVANCED',
        requiresVisualSnapshot: false,
        acceptableDecision: 'REVIEW_REQUIRED',
        tags: ['docx', 'source-material', 'notes'],
        text: studyMaterialNotesText,
    },
    {
        id: 'scanned-like-pdf',
        sourceLabel: 'scan-heavy-paper.pdf',
        fileName: 'scan-heavy-paper.pdf',
        expectedQuestionCount: 0,
        expectedDocumentType: 'MCQ_PAPER',
        expectedPreferredStrategy: 'MULTIMODAL_EXTRACT',
        expectedSelectedStrategy: 'MULTIMODAL_EXTRACT',
        expectedLane: 'ADVANCED',
        requiresVisualSnapshot: false,
        acceptableDecision: 'REVIEW_REQUIRED',
        tags: ['pdf', 'scan-like', 'low-text'],
        text: lowTextScannedPdfText,
    },
]
