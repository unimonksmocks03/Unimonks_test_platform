import type { QuestionReferenceKind, QuestionReferenceMode } from '@/lib/services/ai-extraction-schemas'

export type QuestionReferencePayload = {
    id: string
    order: number
    kind: QuestionReferenceKind
    mode: QuestionReferenceMode
    title: string | null
    textContent: string | null
    assetUrl: string | null
    sourcePage: number | null
    bbox: unknown | null
    confidence: number | null
    evidence: unknown | null
}
