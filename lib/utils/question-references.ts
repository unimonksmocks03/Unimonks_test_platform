import { Prisma, QuestionReferenceKind, QuestionReferenceMode } from '@prisma/client'

export const QUESTION_REFERENCE_LINK_SELECT = Prisma.validator<Prisma.QuestionReferenceLinkSelect>()({
    order: true,
    reference: {
        select: {
            id: true,
            kind: true,
            mode: true,
            title: true,
            textContent: true,
            assetUrl: true,
            sourcePage: true,
            bbox: true,
            confidence: true,
            evidence: true,
        },
    },
})

type QuestionReferenceLinkRecord = Prisma.QuestionReferenceLinkGetPayload<{
    select: typeof QUESTION_REFERENCE_LINK_SELECT
}>

export type QuestionReferenceView = {
    id: string
    order: number
    kind: QuestionReferenceKind
    mode: QuestionReferenceMode
    title: string | null
    textContent: string | null
    assetUrl: string | null
    sourcePage: number | null
    bbox: Prisma.JsonValue | null
    confidence: number | null
    evidence: Prisma.JsonValue | null
}

export function mapQuestionReferences(
    links: QuestionReferenceLinkRecord[] | null | undefined,
): QuestionReferenceView[] {
    return [...(links ?? [])]
        .sort((left, right) => left.order - right.order)
        .map((link) => ({
            id: link.reference.id,
            order: link.order,
            kind: link.reference.kind,
            mode: link.reference.mode,
            title: link.reference.title,
            textContent: link.reference.textContent,
            assetUrl: link.reference.assetUrl,
            sourcePage: link.reference.sourcePage,
            bbox: link.reference.bbox as Prisma.JsonValue | null,
            confidence: link.reference.confidence,
            evidence: link.reference.evidence as Prisma.JsonValue | null,
        }))
}
