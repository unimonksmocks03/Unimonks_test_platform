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

export function isClassifierRoutingEnabled() {
    return process.env.DOCUMENT_IMPORT_CLASSIFIER_ROUTING !== 'false'
}

export function resolveDocumentImportPlan(input: ResolveDocumentImportPlanInput): DocumentImportPlan {
    const selectedStrategy = normalizeStrategyForFileType(
        input.classification.preferredStrategy,
        input.isPdfUpload,
    )

    if (!input.classifierRoutingEnabled) {
        return {
            routingMode: 'LEGACY',
            lane: 'STABLE',
            selectedStrategy,
            runMultimodalFirst: false,
            visualReferenceOverlay: false,
            generateFromSource: false,
            reasons: ['Classifier-driven routing is disabled; using legacy import flow.'],
        }
    }

    const lane: DocumentImportLane = selectedStrategy === 'TEXT_EXACT'
        ? 'STABLE'
        : 'ADVANCED'

    return {
        routingMode: 'CLASSIFIER',
        lane,
        selectedStrategy,
        runMultimodalFirst: input.isPdfUpload && selectedStrategy === 'MULTIMODAL_EXTRACT',
        visualReferenceOverlay:
            input.isPdfUpload
            && input.classification.hasVisualReferences
            && selectedStrategy === 'MULTIMODAL_EXTRACT',
        generateFromSource: selectedStrategy === 'GENERATE_FROM_SOURCE',
        reasons: [
            `Classifier selected ${selectedStrategy} for this document.`,
            `Import lane: ${lane}.`,
            ...(selectedStrategy !== input.classification.preferredStrategy
                ? [`Normalized ${input.classification.preferredStrategy} to ${selectedStrategy} for this file type.`]
                : []),
        ],
    }
}
