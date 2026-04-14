import type {
    DocumentClassificationResult,
    RecommendedExtractionStrategy,
} from '@/lib/services/document-classifier'

export type DocumentImportRoutingMode = 'LEGACY' | 'CLASSIFIER'
export type DocumentImportLane = 'STABLE' | 'ADVANCED'

export type DocumentImportPlan = {
    routingMode: DocumentImportRoutingMode
    lane: DocumentImportLane
    selectedStrategy: RecommendedExtractionStrategy
    runMultimodalFirst: boolean
    visualReferenceOverlay: boolean
    manualVisualReferenceCapture?: boolean
    generateFromSource: boolean
    reasons: string[]
}

type ResolveDocumentImportPlanInput = {
    classifierRoutingEnabled: boolean
    classification: DocumentClassificationResult
    isPdfUpload: boolean
}

function normalizeStrategyForFileType(
    preferredStrategy: RecommendedExtractionStrategy,
    isPdfUpload: boolean
): RecommendedExtractionStrategy {
    if (isPdfUpload) {
        return preferredStrategy
    }

    if (preferredStrategy === 'MULTIMODAL_EXTRACT') {
        return 'HYBRID_RECONCILE'
    }

    return preferredStrategy
}

function promoteStrategyForRiskSignals(
    selectedStrategy: RecommendedExtractionStrategy,
    classification: DocumentClassificationResult,
    isPdfUpload: boolean,
): {
    selectedStrategy: RecommendedExtractionStrategy
    reasons: string[]
} {
    if (selectedStrategy !== 'TEXT_EXACT') {
        return {
            selectedStrategy,
            reasons: [],
        }
    }

    if (classification.isScannedLike || classification.hasTables || classification.hasPassages || classification.isMixedLayout) {
        return {
            selectedStrategy: isPdfUpload ? 'MULTIMODAL_EXTRACT' : 'HYBRID_RECONCILE',
            reasons: ['Risk override promoted a TEXT_EXACT plan because the classifier still detected scanned, table, passage, or irregular-layout signals.'],
        }
    }

    if (classification.hasVisualReferences) {
        return {
            selectedStrategy: 'HYBRID_RECONCILE',
            reasons: ['Risk override promoted a TEXT_EXACT plan because the classifier detected visual-reference signals.'],
        }
    }

    return {
        selectedStrategy,
        reasons: [],
    }
}

export function isClassifierRoutingEnabled() {
    return process.env.DOCUMENT_IMPORT_CLASSIFIER_ROUTING !== 'false'
}

export function resolveDocumentImportPlan(input: ResolveDocumentImportPlanInput): DocumentImportPlan {
    const normalizedStrategy = normalizeStrategyForFileType(
        input.classification.preferredStrategy,
        input.isPdfUpload,
    )
    const promoted = promoteStrategyForRiskSignals(
        normalizedStrategy,
        input.classification,
        input.isPdfUpload,
    )
    const selectedStrategy = promoted.selectedStrategy

    if (!input.classifierRoutingEnabled) {
        return {
            routingMode: 'LEGACY',
            lane: 'STABLE',
            selectedStrategy,
            runMultimodalFirst: false,
            visualReferenceOverlay: false,
            manualVisualReferenceCapture: false,
            generateFromSource: false,
            reasons: ['Classifier-driven routing is disabled; using legacy import flow.'],
        }
    }

    const manualVisualReferenceCapture =
        input.isPdfUpload
        && input.classification.hasDiagramReasoning
        && !input.classification.isScannedLike
        && selectedStrategy === 'HYBRID_RECONCILE'

    const lane: DocumentImportLane = selectedStrategy === 'TEXT_EXACT'
        ? 'STABLE'
        : 'ADVANCED'

    return {
        routingMode: 'CLASSIFIER',
        lane,
        selectedStrategy,
        runMultimodalFirst:
            input.isPdfUpload
            && selectedStrategy === 'MULTIMODAL_EXTRACT'
            && !manualVisualReferenceCapture,
        visualReferenceOverlay:
            input.isPdfUpload
            && input.classification.hasVisualReferences
            && selectedStrategy === 'HYBRID_RECONCILE'
            && !manualVisualReferenceCapture,
        manualVisualReferenceCapture,
        generateFromSource: selectedStrategy === 'GENERATE_FROM_SOURCE',
        reasons: [
            `Classifier selected ${selectedStrategy} for this document.`,
            `Import lane: ${lane}.`,
            ...(manualVisualReferenceCapture
                ? ['Diagram-heavy PDF will create a draft from text extraction first and require manual visual-reference capture.']
                : []),
            ...(normalizedStrategy !== input.classification.preferredStrategy
                ? [`Normalized ${input.classification.preferredStrategy} to ${normalizedStrategy} for this file type.`]
                : []),
            ...promoted.reasons,
        ],
    }
}
