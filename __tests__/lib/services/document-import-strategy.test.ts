import { afterEach, expect, test, vi } from 'vitest'

import {
    answerInHeaderPsychologyMcqText,
    extractableFigureReasoningPdfText,
    humanGeoDocxLikeMcqText,
    studyMaterialNotesText,
    tableHeavyQuantPdfText,
    visualReasoningPdfText,
} from '@/__tests__/fixtures/imports'
import { classifyDocumentForImport } from '@/lib/services/document-classifier'
import {
    isClassifierRoutingEnabled,
    resolveDocumentImportPlan,
} from '@/lib/services/document-import-strategy'

afterEach(() => {
    vi.unstubAllEnvs()
})

test('resolveDocumentImportPlan keeps legacy routing inert when classifier routing is disabled', () => {
    const classification = classifyDocumentForImport({
        fileName: 'physics-1-mcq.pdf',
        text: humanGeoDocxLikeMcqText,
    })

    const plan = resolveDocumentImportPlan({
        classifierRoutingEnabled: false,
        classification,
        isPdfUpload: true,
    })

    expect(plan.routingMode).toBe('LEGACY')
    expect(plan.runMultimodalFirst).toBe(false)
    expect(plan.visualReferenceOverlay).toBe(false)
    expect(plan.generateFromSource).toBe(false)
    expect(plan.selectedStrategy).toBe(classification.preferredStrategy)
})

test('isClassifierRoutingEnabled defaults to enabled when the env is unset', () => {
    vi.stubEnv('DOCUMENT_IMPORT_CLASSIFIER_ROUTING', undefined)

    expect(isClassifierRoutingEnabled()).toBe(true)
})

test('isClassifierRoutingEnabled can still be disabled explicitly', () => {
    vi.stubEnv('DOCUMENT_IMPORT_CLASSIFIER_ROUTING', 'false')

    expect(isClassifierRoutingEnabled()).toBe(false)
})

test('resolveDocumentImportPlan promotes risky table-heavy PDFs to multimodal-first when classifier routing is enabled', () => {
    const classification = classifyDocumentForImport({
        fileName: 'quant-data-interpretation.pdf',
        text: tableHeavyQuantPdfText,
    })

    const plan = resolveDocumentImportPlan({
        classifierRoutingEnabled: true,
        classification,
        isPdfUpload: true,
    })

    expect(plan.routingMode).toBe('CLASSIFIER')
    expect(plan.selectedStrategy).toBe('MULTIMODAL_EXTRACT')
    expect(plan.runMultimodalFirst).toBe(true)
    expect(plan.visualReferenceOverlay).toBe(false)
    expect(plan.generateFromSource).toBe(false)
})

test('resolveDocumentImportPlan routes match-following and assertion papers to multimodal-first PDFs', () => {
    const classification = classifyDocumentForImport({
        fileName: 'psychology-1.pdf',
        text: answerInHeaderPsychologyMcqText,
    })

    const plan = resolveDocumentImportPlan({
        classifierRoutingEnabled: true,
        classification,
        isPdfUpload: true,
    })

    expect(plan.selectedStrategy).toBe('MULTIMODAL_EXTRACT')
    expect(plan.runMultimodalFirst).toBe(true)
    expect(plan.visualReferenceOverlay).toBe(false)
    expect(plan.generateFromSource).toBe(false)
})

test('resolveDocumentImportPlan routes source material to generation mode when classifier routing is enabled', () => {
    const classification = classifyDocumentForImport({
        fileName: 'chapter-6-notes.docx',
        text: studyMaterialNotesText,
    })

    const plan = resolveDocumentImportPlan({
        classifierRoutingEnabled: true,
        classification,
        isPdfUpload: false,
    })

    expect(plan.selectedStrategy).toBe('GENERATE_FROM_SOURCE')
    expect(plan.generateFromSource).toBe(true)
    expect(plan.runMultimodalFirst).toBe(false)
    expect(plan.visualReferenceOverlay).toBe(false)
})

