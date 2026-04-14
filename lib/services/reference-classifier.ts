import type { GeneratedQuestion } from '@/lib/services/ai-service.types'
import type {
    QuestionReferenceKind,
    QuestionReferenceMode,
} from '@/lib/services/ai-extraction-schemas'

type ClassifiedQuestionReference = {
    kind: QuestionReferenceKind
    mode: QuestionReferenceMode
    title: string | null
    reasons: string[]
}

const VISUAL_BLOCK_REGEX = /[┌┐└┘├┤┬┴│─╭╮╰╯★☆●○■□▲△◆◇◯◎\\/]{2,}/
const DIAGRAM_REGEX = /\b(?:figure|diagram|venn|pattern|mirror image|water image|paper folding|embedded figure|missing figure|complete the figure|figure completion|figure formation|overlap|shaded region|triangle|square|circle|cube)\b/i
const GRAPH_REGEX = /\b(?:graph|bar graph|line graph|pie chart|histogram|scatter|x-axis|y-axis|axis)\b/i
const MAP_REGEX = /\b(?:map of|political map|physical map|mark(ed)? on the map|locate on the map|region shown|state shown)\b/i
const LIST_MATCH_REGEX = /\b(?:match the following|match the correct pair|list i|list ii|column i|column ii)\b/i
const PASSAGE_REGEX = /\b(?:read the following|passage|case study|comprehension|based on the passage)\b/i
const TABLE_HINT_REGEX = /\b(?:table|data|chart|dataset|following data)\b/i

function normalizeText(value: string | null | undefined) {
    return typeof value === 'string'
        ? value.replace(/\r\n?/g, '\n').trim()
        : ''
}

function looksStructuredTable(text: string) {
    const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

    if (lines.length < 3) {
        return false
    }

    const multiCellLines = lines.filter((line) => (
        line.includes('|')
        || line.includes('\t')
        || /(?:\b[A-Z]\b\s+){2,}/.test(line)
        || /(?:\d+\s+){3,}\d+/.test(line)
        || /^[A-Za-z][A-Za-z\s/-]*\s+\d+(?:\s+\d+){2,}$/.test(line)
        || /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|20\d{2})\b.*\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|20\d{2})\b/i.test(line)
    ))

    return multiCellLines.length >= 2
}

function looksUncertainTable(text: string) {
    if (looksStructuredTable(text)) {
        return false
    }

    const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

    const numericDenseLines = lines.filter((line) => /(?:\d+\s+){2,}\d+/.test(line))
    return numericDenseLines.length >= 2 || TABLE_HINT_REGEX.test(text)
}

function buildReferenceTitle(kind: QuestionReferenceKind, stem: string, context: string) {
    const source = `${stem}\n${context}`

    if (kind === 'DIAGRAM' && /\bvenn\b/i.test(source)) {
        return 'Venn diagram'
    }
    if (kind === 'GRAPH' && /\bpie chart\b/i.test(source)) {
        return 'Pie chart'
    }
    if (kind === 'GRAPH' && /\bbar graph\b/i.test(source)) {
        return 'Bar graph'
    }
    if (kind === 'GRAPH' && /\bline graph\b/i.test(source)) {
        return 'Line graph'
    }
    if (kind === 'MAP') {
        return 'Map reference'
    }
    if (kind === 'TABLE') {
        return 'Data table'
    }
    if (kind === 'LIST_MATCH') {
        return 'Match-the-following reference'
    }
    if (kind === 'PASSAGE') {
        return 'Passage reference'
    }
    if (kind === 'DIAGRAM') {
        return 'Diagram reference'
    }

    return null
}

export function classifyQuestionReference(question: Pick<
    GeneratedQuestion,
    'stem' | 'sharedContext' | 'sourceSnippet' | 'sharedContextEvidence'
>): ClassifiedQuestionReference {
    const stem = normalizeText(question.stem)
    const context = normalizeText(question.sharedContext)
    const snippet = normalizeText(question.sourceSnippet)
    const evidence = normalizeText(question.sharedContextEvidence)
    const combined = [stem, context, snippet, evidence].filter(Boolean).join('\n')
    const reasons: string[] = []

    if (!context && !LIST_MATCH_REGEX.test(combined) && !PASSAGE_REGEX.test(combined) && !TABLE_HINT_REGEX.test(combined) && !DIAGRAM_REGEX.test(combined) && !GRAPH_REGEX.test(combined) && !MAP_REGEX.test(combined)) {
        return {
            kind: 'NONE',
            mode: 'TEXT',
            title: null,
            reasons: ['No shared reference cues were detected for this question.'],
        }
    }

    if (GRAPH_REGEX.test(combined)) {
        reasons.push('Detected graph/chart cues that depend on visual layout.')
        return {
            kind: 'GRAPH',
            mode: 'SNAPSHOT',
            title: buildReferenceTitle('GRAPH', stem, context),
            reasons,
        }
    }

    if (MAP_REGEX.test(combined)) {
        reasons.push('Detected map-specific cues that depend on the original visual.')
        return {
            kind: 'MAP',
            mode: 'SNAPSHOT',
            title: buildReferenceTitle('MAP', stem, context),
            reasons,
        }
    }

    if (DIAGRAM_REGEX.test(combined) || VISUAL_BLOCK_REGEX.test(context) || VISUAL_BLOCK_REGEX.test(snippet)) {
        reasons.push('Detected diagram/figure cues that should keep the original visual reference.')
        return {
            kind: 'DIAGRAM',
            mode: 'SNAPSHOT',
            title: buildReferenceTitle('DIAGRAM', stem, context),
            reasons,
        }
    }

    if (LIST_MATCH_REGEX.test(combined)) {
        reasons.push('Detected a match-the-following style structured reference.')
        return {
            kind: 'LIST_MATCH',
            mode: 'TEXT',
            title: buildReferenceTitle('LIST_MATCH', stem, context),
            reasons,
        }
    }

    if (PASSAGE_REGEX.test(combined) || (!TABLE_HINT_REGEX.test(combined) && context.length >= 220)) {
        reasons.push('Detected passage/case-study style reference text.')
        return {
            kind: 'PASSAGE',
            mode: 'TEXT',
            title: buildReferenceTitle('PASSAGE', stem, context),
            reasons,
        }
    }

    if (looksStructuredTable(context) || looksStructuredTable(snippet)) {
        reasons.push('Detected a clean structured table that can be preserved as text.')
        return {
            kind: 'TABLE',
            mode: 'TEXT',
            title: buildReferenceTitle('TABLE', stem, context),
            reasons,
        }
    }

    if (looksUncertainTable(context) || looksUncertainTable(snippet)) {
        reasons.push('Detected table-like structure with uncertain text fidelity; keep a hybrid representation.')
        return {
            kind: 'TABLE',
            mode: 'HYBRID',
            title: buildReferenceTitle('TABLE', stem, context),
            reasons,
        }
    }

    return {
        kind: 'OTHER',
        mode: context ? 'TEXT' : 'HYBRID',
        title: null,
        reasons: ['Detected shared reference content, but it did not fit a stricter policy bucket.'],
    }
}

export function annotateQuestionsWithReferencePolicy<T extends GeneratedQuestion>(questions: T[]) {
    return questions.map((question) => {
        if (
            typeof question.referenceKind === 'string'
            || typeof question.referenceMode === 'string'
            || typeof question.referenceTitle === 'string'
        ) {
            return question
        }

        const classification = classifyQuestionReference(question)
        return {
            ...question,
            referenceKind: classification.kind,
            referenceMode: classification.mode,
            referenceTitle: classification.title,
        } as T
    })
}
