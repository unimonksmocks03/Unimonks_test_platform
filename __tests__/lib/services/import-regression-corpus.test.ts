import { expect, test } from 'vitest'

import { importRegressionFixtures } from '@/__tests__/fixtures/imports'
import { classifyDocumentForImport } from '@/lib/services/document-classifier'
import { resolveDocumentImportPlan } from '@/lib/services/document-import-strategy'

test('import regression corpus declares explicit, unique expectations for every protected file family', () => {
    const ids = new Set<string>()

    for (const fixture of importRegressionFixtures) {
        expect(ids.has(fixture.id)).toBe(false)
        ids.add(fixture.id)

        expect(fixture.sourceLabel.length).toBeGreaterThan(0)
        expect(fixture.fileName.length).toBeGreaterThan(0)
        expect(fixture.tags.length).toBeGreaterThan(0)
        expect(fixture.expectedQuestionCount).toBeGreaterThanOrEqual(0)
        expect(['EXACT_ACCEPTED', 'REVIEW_REQUIRED']).toContain(fixture.acceptableDecision)
    }
})

test.each(importRegressionFixtures)('$id classifier/plan expectations remain stable', (fixture) => {
    const classification = classifyDocumentForImport({
        fileName: fixture.fileName,
        text: fixture.text,
    })

    const plan = resolveDocumentImportPlan({
        classifierRoutingEnabled: true,
        classification,
        isPdfUpload: fixture.fileName.toLowerCase().endsWith('.pdf'),
    })

    expect(classification.documentType).toBe(fixture.expectedDocumentType)
    expect(classification.detectedQuestionCount ?? 0).toBe(fixture.expectedQuestionCount)
    expect(classification.preferredStrategy).toBe(fixture.expectedPreferredStrategy)
    expect(plan.selectedStrategy).toBe(fixture.expectedSelectedStrategy)
    expect(plan.lane).toBe(fixture.expectedLane)
    expect(classification.hasVisualReferences).toBe(fixture.requiresVisualSnapshot)
})