test('resolveDocumentImportPlan normalizes non-pdf multimodal preference into hybrid reconcile', () => {
    const classification = classifyDocumentForImport({
        fileName: 'table-heavy.docx',
        text: tableHeavyQuantPdfText,
    })

    const plan = resolveDocumentImportPlan({
        classifierRoutingEnabled: true,
        classification,
        isPdfUpload: false,
    })

    expect(classification.preferredStrategy).toBe('MULTIMODAL_EXTRACT')
    expect(plan.selectedStrategy).toBe('HYBRID_RECONCILE')
    expect(plan.runMultimodalFirst).toBe(false)
    expect(plan.visualReferenceOverlay).toBe(false)
})

test('resolveDocumentImportPlan routes weak diagram-heavy PDFs to multimodal extraction', () => {
    const classification = classifyDocumentForImport({
        fileName: 'REASONING MOCKTEST VENN DIAGRAM.pdf',
        text: visualReasoningPdfText,
    })

    const plan = resolveDocumentImportPlan({
        classifierRoutingEnabled: true,
        classification,
        isPdfUpload: true,
    })

    expect(plan.selectedStrategy).toBe('MULTIMODAL_EXTRACT')
    expect(plan.runMultimodalFirst).toBe(true)
    expect(plan.visualReferenceOverlay).toBe(false)
    expect(plan.manualVisualReferenceCapture).toBe(false)
})

test('resolveDocumentImportPlan routes strong-OCR diagram-heavy PDFs to hybrid reconcile with manual visual capture', () => {
    const classification = classifyDocumentForImport({
        fileName: 'REASONING MOCKTEST FIGURE COMPLETION.pdf',
        text: extractableFigureReasoningPdfText,
    })

    const plan = resolveDocumentImportPlan({
        classifierRoutingEnabled: true,
        classification,
        isPdfUpload: true,
    })

    expect(plan.selectedStrategy).toBe('HYBRID_RECONCILE')
    expect(plan.runMultimodalFirst).toBe(false)
    expect(plan.visualReferenceOverlay).toBe(false)
    expect(plan.manualVisualReferenceCapture).toBe(true)
})

test('resolveDocumentImportPlan assigns STABLE lane to clean text-exact papers', () => {
    const classification = classifyDocumentForImport({
        fileName: 'physics-1-mcq.pdf',
        text: humanGeoDocxLikeMcqText,
    })

    const plan = resolveDocumentImportPlan({
        classifierRoutingEnabled: true,
        classification,
        isPdfUpload: true,
    })

    expect(plan.lane).toBe('STABLE')
    expect(plan.selectedStrategy).toBe('TEXT_EXACT')
})

test('resolveDocumentImportPlan assigns ADVANCED lane to multimodal-first PDFs', () => {
    const classification = classifyDocumentForImport({
        fileName: 'quant-data-interpretation.pdf',
        text: tableHeavyQuantPdfText,
    })

    const plan = resolveDocumentImportPlan({
        classifierRoutingEnabled: true,
        classification,
        isPdfUpload: true,
    })

    expect(plan.lane).toBe('ADVANCED')
    expect(plan.selectedStrategy).toBe('MULTIMODAL_EXTRACT')
})

test('resolveDocumentImportPlan assigns ADVANCED lane to strong-OCR diagram-heavy hybrid papers', () => {
    const classification = classifyDocumentForImport({
        fileName: 'REASONING MOCKTEST FIGURE COMPLETION.pdf',
        text: extractableFigureReasoningPdfText,
    })

    const plan = resolveDocumentImportPlan({
        classifierRoutingEnabled: true,
        classification,
        isPdfUpload: true,
    })

    expect(plan.lane).toBe('ADVANCED')
    expect(plan.selectedStrategy).toBe('HYBRID_RECONCILE')
})

test('resolveDocumentImportPlan assigns STABLE lane when classifier routing is disabled', () => {
    const classification = classifyDocumentForImport({
        fileName: 'quant-data-interpretation.pdf',
        text: tableHeavyQuantPdfText,
    })

    const plan = resolveDocumentImportPlan({
        classifierRoutingEnabled: false,
        classification,
        isPdfUpload: true,
    })

    expect(plan.routingMode).toBe('LEGACY')
    expect(plan.lane).toBe('STABLE')
})
