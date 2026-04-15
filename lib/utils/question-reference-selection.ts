import type { QuestionReferenceKind, QuestionReferenceMode } from '@/lib/services/ai-extraction-schemas'

type VisualReferenceLike = {
    id: string | null
    order: number | null
    kind: QuestionReferenceKind
    mode: QuestionReferenceMode
    assetUrl: string | null
}

type ReferenceWithOptionalId = {
    id: string | null
}

type QuestionWithReferences<TReference extends ReferenceWithOptionalId> = {
    dbId?: string
    references?: TReference[]
}

const VISUAL_REFERENCE_KINDS = new Set<QuestionReferenceKind>(['DIAGRAM', 'GRAPH', 'MAP'])

const VISUAL_KIND_PRIORITY: Record<QuestionReferenceKind, number> = {
    DIAGRAM: 0,
    GRAPH: 1,
    MAP: 2,
    OTHER: 3,
    TABLE: 4,
    LIST_MATCH: 5,
    PASSAGE: 6,
    NONE: 7,
}

const MODE_PRIORITY: Record<QuestionReferenceMode, number> = {
    SNAPSHOT: 0,
    HYBRID: 1,
    TEXT: 2,
}

export function isVisualReference(reference: Pick<VisualReferenceLike, 'kind' | 'mode' | 'assetUrl'>) {
    return reference.mode !== 'TEXT' || VISUAL_REFERENCE_KINDS.has(reference.kind) || Boolean(reference.assetUrl)
}

function compareVisualReferencePriority(left: VisualReferenceLike, right: VisualReferenceLike) {
    const assetComparison = Number(Boolean(left.assetUrl)) - Number(Boolean(right.assetUrl))
    if (assetComparison !== 0) {
        return assetComparison * -1
    }

    const kindComparison = VISUAL_KIND_PRIORITY[left.kind] - VISUAL_KIND_PRIORITY[right.kind]
    if (kindComparison !== 0) {
        return kindComparison
    }

    const modeComparison = MODE_PRIORITY[left.mode] - MODE_PRIORITY[right.mode]
    if (modeComparison !== 0) {
        return modeComparison
    }

    const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER
    const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER
    if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder
    }

    const leftId = left.id ?? ''
    const rightId = right.id ?? ''
    return leftId.localeCompare(rightId)
}

export function getPreferredVisualReference<TReference extends VisualReferenceLike>(
    references?: readonly TReference[] | null,
): TReference | null {
    const candidates = [...(references ?? [])].filter((reference) => isVisualReference(reference))
    if (candidates.length === 0) {
        return null
    }

    candidates.sort(compareVisualReferencePriority)
    return candidates[0] ?? null
}

export function mergeQuestionReferenceState<
    TReference extends ReferenceWithOptionalId,
    TQuestion extends QuestionWithReferences<TReference>,
>(
    currentQuestions: TQuestion[],
    nextQuestion: TQuestion,
): TQuestion[] {
    const updatedReferences = new Map(
        (nextQuestion.references ?? [])
            .filter((reference): reference is TReference & { id: string } => Boolean(reference.id))
            .map((reference) => [reference.id, reference] as const),
    )

    return currentQuestions.map((question) => {
        const mergedReferences = (question.references ?? []).map((reference) =>
            reference.id ? updatedReferences.get(reference.id) ?? reference : reference,
        )

        if (question.dbId === nextQuestion.dbId) {
            return {
                ...question,
                ...nextQuestion,
                references: nextQuestion.references ?? mergedReferences,
            }
        }

        return {
            ...question,
            references: mergedReferences,
        }
    })
}
