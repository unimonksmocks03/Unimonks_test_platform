import { expect, test } from 'vitest'

import { annotateQuestionsWithReferencePolicy, classifyQuestionReference } from '@/lib/services/reference-classifier'
import type { GeneratedQuestion } from '@/lib/services/ai-service.types'

function createQuestion(overrides: Partial<GeneratedQuestion> = {}): GeneratedQuestion {
    return {
        stem: 'Recovered question stem',
        options: [
            { id: 'A', text: 'Option A', isCorrect: true },
            { id: 'B', text: 'Option B', isCorrect: false },
            { id: 'C', text: 'Option C', isCorrect: false },
            { id: 'D', text: 'Option D', isCorrect: false },
        ],
        explanation: 'Explanation',
        difficulty: 'MEDIUM',
        topic: 'General',
        sharedContext: null,
        sourceSnippet: 'Recovered question stem',
        sharedContextEvidence: null,
        extractionMode: 'TEXT_EXACT',
        ...overrides,
    }
}

test('classifies clean passages as text references', () => {
    const result = classifyQuestionReference(createQuestion({
        stem: 'Based on the following passage, answer the question.',
        sharedContext: 'Read the following passage about economic planning and answer the questions that follow. The passage discusses reforms, public investment, and rural employment in detail.',
    }))

    expect(result.kind).toBe('PASSAGE')
    expect(result.mode).toBe('TEXT')
    expect(result.title).toBe('Passage reference')
})

test('classifies clean data grids as text tables', () => {
    const result = classifyQuestionReference(createQuestion({
        stem: 'Using the following table, answer the question.',
        sharedContext: 'Year 2020 2021 2022\nA 10 15 20\nB 12 18 24\nC 8 16 32',
    }))

    expect(result.kind).toBe('TABLE')
    expect(result.mode).toBe('TEXT')
    expect(result.title).toBe('Data table')
})

test('classifies uncertain table-like content as hybrid', () => {
    const result = classifyQuestionReference(createQuestion({
        stem: 'Based on the following data, answer the question.',
        sharedContext: 'The following data appears below.\n2019 2020 2021\nA 14 15\nB 18 19',
    }))

    expect(result.kind).toBe('TABLE')
    expect(result.mode).toBe('HYBRID')
})

test('classifies match-the-following blocks as text references', () => {
    const result = classifyQuestionReference(createQuestion({
        stem: 'Match the correct pair.',
        sharedContext: 'List I\nA. River\nB. Mountain\nList II\n1. Nile\n2. Himalaya',
    }))

    expect(result.kind).toBe('LIST_MATCH')
    expect(result.mode).toBe('TEXT')
    expect(result.title).toBe('Match-the-following reference')
})

test('classifies visual reasoning blocks as snapshots', () => {
    const result = classifyQuestionReference(createQuestion({
        stem: 'Find the missing figure.',
        sharedContext: 'Figure series with squares and circles arranged in a 3x3 grid.',
        sourceSnippet: '★ ☆ ○ □ △',
    }))

    expect(result.kind).toBe('DIAGRAM')
    expect(result.mode).toBe('SNAPSHOT')
    expect(result.title).toBe('Diagram reference')
})

test('classifies graphs as snapshot references', () => {
    const result = classifyQuestionReference(createQuestion({
        stem: 'Based on the bar graph, answer the question.',
        sharedContext: 'Bar graph showing population by year with X-axis and Y-axis labels.',
    }))

    expect(result.kind).toBe('GRAPH')
    expect(result.mode).toBe('SNAPSHOT')
    expect(result.title).toBe('Bar graph')
})

test('annotates questions with policy fields', () => {
    const [question] = annotateQuestionsWithReferencePolicy([
        createQuestion({
            stem: 'Find the missing figure.',
            sharedContext: 'Figure pattern with shaded triangles and circles.',
        }),
    ])

    expect(question.referenceKind).toBe('DIAGRAM')
    expect(question.referenceMode).toBe('SNAPSHOT')
    expect(question.referenceTitle).toBe('Diagram reference')
})
