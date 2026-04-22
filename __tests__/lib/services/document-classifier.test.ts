import { expect, test } from 'vitest'

import {
    answerInHeaderPsychologyMcqText,
    extractableFigureReasoningPdfText,
    humanGeoDocxLikeMcqText,
    lowTextScannedPdfText,
    oddOneOutPdfText,
    physicsPdfLikeMcqText,
    studyMaterialNotesText,
    tableHeavyQuantPdfText,
    visualReasoningPdfText,
} from '@/__tests__/fixtures/imports'
import { classifyDocumentForImport } from '@/lib/services/document-classifier'

test('classifyDocumentForImport marks clean born-digital MCQ papers as text-exact', () => {
    const result = classifyDocumentForImport({
        fileName: 'physics-1-mcq.pdf',
        text: physicsPdfLikeMcqText,
    })

    expect(result.documentType).toBe('MCQ_PAPER')
    expect(result.layoutRisk).toBe('LOW')
    expect(result.preferredStrategy).toBe('TEXT_EXACT')
    expect(result.hasTables).toBe(false)
    expect(result.hasMatchFollowing).toBe(false)
})

test('classifyDocumentForImport keeps answer-key heavy docx mocks in text-exact mode', () => {
    const result = classifyDocumentForImport({
        fileName: 'human-geo.docx',
        text: humanGeoDocxLikeMcqText,
    })

    expect(result.documentType).toBe('MCQ_PAPER')
    expect(result.preferredStrategy).toBe('TEXT_EXACT')
    expect(result.layoutRisk).toBe('LOW')
})

test('classifyDocumentForImport routes assertion and match-following papers to multimodal extraction', () => {
    const result = classifyDocumentForImport({
        fileName: 'sectional-mocktest-psychology-1.pdf',
        text: answerInHeaderPsychologyMcqText,
    })

    expect(result.documentType).toBe('MCQ_PAPER')
    expect(result.hasAssertionReason).toBe(true)
    expect(result.hasMatchFollowing).toBe(true)
    expect(result.preferredStrategy).toBe('MULTIMODAL_EXTRACT')
    expect(result.layoutRisk).toBe('MEDIUM')
})

test('classifyDocumentForImport routes table-heavy MCQ papers to multimodal extraction', () => {
    const result = classifyDocumentForImport({
        fileName: 'QUANT MOCKTEST DATA INTERPRETATION.pdf',
        text: tableHeavyQuantPdfText,
    })

    expect(result.documentType).toBe('MCQ_PAPER')
    expect(result.hasTables).toBe(true)
    expect(result.preferredStrategy).toBe('MULTIMODAL_EXTRACT')
    expect(result.layoutRisk).toBe('HIGH')
})

test('classifyDocumentForImport routes weak visual reasoning papers to multimodal extraction', () => {
    const result = classifyDocumentForImport({
        fileName: 'REASONING MOCKTEST VENN DIAGRAM.pdf',
        text: visualReasoningPdfText,
    })

    expect(result.documentType).toBe('MCQ_PAPER')
    expect(result.hasVisualReferences).toBe(true)
    expect(result.hasDiagramReasoning).toBe(true)
    expect(result.preferredStrategy).toBe('MULTIMODAL_EXTRACT')
    expect(result.layoutRisk).toBe('HIGH')
})

test('classifyDocumentForImport routes diagram-heavy reasoning papers with strong OCR to hybrid reconcile', () => {
    const result = classifyDocumentForImport({
        fileName: 'REASONING MOCKTEST FIGURE COMPLETION.pdf',
        text: extractableFigureReasoningPdfText,
    })

    expect(result.documentType).toBe('MCQ_PAPER')
    expect(result.hasVisualReferences).toBe(true)
    expect(result.hasDiagramReasoning).toBe(true)
    expect(result.preferredStrategy).toBe('HYBRID_RECONCILE')
    expect(result.layoutRisk).toBe('HIGH')
})

test('classifyDocumentForImport does not treat table-tennis odd-one-out papers as table-heavy', () => {
    const result = classifyDocumentForImport({
        fileName: 'REASONING MOCKTEST ODD ONE OUT.pdf',
        text: oddOneOutPdfText,
    })

    expect(result.hasTables).toBe(false)
    expect(result.hasVisualReferences).toBe(false)
    expect(result.hasDiagramReasoning).toBe(false)
    expect(result.preferredStrategy).toBe('TEXT_EXACT')
})

test('classifyDocumentForImport routes source material to generation mode', () => {
    const result = classifyDocumentForImport({
        fileName: 'chapter-6-notes.docx',
        text: studyMaterialNotesText,
    })

    expect(result.documentType).toBe('SOURCE_MATERIAL')
    expect(result.preferredStrategy).toBe('GENERATE_FROM_SOURCE')
})

test('classifyDocumentForImport does not treat sports MCQs mentioning "table tennis table" or "specialist identifiable" as table/match-heavy', () => {
    const sportsMcqText = `
CUET (UG) – Physical Education
UNIT – III: Theoretical Aspects of Games, Sports & Yogic Practice
1. The dimensions of an official table tennis table are:
A) 2.40 m x 1.20 m
B) 2.74 m x 1.52 m
C) 3.00 m x 1.50 m
D) 2.00 m x 1.00 m
Correct Answer: B) 2.74 m x 1.525 m
Explanation: An official ITTF table tennis table is 2.74 m long.
2. The 'Libero' in volleyball is a specialist player who:
A) Can serve and spike without restriction
B) Is a defensive specialist who wears a different coloured jersey
C) Plays only in the front row
D) Acts as team captain exclusively
Correct Answer: B)
Explanation: The Libero is a back-row defensive specialist identifiable by a contrasting jersey.
3. An 'indoor' sport from the following list is:
A) Football
B) Hockey
C) Athletics
D) Table Tennis
Correct Answer: D)
`

    const result = classifyDocumentForImport({
        fileName: 'CUET_PhysEd_Unit3_MockTest.pdf',
        text: sportsMcqText,
    })

    expect(result.documentType).toBe('MCQ_PAPER')
    expect(result.hasTables).toBe(false)
    expect(result.hasMatchFollowing).toBe(false)
    expect(result.preferredStrategy).toBe('TEXT_EXACT')
    expect(result.layoutRisk).toBe('LOW')
})

test('classifyDocumentForImport treats low-text PDFs as scanned-like and multimodal-first', () => {
    const result = classifyDocumentForImport({
        fileName: 'scan-heavy-paper.pdf',
        text: lowTextScannedPdfText,
    })

    expect(result.isScannedLike).toBe(true)
    expect(result.layoutRisk).toBe('HIGH')
    expect(result.preferredStrategy).toBe('MULTIMODAL_EXTRACT')
})

test('classifyDocumentForImport treats parse failures on PDFs as scanned-like risk', () => {
    const result = classifyDocumentForImport({
        fileName: 'broken.pdf',
        text: '',
        parseFailed: true,
    })

    expect(result.isScannedLike).toBe(true)
    expect(result.preferredStrategy).toBe('MULTIMODAL_EXTRACT')
})
