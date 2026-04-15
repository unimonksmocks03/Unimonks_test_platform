import { createRequire } from 'node:module'
import OpenAI from 'openai'
import { Prisma } from '@prisma/client'
import { zodTextFormat } from 'openai/helpers/zod'

import {
    AIVerificationResponseSchema,
    McqExtractionResponseSchema,
    McqQuestionSchema,
    NumberedMcqExtractionResponseSchema,
    type NumberedMcqQuestion,
    type VerificationResult,
    VisualReferenceExtractionSchema,
    VisualReferenceExtractionResponseSchema,
} from '@/lib/services/ai-extraction-schemas'
import {
    verifyExtractedQuestionsV2,
    type VerificationContext,
} from '@/lib/services/import-verifier'
import { prisma } from '@/lib/prisma'
import type {
    AIVerificationResult,
    CostInfo,
    DocumentMetadataEnrichmentResult,
    ExtractedQuestionAnalysis,
    GeneratedQuestion,
    PdfVisionFallbackResult,
    PreciseDocumentQuestionAnalysis,
    VisualReferenceExtractionResult,
} from '@/lib/services/ai-service.types'
import {
    isPotentialReferenceMetadataNoiseLine,
    sanitizeReferenceText,
} from '@/lib/utils/reference-sanitizer'

export type {
    AIVerificationResult,
    CostInfo,
    DocumentMetadataEnrichmentResult,
    DocumentQuestionStrategy,
    ExtractedQuestionAnalysis,
    GeneratedQuestion,
    PdfImportFallbackMode,
    PdfVisionFallbackResult,
    PreciseDocumentQuestionAnalysis,
    VisualReferenceExtractionResult,
} from '@/lib/services/ai-service.types'

/**
 * AI Service — OpenAI integration for:
 * 1. Personalized post-test feedback
 * 2. Document → MCQ extraction (with chunking + retry)
 * 3. Token-level cost tracking → AuditLog
 *
 * Gracefully falls back if no API key is configured.
 */

const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null

// ── Cost Constants (USD per 1K tokens, as of 2025) ──
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    'gpt-4o': { input: 0.0025, output: 0.01 },
}

// ── Types ──
interface AnswerEntry {
    questionId: string
    optionId: string | null
    answeredAt: string
}

interface QuestionData {
    id: string
    order: number
    stem: string
    options: unknown
    difficulty: string
    topic: string | null
    explanation: string | null
}

interface SessionData {
    id: string
    score: number | null
    totalMarks: number
    percentage: number | null
    answers: unknown
    tabSwitchCount: number
    startedAt: Date
    submittedAt: Date | null
}

interface FeedbackResult {
    strengths: Prisma.InputJsonValue
    weaknesses: Prisma.InputJsonValue
    actionPlan: Prisma.InputJsonValue
    questionExplanations: Prisma.InputJsonValue
    overallTag: string
}

type AIChunkFailure = {
    code?: string
    message: string
    retryable: boolean
}

type StructuredAnswerDetail = {
    correctOptionId: string | null
    explanation: string | null
}

type QuestionLabel = {
    questionNumber: number
    stem: string
    explicitPrefix: boolean
    inlineAnswerId: string | null
}

type StructuredQuestionBlock = {
    questionNumber: number
    explicitPrefix: boolean
    rawLines: string[]
    blockText: string
}

type ParsedStructuredQuestion = {
    questionNumber: number
    answerHintUsed: boolean
    blockText: string
    optionCount: number
    valid: boolean
    question: GeneratedQuestion | null
}

type DocumentAnswerHint = {
    correctOptionId: string
    answerSource: GeneratedQuestion['answerSource']
    evidence: string | null
}

type RenderPageAsImageFn = typeof import('unpdf')['renderPageAsImage']
type RenderPageAsImageOptions = NonNullable<Parameters<RenderPageAsImageFn>[2]>
type CanvasImport = NonNullable<RenderPageAsImageOptions['canvasImport']>
type CanvasModule = Awaited<ReturnType<CanvasImport>>
const requireCanvasModule = createRequire(import.meta.url)
const OPTIONAL_CANVAS_MODULE = ['@napi-rs', 'canvas'].join('/')

type StructuredExtractionContext = {
    analysis: ExtractedQuestionAnalysis
    answerSection: string
    questionBlocks: Map<number, StructuredQuestionBlock>
    parsedQuestions: Map<number, ParsedStructuredQuestion>
    genericStemHint: string | null
}


// ── Cost Tracking Helper ──
function calculateCost(
    model: string,
    usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        input_tokens?: number
        output_tokens?: number
    }
): CostInfo {
    const rates = MODEL_COSTS[model] || MODEL_COSTS['gpt-4o-mini']
    const inputTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? 0
    const outputTokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0
    return {
        model,
        inputTokens,
        outputTokens,
        costUSD: (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output,
    }
}

async function logCostToAudit(userId: string, action: string, cost: CostInfo) {
    try {
        await prisma.auditLog.create({
            data: {
                userId,
                action,
                metadata: {
                    model: cost.model,
                    inputTokens: cost.inputTokens,
                    outputTokens: cost.outputTokens,
                    costUSD: Math.round(cost.costUSD * 1000000) / 1000000, // 6 dp
                } as unknown as Prisma.InputJsonValue,
            },
        })
    } catch (err) {
        console.warn('[AI] Failed to log cost to AuditLog:', err)
    }
}

// ── Text Chunker ──
// Splits large text into ~4000-token chunks (≈16000 chars) with overlap
export function chunkDocumentTextForGeneration(text: string, maxChars = 16000, overlap = 500): string[] {
    if (text.length <= maxChars) return [text]

    const safeOverlap = Math.max(0, Math.min(overlap, maxChars - 1))
    const stepSize = Math.max(1, maxChars - safeOverlap)
    const chunks: string[] = []
    for (let start = 0; start < text.length; start += stepSize) {
        const end = Math.min(start + maxChars, text.length)
        chunks.push(text.slice(start, end))
        if (end >= text.length) {
            break
        }
    }
    return chunks
}

function chunkArray<T>(items: T[], size: number): T[][]
function chunkArray<T>(items: T[], size: number): T[][] {
    if (size <= 0) return [items]

    const chunks: T[][] = []
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size))
    }
    return chunks
}

function normalizeDocumentText(text: string): string {
    const normalized = text
        .replace(/\r\n?/g, '\n')
        .replace(/\f/g, '\n')
        .replace(/\u00a0/g, ' ')
        .replace(/[\u200b-\u200d\uFEFF]/g, '')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, '\'')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/(?:^|\n)\s*--\s*\d+\s*of\s*\d+\s*--\s*(?=\n|$)/gi, '\n')
        .replace(/\bDi\s+culty\b/gi, 'Difficulty')

    const cleanedLines = normalized
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .filter(line => !/^(?:ffi|ff|fi|fl){1,4}$/i.test(line))
        .filter(line => !/^[-–—_=*.]{3,}$/.test(line))
        .filter(line => !/^(?:page\s*)?\d+\s*(?:of|\/)\s*\d+$/i.test(line))

    return cleanedLines
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function truncateEvidenceText(text: string | null | undefined, maxLength = 1200) {
    if (!text) {
        return null
    }

    const normalized = text.trim().replace(/\s+/g, ' ')
    if (!normalized) {
        return null
    }

    return normalized.length <= maxLength
        ? normalized
        : `${normalized.slice(0, maxLength - 1).trim()}…`
}

function normalizeConfidenceScore(value: number) {
    if (!Number.isFinite(value)) {
        return null
    }

    return Math.max(0, Math.min(1, Math.round(value * 100) / 100))
}

function looksLikeVisualAsciiBlock(text: string | null | undefined) {
    if (!text) {
        return false
    }

    const normalized = text.replace(/\r\n?/g, '\n').trim()
    if (!normalized) {
        return false
    }

    const lines = normalized.split('\n').map(line => line.trimEnd()).filter(Boolean)
    if (lines.length < 2) {
        return false
    }

    const visualLineCount = lines.filter((line) => (
        /[┌┐└┘├┤┬┴│─╭╮╰╯]/.test(line)
        || /[★☆●○■□▲△◆◇◯◎]/.test(line)
        || /[\\/]/.test(line)
        || /(?:\?\s*$)|(?:^\s*\?)/.test(line)
        || /\b(?:figure|diagram)\b/i.test(line)
    )).length

    const horizontalGlyphCount = (normalized.match(/[┌┐└┘├┤┬┴│─╭╮╰╯★☆●○■□▲△◆◇◯◎\\/]/g) ?? []).length
    return visualLineCount >= 2 && horizontalGlyphCount >= 6
}

function looksLikeVisualStemTail(text: string | null | undefined) {
    if (!text) {
        return false
    }

    const normalized = text.replace(/\r\n?/g, '\n').trim()
    if (!normalized) {
        return false
    }

    const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean)
    if (lines.length === 0) {
        return false
    }

    const visualLineCount = lines.filter((line) => (
        /[┌┐└┘├┤┬┴│─╭╮╰╯]/.test(line)
        || /[★☆●○■□▲△◆◇◯◎]/.test(line)
        || /[\\/]/.test(line)
        || /\b(?:figure|diagram|triangle|square|circle|pattern)\b/i.test(line)
        || /\?/.test(line)
    )).length

    const visualGlyphCount = (normalized.match(/[┌┐└┘├┤┬┴│─╭╮╰╯★☆●○■□▲△◆◇◯◎\\/]/g) ?? []).length
    return visualLineCount >= 1 && visualGlyphCount >= 6
}

function splitStemAndVisualContext(
    stem: string | null | undefined,
    sharedContext: string | null | undefined,
) {
    const rawStem = typeof stem === 'string' ? stem.replace(/\r\n?/g, '\n').trim() : ''
    const rawSharedContext = typeof sharedContext === 'string' ? sharedContext : null

    if (!rawStem) {
        return {
            stem: rawStem,
            sharedContext: rawSharedContext,
        }
    }

    const lines = rawStem.split('\n')
    if (lines.length >= 2) {
        const visualStartIndex = lines.findIndex((line, index) => index > 0 && looksLikeVisualStemTail(line))
        if (visualStartIndex >= 1) {
            const stemText = lines.slice(0, visualStartIndex).join(' ').trim()
            const visualText = lines.slice(visualStartIndex).join('\n').trim()
            if (stemText.length >= 3 && looksLikeVisualStemTail(visualText)) {
                return {
                    stem: stemText,
                    sharedContext: normalizeSharedContextText([visualText, rawSharedContext].filter(Boolean).join('\n\n')),
                }
            }
        }
    }

    const inlineSplit = rawStem.match(/^(.+?\?)\s+([|\\/★☆●○■□▲△◆◇◯◎][\s\S]+)$/)
    if (inlineSplit && looksLikeVisualStemTail(inlineSplit[2])) {
        return {
            stem: inlineSplit[1].trim(),
            sharedContext: normalizeSharedContextText([inlineSplit[2].trim(), rawSharedContext].filter(Boolean).join('\n\n')),
        }
    }

    return {
        stem: rawStem,
        sharedContext: rawSharedContext,
    }
}

function normalizeSharedContextText(text: string | null | undefined) {
    if (!text) return null

    const normalizedBase = text
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()

    const normalized = looksLikeVisualAsciiBlock(normalizedBase)
        ? normalizedBase
            .replace(/\t/g, '    ')
            .split('\n')
            .map((line) => line.replace(/\s+$/g, ''))
            .join('\n')
        : normalizedBase.replace(/[ \t]+/g, ' ')

    return normalized.length > 0 ? normalized : null
}

function truncateForPrompt(text: string | null | undefined, maxLength = 320) {
    const normalized = normalizeSharedContextText(text)
    if (!normalized) return null
    if (normalized.length <= maxLength) return normalized
    return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

function isLikelyPageHeaderNoise(line: string) {
    return isPotentialReferenceMetadataNoiseLine(line)
        || /^(?:sectional mock\s*test|mock\s*test|question\s*paper|general instructions?|duration|time allowed|maximum marks|page\s+\d+|class\s*xii|xii|cuet(?:\s+pattern)?|subject\b)/i.test(line.trim())
}

function looksMeaningfulSharedContext(text: string | null | undefined) {
    const normalized = sanitizeReferenceText(normalizeSharedContextText(text))
    if (!normalized || normalized.length < 40) {
        return false
    }

    const lines = normalized.split('\n').map(line => line.trim()).filter(Boolean)
    const hasStructuralCue = /(following|table|data|chart|graph|passage|case study|based on|study the|read the|set\s+\d+|list i|list ii|ratio|percentage|production|population|sales|profit|income)/i.test(normalized)
    const numericLineCount = lines.filter(line => /\d/.test(line)).length
    const likelyTable = numericLineCount >= 2 && lines.length >= 3

    return hasStructuralCue || likelyTable
}

function normalizeStem(text: string): string {
    return text
        .replace(/\s+/g, ' ')
        .replace(/^[.:)\]-]+\s*/, '')
        .trim()
}

function normalizeOptionText(text: string): string {
    return text
        .replace(/\s+/g, ' ')
        .replace(/\s*(?:\((?:correct)\)|\[(?:correct)\]|✓|✅)\s*$/i, '')
        .trim()
}

function isMatchFollowingContextLine(line: string) {
    const trimmed = line.trim()
    if (!trimmed) return false

    if (/^(?:list\s*i|list\s*ii)\b/i.test(trimmed)) {
        return true
    }

    if (/^[A-D][.)\-:]\s+.+(?:—|-)\s*\d+\./.test(trimmed)) {
        return true
    }

    if (/^[A-D][.)\-:]\s+/.test(trimmed)) {
        return true
    }

    if (/^\d+[.)\-:]\s+/.test(trimmed)) {
        return true
    }

    return false
}

function guessDifficulty(stem: string): string {
    const wordCount = stem.split(/\s+/).filter(Boolean).length
    if (wordCount >= 22) return 'HARD'
    if (wordCount >= 12) return 'MEDIUM'
    return 'EASY'
}

function detectTopic(stem: string): string {
    const words = stem
        .replace(/[^a-z0-9\s-]/gi, ' ')
        .split(/\s+/)
        .filter(word => word.length > 3)

    if (words.length === 0) return 'General'
    return words.slice(0, 3).join(' ')
}

function isLikelyQuestionStemNoise(questionNumber: number, stem: string, explicitPrefix: boolean) {
    if (!stem) return true

    if (/^[–-]\s*\d+/.test(stem)) return true

    const lowerStem = stem.toLowerCase()
    if (
        /^(?:minutes?|marks?|mcqs?|questions?|question\s*paper|section\b|general instructions?\b|answer key\b|detailed answers?\b|quick answer grid\b|color guide\b|time allowed\b|duration\b)/i.test(lowerStem)
    ) {
        return true
    }

    if (!explicitPrefix) {
        const headerCandidate = `${questionNumber} ${stem}`.toLowerCase()
        if (/^\d+\s+(?:minutes?|marks?|mcqs?|questions?)\b/.test(headerCandidate)) {
            return true
        }
    }

    return false
}

function stripQuestionLabel(line: string): QuestionLabel | null {
    const trimmedLine = line.trim()
    if (!trimmedLine) return null
    const normalizedLine = trimmedLine.replace(/^#{1,6}\s*/, '')

    const answerOnlyHeaderMatch = normalizedLine.match(/^(\d+)\s+ANSWER\s*\(?([A-Da-d1-4])\)?\s*$/i)
    if (answerOnlyHeaderMatch) {
        return {
            questionNumber: Number.parseInt(answerOnlyHeaderMatch[1], 10),
            stem: '',
            explicitPrefix: true,
            inlineAnswerId: normalizeAnswerIdent(answerOnlyHeaderMatch[2]),
        }
    }

    const prefixedQuestionMatch = normalizedLine.match(
        /^(question\s*|ques(?:tion)?\s*|ues\s*|q\s*)(\d+)\s*(?:[.)\-:]|\b)\s*(.*)$/i
    )

    if (prefixedQuestionMatch) {
        const questionNumber = Number.parseInt(prefixedQuestionMatch[2], 10)
        const stem = normalizeStem(prefixedQuestionMatch[3] ?? '')
        if (stem && isLikelyQuestionStemNoise(questionNumber, stem, true)) {
            return null
        }

        return {
            questionNumber,
            stem,
            explicitPrefix: true,
            inlineAnswerId: null,
        }
    }

    const bareQuestionMatch = normalizedLine.match(/^(\d+)\s*(?:(?:\.(?!\d))|(?:\)(?!\d))|(?:-(?!\d))|(?::(?!\d)))\s*(.+)$/)
    if (!bareQuestionMatch) return null

    const questionNumber = Number.parseInt(bareQuestionMatch[1], 10)
    const stem = normalizeStem(bareQuestionMatch[2])
    if (isLikelyQuestionStemNoise(questionNumber, stem, false)) {
        return null
    }

    return {
        questionNumber,
        stem,
        explicitPrefix: false,
        inlineAnswerId: null,
    }
}

function findQuestionStartsInPage(pageText: string) {
    return normalizeDocumentText(pageText)
        .split('\n')
        .map((line, index) => {
            const label = stripQuestionLabel(line)
            if (!label) return null

            return {
                index,
                questionNumber: label.questionNumber,
            }
        })
        .filter((entry): entry is { index: number; questionNumber: number } => entry !== null)
}

function extractPageSharedContext(pageText: string) {
    const lines = normalizeDocumentText(pageText)
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
    const questionStarts = findQuestionStartsInPage(pageText)

    if (questionStarts.length === 0) {
        return {
            questionNumbers: [] as number[],
            sharedContext: null as string | null,
        }
    }

    const firstQuestionLineIndex = questionStarts[0]?.index ?? 0
    const candidateLines = lines
        .slice(0, firstQuestionLineIndex)
        .filter(line => !isLikelyPageHeaderNoise(line))
    const sharedContext = sanitizeReferenceText(normalizeSharedContextText(candidateLines.join('\n')))

    return {
        questionNumbers: questionStarts.map(entry => entry.questionNumber),
        sharedContext: looksMeaningfulSharedContext(sharedContext) ? sharedContext : null,
    }
}

export function attachSharedContextsFromPageText(
    questions: GeneratedQuestion[],
    pageTexts: string[],
): GeneratedQuestion[] {
    if (questions.length === 0 || pageTexts.length === 0) {
        return questions
    }

    const hydratedQuestions = questions.map(question => ({ ...question }))
    const questionsByNumber = new Map<number, GeneratedQuestion>()
    hydratedQuestions.forEach((question, index) => {
        questionsByNumber.set(index + 1, question)
    })

    let activeSharedContext: string | null = null

    for (const pageText of pageTexts) {
        const page = extractPageSharedContext(pageText)
        if (page.sharedContext) {
            activeSharedContext = page.sharedContext
        }

        if (!activeSharedContext) {
            continue
        }

        for (const questionNumber of page.questionNumbers) {
            const question = questionsByNumber.get(questionNumber)
            if (!question) continue

            if (!normalizeSharedContextText(question.sharedContext)) {
                question.sharedContext = activeSharedContext
            }
        }
    }

    return hydratedQuestions.map(question => ({
        ...question,
        sharedContext: normalizeSharedContextText(question.sharedContext),
    }))
}

function shouldTreatAsNestedNumberedStemLine(
    currentBlock: StructuredQuestionBlock | null,
    questionLabel: { questionNumber: number; explicitPrefix: boolean },
) {
    if (!currentBlock) return false
    if (questionLabel.explicitPrefix) return false
    if (!currentBlock.explicitPrefix) return false

    return questionLabel.questionNumber >= 1 && questionLabel.questionNumber <= 4
}

// Matches option lines like: (A) text  |  A. text  |  A) text  |  A- text  |  A: text
// When the letter is NOT surrounded by parentheses, a delimiter (.)-:) is MANDATORY
// to avoid matching the first letter of words like "Answer", "Assertion", etc.
const OPTION_LETTER_REGEX = /^(?:\(([A-D])\)|([A-D])[.)\-:])(?:\s*[.)\-:])*\s*(.+)$/i
const OPTION_NUMBER_REGEX = /^\(?([1-4])\)?(?:\s*[.)\-:]\s*|\s+)(.+)$/i
// Matches answer hints including numbered format: "Answer 3: (b)" / "Answer: B" / "Ans: 2"
const ANSWER_LINE_REGEX =
    /^(?:[^A-Za-z0-9]+\s*)*(?:revised\s+)?(?:answer|ans(?:wer)?|correct\s*answer|correct\s*option|right\s*answer)\s*(?:\d+\s*)?(?:is\s*)?[:.\-]?\s*(?:option\s*)?\(?([A-Da-d1-4])\)?(?:[.)]+)?(?=\s|$)/i
const EXPLANATION_LINE_REGEX = /^(?:explanation|reason(?!\s*\([rR]\)))\s*[:\-]?\s*(.+)$/i
const DIFFICULTY_LINE_REGEX = /^difficulty\s*[:\-]?\s*(easy|medium|hard)\b/i
const TOPIC_LINE_REGEX = /^topic\s*[:\-]?\s*(.+)$/i
const INLINE_QUESTION_PREFIX_REGEX = /^question\s*:\s*(.+)$/i
const ASSERTION_REASON_OPTION_SET = new Map<string, string>([
    ['A', 'Both A and R are true and R is the correct explanation of A'],
    ['B', 'Both A and R are true but R is NOT the correct explanation of A'],
    ['C', 'A is true but R is false'],
    ['D', 'A is false but R is true'],
])

const NUMERIC_TO_LETTER: Record<string, string> = { '1': 'A', '2': 'B', '3': 'C', '4': 'D' }

function matchOptionLine(line: string): { optionId: string; text: string; sourceType: 'LETTER' | 'NUMBER' } | null {
    const letterMatch = line.match(OPTION_LETTER_REGEX)
    if (letterMatch) {
        // Group 1: letter from (A) paren form; Group 2: letter from A. bare-delimiter form; Group 3: text
        const optionId = (letterMatch[1] ?? letterMatch[2] ?? '').toUpperCase()
        const text = letterMatch[3] ?? ''
        if (!optionId || !text) return null
        return { optionId, text, sourceType: 'LETTER' }
    }

    const numberMatch = line.match(OPTION_NUMBER_REGEX)
    if (numberMatch) {
        const mapped = NUMERIC_TO_LETTER[numberMatch[1]]
        if (mapped) {
            return { optionId: mapped, text: numberMatch[2], sourceType: 'NUMBER' }
        }
    }

    return null
}

function isUppercaseLetterOptionLine(line: string) {
    return /^\(?[A-D]\)?\s*[.)\-:]\s*/.test(line.trim())
}

function isLowercaseLetterOptionLine(line: string) {
    return /^\(?[a-d]\)?\s*[.)\-:]\s*/.test(line.trim())
}

function isParenthesizedNumericOptionLine(line: string) {
    return /^\([1-4]\)\s+/.test(line.trim())
}

function isBareNumberedStemStatementLine(
    line: string,
): { questionNumber: number; stem: string } | null {
    if (/^\(/.test(line.trim())) return null

    const questionLabel = stripQuestionLabel(line)
    if (!questionLabel || questionLabel.explicitPrefix) return null
    if (questionLabel.questionNumber < 1 || questionLabel.questionNumber > 4) return null

    return {
        questionNumber: questionLabel.questionNumber,
        stem: questionLabel.stem,
    }
}

function extractInlineLetterOptions(
    text: string,
    { allowEmptyStem = false }: { allowEmptyStem?: boolean } = {},
): { stem: string; options: Array<{ optionId: string; text: string }> } | null {
    const matches = [...text.matchAll(/(?<![A-Za-z0-9])\(?([A-Da-d])\)?\s*[.)]\s*/g)]
    if (matches.length < 4) return null

    const orderedMatches = matches
        .map((match) => ({
            optionId: match[1]?.toUpperCase() ?? '',
            index: match.index ?? -1,
            marker: match[0],
        }))
        .filter(match => match.index >= 0)

    const firstFour = orderedMatches.slice(0, 4)
    const ids = firstFour.map(match => match.optionId).join('')
    if (ids !== 'ABCD') return null

    const stem = normalizeStem(text.slice(0, firstFour[0]?.index ?? 0))
    if (!stem && !allowEmptyStem) return null

    const options = firstFour.map((current, index) => {
        const next = firstFour[index + 1]
        const contentStart = current.index + current.marker.length
        const contentEnd = next?.index ?? text.length
        return {
            optionId: current.optionId,
            text: normalizeOptionText(text.slice(contentStart, contentEnd)),
        }
    }).filter(option => option.text.length > 0)

    if (options.length !== 4) return null

    return { stem, options }
}

function isSelectionPromptLine(line: string) {
    const normalizedLine = line
        .replace(/^\(?([Cc])\)?\s+hoose\b/, '$1hoose')
        .replace(/\s+/g, ' ')
        .trim()

    return /^(?:choose|select|pick)\s+(?:the\s+)?correct\s+(?:answer|option|choice)\s*:?\s*$/i.test(normalizedLine)
        || /^(?:which|what)\s+(?:of\s+the\s+following\s+)?(?:is|are)\s+correct\??\s*$/i.test(normalizedLine)
        || /^correct\s+(?:option|answer)\s*:?\s*$/i.test(normalizedLine)
}

function normalizeSelectionPromptLine(line: string) {
    return line
        .replace(/^\(?([Cc])\)?\s+hoose\b/, '$1hoose')
        .replace(/\s+/g, ' ')
        .trim()
}

function normalizeAnswerIdent(raw: string): string {
    const upper = raw.toUpperCase()
    if (/^[A-D]$/.test(upper)) return upper
    return NUMERIC_TO_LETTER[raw] || upper
}

function isSuspiciousBareQuestionJump(
    questionLabel: QuestionLabel,
    currentQuestionNumber: number,
    line: string,
) {
    if (questionLabel.explicitPrefix) {
        return false
    }

    if (questionLabel.questionNumber <= currentQuestionNumber + 5) {
        return false
    }

    const stem = normalizeStem(questionLabel.stem)
    const looksQuestionLike = stem.includes('?')
        || stem.includes('::')
        || /^(?:assertion|reason|match|which|what|who|where|when|why|how|choose|select|identify|find|consider|read|study)\b/i.test(stem)
        || extractInlineLetterOptions(line) !== null

    if (looksQuestionLike) {
        return false
    }

    return true
}

function shouldTreatAsSuspiciousBareQuestionJump(
    currentBlock: StructuredQuestionBlock | null,
    questionLabel: QuestionLabel,
    line: string,
) {
    if (!currentBlock || !isSuspiciousBareQuestionJump(questionLabel, currentBlock.questionNumber, line)) {
        return false
    }

    return currentBlock.rawLines.some((rawLine) => {
        const trimmed = rawLine.trim()
        return ANSWER_LINE_REGEX.test(trimmed)
            || EXPLANATION_LINE_REGEX.test(trimmed)
            || DIFFICULTY_LINE_REGEX.test(trimmed)
            || TOPIC_LINE_REGEX.test(trimmed)
            || matchOptionLine(trimmed) !== null
    })
}

function expandInlineQuestionLine(
    line: string,
    questionNumber: number,
): { questionNumber: number; explicitPrefix: boolean; rawLines: string[]; blockText: string } | null {
    const questionMatch = line.match(INLINE_QUESTION_PREFIX_REGEX)
    if (!questionMatch) return null

    const body = questionMatch[1]?.trim()
    if (!body) return null

    const optionRegex = /([A-D])\)\s*/g
    const optionMatches = [...body.matchAll(optionRegex)]
    const rawLines: string[] = []

    if (optionMatches.length === 0) {
        rawLines.push(`Q${questionNumber}. ${body}`)
    } else {
        const firstOptionIndex = optionMatches[0]?.index ?? -1
        const stem = normalizeStem(body.slice(0, firstOptionIndex))
        if (!stem) {
            return null
        }

        rawLines.push(`Q${questionNumber}. ${stem}`)
        for (let index = 0; index < optionMatches.length; index++) {
            const current = optionMatches[index]
            const next = optionMatches[index + 1]
            const optionId = current?.[1]?.toUpperCase()
            if (!optionId) continue

            const contentStart = (current.index ?? 0) + current[0].length
            const contentEnd = next?.index ?? body.length
            const optionText = normalizeOptionText(body.slice(contentStart, contentEnd))
            if (!optionText) continue

            rawLines.push(`(${optionId}) ${optionText}`)
        }
    }

    return {
        questionNumber,
        explicitPrefix: true,
        rawLines,
        blockText: rawLines.join('\n'),
    }
}

function findAnswerSectionIndex(text: string) {
    const markers = [
        /(?:^|\n)\s*ANSWER\s*KEY(?:\s+WITH\s+EXPLANATIONS)?\b/i,
        /(?:^|\n)\s*DETAILED\s*ANSWERS?(?:\s+AND\s+EXPLANATIONS)?\b/i,
        /(?:^|\n)\s*ANSWERS\b/i,
    ]

    let earliestIndex = -1
    for (const marker of markers) {
        const index = text.search(marker)
        if (index >= 0 && (earliestIndex === -1 || index < earliestIndex)) {
            earliestIndex = index
        }
    }

    return earliestIndex
}

function splitDocumentSections(text: string) {
    const answerSectionIndex = findAnswerSectionIndex(text)
    if (answerSectionIndex < 0) {
        return {
            questionSection: text,
            answerSection: '',
        }
    }

    return {
        questionSection: text.slice(0, answerSectionIndex).trim(),
        answerSection: text.slice(answerSectionIndex).trim(),
    }
}

function pruneRepeatedQuestionSequence(questionSection: string) {
    const explicitQuestionStartRegex = /(?:^|\n)(question\s*|ques(?:tion)?\s*|ues\s*|q\s*)(\d+)\s*(?:[.)\-:]|\b)/gi
    const matches: Array<{ index: number; questionNumber: number }> = []
    let match: RegExpExecArray | null

    while ((match = explicitQuestionStartRegex.exec(questionSection)) !== null) {
        const fullMatch = match[0] ?? ''
        const questionNumber = Number.parseInt(match[2] ?? '', 10)
        if (!Number.isFinite(questionNumber)) continue

        matches.push({
            index: fullMatch.startsWith('\n') ? match.index + 1 : match.index,
            questionNumber,
        })
    }

    const seenQuestionNumbers = new Set<number>()
    let maxQuestionNumber = 0

    for (const entry of matches) {
        const expectedSequence = buildExpectedQuestionSequence([...seenQuestionNumbers])
        const hasCompletePrefix = expectedSequence
            && expectedSequence.every(questionNumber => seenQuestionNumbers.has(questionNumber))
        const restartedFromOne = entry.questionNumber === 1 && maxQuestionNumber >= 5
        const restartedAtDuplicate = seenQuestionNumbers.has(entry.questionNumber)
            && maxQuestionNumber >= 5

        if (hasCompletePrefix && (restartedFromOne || restartedAtDuplicate)) {
            return questionSection.slice(0, entry.index).trim()
        }

        seenQuestionNumbers.add(entry.questionNumber)
        maxQuestionNumber = Math.max(maxQuestionNumber, entry.questionNumber)
    }

    return questionSection
}

function collectStructuredQuestionBlocks(questionSection: string): StructuredQuestionBlock[] {
    const lines = questionSection
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)

    const blocks: StructuredQuestionBlock[] = []
    let currentBlock: StructuredQuestionBlock | null = null
    let implicitQuestionNumber = 0

    for (const line of lines) {
        const questionLabel = stripQuestionLabel(line)
        if (questionLabel) {
            if (shouldTreatAsNestedNumberedStemLine(currentBlock, questionLabel)) {
                currentBlock?.rawLines.push(line)
                continue
            }

            if (shouldTreatAsSuspiciousBareQuestionJump(currentBlock, questionLabel, line)) {
                currentBlock?.rawLines.push(line)
                continue
            }

            if (currentBlock) {
                currentBlock.blockText = currentBlock.rawLines.join('\n')
                blocks.push(currentBlock)
            }

            currentBlock = {
                questionNumber: questionLabel.questionNumber,
                explicitPrefix: questionLabel.explicitPrefix,
                rawLines: [line],
                blockText: line,
            }
            implicitQuestionNumber = Math.max(implicitQuestionNumber, questionLabel.questionNumber)
            continue
        }

        const inlineQuestionBlock = expandInlineQuestionLine(line, implicitQuestionNumber + 1)
        if (inlineQuestionBlock) {
            if (currentBlock) {
                currentBlock.blockText = currentBlock.rawLines.join('\n')
                blocks.push(currentBlock)
            }

            currentBlock = inlineQuestionBlock
            implicitQuestionNumber = inlineQuestionBlock.questionNumber
            continue
        }

        if (currentBlock) {
            currentBlock.rawLines.push(line)
        }
    }

    if (currentBlock) {
        currentBlock.blockText = currentBlock.rawLines.join('\n')
        blocks.push(currentBlock)
    }

    return blocks
}

function parseExplicitQuestionLabelWithoutNoise(line: string): QuestionLabel | null {
    const trimmedLine = line.trim()
    if (!trimmedLine) return null

    const normalizedLine = trimmedLine.replace(/^#{1,6}\s*/, '')

    const answerOnlyHeaderMatch = normalizedLine.match(/^(\d+)\s+ANSWER\s*\(?([A-Da-d1-4])\)?\s*$/i)
    if (answerOnlyHeaderMatch) {
        return {
            questionNumber: Number.parseInt(answerOnlyHeaderMatch[1], 10),
            stem: '',
            explicitPrefix: true,
            inlineAnswerId: normalizeAnswerIdent(answerOnlyHeaderMatch[2]),
        }
    }

    const prefixedQuestionMatch = normalizedLine.match(
        /^(question\s*|ques(?:tion)?\s*|ues\s*|q\s*)(\d+)\s*(?:[.)\-:]|\b)\s*(.*)$/i
    )
    if (!prefixedQuestionMatch) {
        return null
    }

    return {
        questionNumber: Number.parseInt(prefixedQuestionMatch[2], 10),
        stem: normalizeStem(prefixedQuestionMatch[3] ?? ''),
        explicitPrefix: true,
        inlineAnswerId: null,
    }
}

function splitEmbeddedExplicitQuestionStarts(blocks: StructuredQuestionBlock[]) {
    const splitBlocks: StructuredQuestionBlock[] = []

    for (const block of blocks) {
        if (block.rawLines.length <= 1) {
            splitBlocks.push(block)
            continue
        }

        let activeQuestionNumber = block.questionNumber
        let activeExplicitPrefix = block.explicitPrefix
        let segmentStart = 0
        let didSplit = false

        for (let index = 1; index < block.rawLines.length; index++) {
            const rawLine = block.rawLines[index]
            const line = rawLine?.trim()
            if (!line) continue

            const questionLabel = parseExplicitQuestionLabelWithoutNoise(line)
            if (!questionLabel) {
                continue
            }

            if (questionLabel.questionNumber === activeQuestionNumber) {
                continue
            }

            const segmentLines = block.rawLines.slice(segmentStart, index)
            if (segmentLines.length > 0) {
                splitBlocks.push({
                    questionNumber: activeQuestionNumber,
                    explicitPrefix: activeExplicitPrefix,
                    rawLines: segmentLines,
                    blockText: segmentLines.join('\n'),
                })
            }

            activeQuestionNumber = questionLabel.questionNumber
            activeExplicitPrefix = questionLabel.explicitPrefix
            segmentStart = index
            didSplit = true
        }

        if (!didSplit) {
            splitBlocks.push(block)
            continue
        }

        const trailingLines = block.rawLines.slice(segmentStart)
        if (trailingLines.length > 0) {
            splitBlocks.push({
                questionNumber: activeQuestionNumber,
                explicitPrefix: activeExplicitPrefix,
                rawLines: trailingLines,
                blockText: trailingLines.join('\n'),
            })
        }
    }

    return splitBlocks
}

function isolatePrimaryQuestionSequence(blocks: StructuredQuestionBlock[]) {
    if (blocks.length < 10) return blocks

    for (let index = 1; index < blocks.length; index++) {
        const previous = blocks[index - 1]
        const current = blocks[index]
        if (!previous || !current) continue

        const restartedFromOne = current.questionNumber === 1 && current.questionNumber <= previous.questionNumber
        if (!restartedFromOne) continue

        const prefix = blocks.slice(0, index)
        const prefixNumbers = prefix.map(block => block.questionNumber)
        const expectedSequence = buildExpectedQuestionSequence(prefixNumbers)
        if (!expectedSequence || expectedSequence.length < 10) continue

        const uniquePrefixNumbers = new Set(prefixNumbers)
        const hasCompletePrefix = expectedSequence.every(questionNumber => uniquePrefixNumbers.has(questionNumber))
        if (!hasCompletePrefix) continue

        return prefix
    }

    return blocks
}

function deriveGenericStemHint(questionSection: string) {
    const lines = questionSection
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)

    const headingLines: string[] = []
    for (const line of lines) {
        if (stripQuestionLabel(line) || expandInlineQuestionLine(line, 1)) {
            break
        }
        headingLines.push(line)
    }

    const headingText = headingLines.join(' ').replace(/\s+/g, ' ').trim()
    if (!headingText) return null

    if (/\bodd\s*[-–]?\s*one\s*out\b/i.test(headingText)) {
        return 'Select the odd one out.'
    }
    if (/\bfigure\s*completion\b|\bmissing\s*figure\b/i.test(headingText)) {
        return 'Find the missing figure.'
    }
    if (/\bfigure\s*formation\b/i.test(headingText)) {
        return 'Select the correctly formed figure.'
    }
    if (/\bvenn\s*diagram\b/i.test(headingText)) {
        return 'Select the correct Venn diagram.'
    }
    if (/\branking|rankings\b/i.test(headingText)) {
        return 'Select the correct option.'
    }

    return null
}

function extractAnswerKey(answerSection: string): Map<number, string> {
    const answerKey = new Map<number, string>()
    if (!answerSection) return answerKey

    const fallbackMatch = answerSection.match(
        /(?:^|\n)(?:answer\s*key|answers?|correct\s*answers?)\s*[:\-]?\s*([\s\S]{0,10000})$/i
    )

    const searchArea = fallbackMatch?.[1] ?? answerSection
    if (!searchArea) return answerKey

    const pairRegex = /(?:^|\n)\s*(\d{1,4})\s*[\).:\-]?\s*(?:option\s*)?\(?([A-Da-d])\)?(?=\s|$)/gi
    let match: RegExpExecArray | null
    while ((match = pairRegex.exec(searchArea)) !== null) {
        answerKey.set(Number.parseInt(match[1], 10), normalizeAnswerIdent(match[2]))
    }

    const compactQuestionAnswerRegex = /(?:^|\s)Q?(\d{1,4})\s*([A-Da-d])(?=\s|$)/gi
    while ((match = compactQuestionAnswerRegex.exec(searchArea)) !== null) {
        answerKey.set(Number.parseInt(match[1], 10), normalizeAnswerIdent(match[2]))
    }

    const lines = searchArea.split('\n').map(line => line.trim()).filter(Boolean)
    let pendingQNumbers: number[] = []
    for (const line of lines) {
        const qMatches = [...line.matchAll(/Q(\d+)/gi)]
        if (qMatches.length >= 2) {
            pendingQNumbers = qMatches.map(qMatch => Number.parseInt(qMatch[1], 10))
            continue
        }

        const singleQuestionMatch = line.match(/^Q(\d+)$/i)
        if (singleQuestionMatch) {
            pendingQNumbers.push(Number.parseInt(singleQuestionMatch[1], 10))
            continue
        }

        const answerMatches = [...line.matchAll(/([1-4A-Da-d])\)/g)]
        if (answerMatches.length >= 2 && pendingQNumbers.length > 0) {
            for (let index = 0; index < Math.min(answerMatches.length, pendingQNumbers.length); index++) {
                answerKey.set(
                    pendingQNumbers[index],
                    normalizeAnswerIdent(answerMatches[index][1]),
                )
            }
            pendingQNumbers = []
            continue
        }

        const singleAnswerMatch = line.match(/^([1-4A-Da-d])\)$/)
        if (singleAnswerMatch && pendingQNumbers.length > 0) {
            const questionNumber = pendingQNumbers.shift()
            if (questionNumber !== undefined) {
                answerKey.set(questionNumber, normalizeAnswerIdent(singleAnswerMatch[1]))
            }
            continue
        }

        if (!/^Q\d/i.test(line) && !/^[1-4A-Da-d]\)$/.test(line)) {
            pendingQNumbers = []
        }
    }

    let currentQuestionNumber: number | null = null
    for (const line of lines) {
        const questionMatch = line.match(/^Q(\d+)\b/i)
        if (questionMatch) {
            currentQuestionNumber = Number.parseInt(questionMatch[1], 10)
        }

        const correctAnswerMatch = line.match(ANSWER_LINE_REGEX)
        if (correctAnswerMatch && currentQuestionNumber !== null) {
            answerKey.set(currentQuestionNumber, normalizeAnswerIdent(correctAnswerMatch[1]))
        }
    }

    return answerKey
}

function extractDetailedAnswerRecords(answerSection: string): Map<number, StructuredAnswerDetail> {
    const detailedAnswers = new Map<number, StructuredAnswerDetail>()
    if (!answerSection) return detailedAnswers

    const blocks = answerSection
        .split(/\n(?=Q\d+\b)/i)
        .map(block => block.trim())
        .filter(Boolean)

    for (const block of blocks) {
        const lines = block
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)

        const firstQuestionLine = lines[0]?.match(/^Q(\d+)\b/i)
        if (!firstQuestionLine) continue

        const questionNumber = Number.parseInt(firstQuestionLine[1], 10)
        let correctOptionId: string | null = null
        let explanation: string | null = null
        let collectingExplanation = false

        for (const line of lines.slice(1)) {
            const correctAnswerMatch = line.match(ANSWER_LINE_REGEX)
            if (correctAnswerMatch) {
                correctOptionId = normalizeAnswerIdent(correctAnswerMatch[1])
                collectingExplanation = false
                continue
            }

            const explanationMatch = line.match(EXPLANATION_LINE_REGEX)
            if (explanationMatch) {
                explanation = normalizeStem(explanationMatch[1])
                collectingExplanation = true
                continue
            }

            if (collectingExplanation) {
                if (/^(?:difficulty|topic|correct\s*answer|answer)\b/i.test(line)) {
                    collectingExplanation = false
                    continue
                }

                explanation = `${explanation ?? ''} ${normalizeStem(line)}`.trim()
            }
        }

        if (correctOptionId || explanation) {
            detailedAnswers.set(questionNumber, {
                correctOptionId,
                explanation,
            })
        }
    }

    return detailedAnswers
}

function parseQuestionBlock(
    block: StructuredQuestionBlock,
    answerKey: Map<number, string>,
    detailedAnswers: Map<number, StructuredAnswerDetail>,
    genericStemHint?: string | null,
): ParsedStructuredQuestion {
    const rawLines = block.rawLines
        .map(line => line.trim())
        .filter(Boolean)

    if (rawLines.length === 0) {
        return {
            questionNumber: block.questionNumber,
            answerHintUsed: false,
            blockText: block.blockText,
            optionCount: 0,
            valid: false,
            question: null,
        }
    }

    const firstLine = stripQuestionLabel(rawLines[0]) ?? parseExplicitQuestionLabelWithoutNoise(rawLines[0] ?? '')
    if (!firstLine) {
        return {
            questionNumber: block.questionNumber,
            answerHintUsed: false,
            blockText: block.blockText,
            optionCount: 0,
            valid: false,
            question: null,
        }
    }

    const inlineOptions = firstLine.stem ? extractInlineLetterOptions(firstLine.stem) : null
    const stemParts = firstLine.stem ? [inlineOptions?.stem ?? firstLine.stem] : []
    const sharedContextParts: string[] = []
    const options = new Map<string, string>()
    let activeOption: string | null = null
    let activeSection: 'stem' | 'option' | 'explanation' | 'statement' = 'stem'
    let correctOptionId: string | null = firstLine.inlineAnswerId
    let explanation = ''
    let difficulty: GeneratedQuestion['difficulty'] | null = null
    let topic: string | null = null
    let answerHintUsed = Boolean(firstLine.inlineAnswerId)
    let answerSeen = false
    let answerSource: GeneratedQuestion['answerSource'] = firstLine.inlineAnswerId ? 'INLINE_ANSWER' : 'INFERRED'
    let activeStatement = false

    for (const option of inlineOptions?.options ?? []) {
        options.set(option.optionId, option.text)
    }

    const optionCandidates = rawLines
        .slice(1)
        .map((line, index) => ({ index, line, option: matchOptionLine(line) }))
        .filter((entry): entry is { index: number; line: string; option: { optionId: string; text: string; sourceType: 'LETTER' | 'NUMBER' } } => entry.option !== null)

    const numericOptionEntries = optionCandidates.filter(entry => entry.option.sourceType === 'NUMBER')
    const firstNumericOptionIndex = numericOptionEntries[0]?.index ?? -1
    const leadingLetterOptionCount = optionCandidates.filter(
        entry => entry.option.sourceType === 'LETTER' && (firstNumericOptionIndex === -1 || entry.index < firstNumericOptionIndex),
    ).length
    const useStatementStyleOptions = numericOptionEntries.length >= 4 && leadingLetterOptionCount >= 2
    const uppercaseLetterOptionEntries = optionCandidates.filter(
        entry => entry.option.sourceType === 'LETTER' && isUppercaseLetterOptionLine(entry.line),
    )
    const firstUppercaseLetterOptionIndex = uppercaseLetterOptionEntries[0]?.index ?? -1
    const leadingLowercaseLetterOptionCount = optionCandidates.filter(
        entry => entry.option.sourceType === 'LETTER'
            && isLowercaseLetterOptionLine(entry.line)
            && (firstUppercaseLetterOptionIndex === -1 || entry.index < firstUppercaseLetterOptionIndex),
    ).length
    const useLowercaseStatementOptions = uppercaseLetterOptionEntries.length >= 4 && leadingLowercaseLetterOptionCount >= 2
    const bareNumberedStemEntries = rawLines
        .slice(1)
        .map((line, index) => ({
            index,
            line,
            statement: isBareNumberedStemStatementLine(line),
        }))
        .filter((entry): entry is { index: number; line: string; statement: { questionNumber: number; stem: string } } => entry.statement !== null)
    const lastBareNumberedStemIndex = bareNumberedStemEntries.at(-1)?.index ?? -1
    const parenthesizedNumericOptionCountAfterBareStem = optionCandidates.filter(
        entry => entry.option.sourceType === 'NUMBER'
            && isParenthesizedNumericOptionLine(entry.line)
            && entry.index > lastBareNumberedStemIndex,
    ).length
    const parenthesizedLetterOptionCountAfterBareStem = optionCandidates.filter(
        entry => entry.option.sourceType === 'LETTER'
            && /^\([A-Da-d]\)\s+/.test(entry.line.trim())
            && entry.index > lastBareNumberedStemIndex,
    ).length
    const useBareNumberedStemStatements = bareNumberedStemEntries.length >= 2
        && (
            parenthesizedNumericOptionCountAfterBareStem >= 4
            || parenthesizedLetterOptionCountAfterBareStem >= 4
        )
    const useStatementContinuation = useStatementStyleOptions || useLowercaseStatementOptions || useBareNumberedStemStatements

    // Match-the-following pattern: uppercase labels (A. Catechol) AND numeric matching targets (1. Benzene-...)
    // in the stem, with lowercase (a)-(d) as the actual answer options that appear AFTER all numeric items.
    // e.g. Ques 3: Match List I (A-D) with List II (1-4); options are (a) A-2,B-4… (b) A-2,B-1…
    const lastNumericOptionIndex = numericOptionEntries.at(-1)?.index ?? -1
    const lowercaseOptionsAfterNumerics = optionCandidates.filter(
        entry => entry.option.sourceType === 'LETTER'
            && isLowercaseLetterOptionLine(entry.line)
            && entry.index > lastNumericOptionIndex,
    )
    const useLowercaseAsOptions = useStatementStyleOptions && lowercaseOptionsAfterNumerics.length >= 4
    const lowercaseOptionsAfterUppercase = optionCandidates.filter(
        entry => entry.option.sourceType === 'LETTER'
            && isLowercaseLetterOptionLine(entry.line)
            && entry.index > firstUppercaseLetterOptionIndex,
    )
    const useUppercaseMatchRowsAsContext = !useLowercaseAsOptions
        && uppercaseLetterOptionEntries.length >= 2
        && lowercaseOptionsAfterUppercase.length >= 4
    const lowercaseOptionLineSet: Set<string> = (useLowercaseAsOptions
        ? lowercaseOptionsAfterNumerics
        : useUppercaseMatchRowsAsContext
            ? lowercaseOptionsAfterUppercase
            : []
    )
        .length > 0
        ? new Set((useLowercaseAsOptions
            ? lowercaseOptionsAfterNumerics
            : lowercaseOptionsAfterUppercase
        ).map(entry => entry.line))
        : new Set()

    for (const line of rawLines.slice(1)) {
        const bareNumberedStemStatement = useBareNumberedStemStatements
            ? isBareNumberedStemStatementLine(line)
            : null
        const questionLabel = bareNumberedStemStatement ? null : stripQuestionLabel(line)
        if (questionLabel && !bareNumberedStemStatement) {
            const shouldKeepInCurrentBlock = isSuspiciousBareQuestionJump(questionLabel, firstLine.questionNumber, line)
                && (
                    activeSection === 'explanation'
                    || Boolean(explanation)
                    || answerSeen
                    || options.size >= 4
                )

            if (shouldKeepInCurrentBlock) {
                if (activeSection === 'explanation' && explanation) {
                    explanation = `${explanation} ${normalizeStem(line)}`.trim()
                } else if (!answerSeen && activeOption && options.has(activeOption)) {
                    options.set(activeOption, `${options.get(activeOption)} ${normalizeOptionText(line)}`.trim())
                } else {
                    stemParts.push(normalizeStem(line))
                }
                continue
            }

            // If the previous stem content ends with a hyphen and the current line starts with
            // a digit, this is a hyphenated word split across PDF lines (e.g. "2-methylprop-" /
            // "1-ene instead of an ether?"). Merge it back into the stem rather than breaking.
            const lastStem = stemParts.at(-1) ?? ''
            if (lastStem.endsWith('-') && /^\d/.test(line.trim())) {
                stemParts[stemParts.length - 1] = lastStem + normalizeStem(line)
                continue
            }
            break
        }

        if (!answerSeen && /^(?:assertion|reason)\s*[:\-]/i.test(line)) {
            stemParts.push(normalizeStem(line))
            activeOption = null
            activeSection = 'stem'
            activeStatement = false
            continue
        }

        const answerMatch = line.match(ANSWER_LINE_REGEX)
        if (answerMatch) {
            correctOptionId = normalizeAnswerIdent(answerMatch[1])
            answerHintUsed = true
            answerSource = 'INLINE_ANSWER'
            // Some coaching PDFs put "Answer: ..." before the actual option block.
            // Only freeze further option parsing once the full choice set is already present.
            answerSeen = options.size >= 4
            activeOption = null
            activeSection = 'stem'
            continue
        }

        const explanationMatch = line.match(EXPLANATION_LINE_REGEX)
        if (explanationMatch) {
            explanation = explanationMatch[1].trim()
            activeOption = null
            activeSection = 'explanation'
            continue
        }

        const difficultyMatch = line.match(DIFFICULTY_LINE_REGEX)
        if (difficultyMatch) {
            difficulty = difficultyMatch[1].toUpperCase() as GeneratedQuestion['difficulty']
            activeOption = null
            activeSection = 'stem'
            continue
        }

        const topicMatch = line.match(TOPIC_LINE_REGEX)
        if (topicMatch) {
            topic = normalizeStem(topicMatch[1])
            activeOption = null
            activeSection = 'stem'
            activeStatement = false
            continue
        }

        if (!answerSeen && (useStatementStyleOptions || useBareNumberedStemStatements) && isSelectionPromptLine(line)) {
            stemParts.push(normalizeSelectionPromptLine(line))
            activeOption = null
            activeSection = 'stem'
            activeStatement = false
            continue
        }

        if (
            !answerSeen
            && (useLowercaseAsOptions || useUppercaseMatchRowsAsContext)
            && !lowercaseOptionLineSet.has(line)
            && isMatchFollowingContextLine(line)
        ) {
            sharedContextParts.push(line.trim())
            activeOption = null
            activeSection = 'statement'
            activeStatement = true
            continue
        }

        if (!answerSeen) {
            if (bareNumberedStemStatement) {
                stemParts.push(`${bareNumberedStemStatement.questionNumber}. ${normalizeStem(bareNumberedStemStatement.stem)}`)
                activeOption = null
                activeSection = 'statement'
                activeStatement = true
                continue
            }

            const inlineLineOptions = extractInlineLetterOptions(line, { allowEmptyStem: true })
            if (inlineLineOptions) {
                const normalizedInlineStem = inlineLineOptions.stem
                    ? normalizeSelectionPromptLine(inlineLineOptions.stem)
                    : ''

                if (normalizedInlineStem) {
                    stemParts.push(normalizedInlineStem)
                }

                for (const option of inlineLineOptions.options) {
                    options.set(option.optionId, option.text)
                }

                activeOption = null
                activeSection = 'option'
                activeStatement = false
                continue
            }

            const optionResult = matchOptionLine(line)
            if (optionResult) {
                const optionText = normalizeOptionText(optionResult.text)

                if (!optionText) continue

                // Match-the-following: List-I labels (A-D) and List-II numeric items (1-4) both
                // belong in the stem; only the trailing lowercase options (a-d) are real answer choices.
                if (useLowercaseAsOptions) {
                    if (lowercaseOptionLineSet.has(line)) {
                        options.set(optionResult.optionId, optionText)
                        activeOption = optionResult.optionId
                        activeSection = 'option'
                        activeStatement = false
                    } else {
                        sharedContextParts.push(line.trim())
                        activeOption = null
                        activeSection = 'statement'
                        activeStatement = true
                    }
                    continue
                }

                if (useUppercaseMatchRowsAsContext) {
                    if (lowercaseOptionLineSet.has(line)) {
                        options.set(optionResult.optionId, optionText)
                        activeOption = optionResult.optionId
                        activeSection = 'option'
                        activeStatement = false
                    } else {
                        sharedContextParts.push(line.trim())
                        activeOption = null
                        activeSection = 'statement'
                        activeStatement = true
                    }
                    continue
                }

                if (useStatementStyleOptions && optionResult.sourceType === 'LETTER') {
                    stemParts.push(`(${optionResult.optionId}) ${optionText}`)
                    activeOption = null
                    activeSection = 'statement'
                    activeStatement = true
                    continue
                }

                if (useLowercaseStatementOptions && optionResult.sourceType === 'LETTER' && isLowercaseLetterOptionLine(line)) {
                    stemParts.push(normalizeStem(line))
                    activeOption = null
                    activeSection = 'statement'
                    activeStatement = true
                    continue
                }

                if (/\((?:correct)\)|\[(?:correct)\]|✓|✅/i.test(optionResult.text)) {
                    correctOptionId = optionResult.optionId
                    answerHintUsed = true
                    answerSource = 'INLINE_ANSWER'
                }

                options.set(optionResult.optionId, optionText)
                activeOption = optionResult.optionId
                activeSection = 'option'
                activeStatement = false
                continue
            }
        }

        if (!answerSeen && activeOption && options.has(activeOption)) {
            options.set(activeOption, `${options.get(activeOption)} ${normalizeOptionText(line)}`.trim())
            continue
        }

        if (!answerSeen && useStatementContinuation && activeStatement) {
            if (isSelectionPromptLine(line)) {
                stemParts.push(normalizeStem(line))
                activeSection = 'stem'
                activeStatement = false
                continue
            }

            const previousStemPart = stemParts.pop() ?? ''
            stemParts.push(`${previousStemPart} ${normalizeOptionText(line)}`.trim())
            continue
        }

        if (activeSection === 'explanation' && explanation) {
            explanation = `${explanation} ${normalizeOptionText(line)}`.trim()
            continue
        }

        if (answerSeen) {
            continue
        }

        stemParts.push(line)
        activeSection = 'stem'
        activeStatement = false
    }

    const detailedAnswer = detailedAnswers.get(firstLine.questionNumber)
    if (!correctOptionId) {
        const detailedCorrectOptionId = detailedAnswer?.correctOptionId
        const keyedAnswer = detailedCorrectOptionId || answerKey.get(firstLine.questionNumber)
        if (keyedAnswer) {
            correctOptionId = keyedAnswer
            answerHintUsed = true
            answerSource = 'ANSWER_KEY'
        }
    }

    if (!explanation && detailedAnswer?.explanation) {
        explanation = detailedAnswer.explanation
    }

    const normalizedStemText = normalizeStem(stemParts.join(' ')) || normalizeStem(genericStemHint ?? '')
    const isAssertionReasonQuestion = /assertion\s*[:(]/i.test(normalizedStemText) && /reason\s*[:(]/i.test(normalizedStemText)

    if (options.size === 0 && isAssertionReasonQuestion) {
        for (const [optionId, text] of ASSERTION_REASON_OPTION_SET) {
            options.set(optionId, text)
        }
    }

    const optionEntries = ['A', 'B', 'C', 'D']
        .map(id => {
            const text = options.get(id)
            if (!text) return null
            return { id, text, isCorrect: id === correctOptionId }
        })
        .filter((option): option is { id: string; text: string; isCorrect: boolean } => option !== null)

    const question: GeneratedQuestion = {
        stem: normalizedStemText,
        options: optionEntries,
        explanation: explanation || 'Imported from structured MCQ document.',
        difficulty: difficulty || guessDifficulty(normalizedStemText),
        topic: topic || detectTopic(normalizedStemText),
        sharedContext: normalizeSharedContextText(sharedContextParts.join('\n')),
        sourcePage: null,
        sourceSnippet: truncateEvidenceText(block.blockText),
        answerSource,
        confidence: normalizeConfidenceScore(
            answerSource === 'ANSWER_KEY'
                ? 0.98
                : answerSource === 'INLINE_ANSWER'
                    ? 0.95
                    : 0.8
        ),
        sharedContextEvidence: truncateEvidenceText(sharedContextParts.join('\n')),
        extractionMode: 'TEXT_EXACT',
    }

    return {
        questionNumber: firstLine.questionNumber,
        answerHintUsed,
        blockText: block.blockText,
        optionCount: optionEntries.length,
        valid: validateQuestion(question),
        question: validateQuestion(question) ? question : null,
    }
}

function buildExpectedQuestionSequence(questionNumbers: number[]) {
    if (questionNumbers.length < 5) return null

    const uniqueQuestionNumbers = [...new Set(questionNumbers)].sort((left, right) => left - right)
    if (uniqueQuestionNumbers[0] !== 1) return null

    const maxQuestionNumber = uniqueQuestionNumbers.at(-1) ?? 0
    const missingQuestionNumbers: number[] = []
    const seenNumbers = new Set(uniqueQuestionNumbers)

    for (let questionNumber = 1; questionNumber <= maxQuestionNumber; questionNumber++) {
        if (!seenNumbers.has(questionNumber)) {
            missingQuestionNumbers.push(questionNumber)
        }
    }

    const maxAllowedMissingQuestions = Math.max(3, Math.floor(maxQuestionNumber * 0.1))
    if (missingQuestionNumbers.length > maxAllowedMissingQuestions) {
        return null
    }

    return Array.from({ length: maxQuestionNumber }, (_, index) => index + 1)
}

function buildStructuredExtractionContext(text: string): StructuredExtractionContext {
    const normalizedText = normalizeDocumentText(text)
    const { questionSection: rawQuestionSection, answerSection } = splitDocumentSections(normalizedText)
    const questionSection = pruneRepeatedQuestionSequence(rawQuestionSection)
    const collectedBlocks = isolatePrimaryQuestionSequence(
        splitEmbeddedExplicitQuestionStarts(
            collectStructuredQuestionBlocks(questionSection),
        ),
    )
    const genericStemHint = deriveGenericStemHint(questionSection)
    const answerKey = extractAnswerKey(answerSection)
    const detailedAnswers = extractDetailedAnswerRecords(answerSection)

    const questionBlocks = new Map<number, StructuredQuestionBlock>()
    const duplicateQuestionNumbers = new Set<number>()
    for (const block of collectedBlocks) {
        const existing = questionBlocks.get(block.questionNumber)
        if (!existing) {
            questionBlocks.set(block.questionNumber, block)
        }
        if (existing) {
            duplicateQuestionNumbers.add(block.questionNumber)
        }
    }

    const parsedQuestions = new Map<number, ParsedStructuredQuestion>()
    const invalidQuestionNumbers = new Set<number>()
    let answerHintCount = 0

    for (const block of questionBlocks.values()) {
        const parsedQuestion = parseQuestionBlock(block, answerKey, detailedAnswers, genericStemHint)
        if (parsedQuestion.answerHintUsed) {
            answerHintCount++
        }

        parsedQuestions.set(parsedQuestion.questionNumber, parsedQuestion)
        if (!parsedQuestion.valid || parsedQuestion.question === null) {
            invalidQuestionNumbers.add(parsedQuestion.questionNumber)
        }
    }

    const questionNumbers = [...questionBlocks.keys()].sort((left, right) => left - right)
    const expectedQuestionSequence = buildExpectedQuestionSequence(questionNumbers)
    const validQuestionsByNumber = new Map<number, GeneratedQuestion>()
    for (const parsedQuestion of parsedQuestions.values()) {
        if (parsedQuestion.valid && parsedQuestion.question) {
            if (!validQuestionsByNumber.has(parsedQuestion.questionNumber)) {
                validQuestionsByNumber.set(parsedQuestion.questionNumber, parsedQuestion.question)
            }
        }
    }

    const missingQuestionNumbers = expectedQuestionSequence
        ? expectedQuestionSequence.filter(questionNumber => !validQuestionsByNumber.has(questionNumber))
        : []

    const orderedQuestions = expectedQuestionSequence
        ? expectedQuestionSequence
            .map(questionNumber => validQuestionsByNumber.get(questionNumber))
            .filter((question): question is GeneratedQuestion => question !== undefined)
        : [...validQuestionsByNumber.entries()]
            .sort((left, right) => left[0] - right[0])
            .map(([, question]) => question)

    const detectedAsMcqDocument = expectedQuestionSequence !== null
        && (
            questionBlocks.size >= 5
            || answerKey.size >= 5
            || answerHintCount >= Math.max(3, Math.floor(questionBlocks.size * 0.5))
        )

    const exactMatchAchieved = expectedQuestionSequence !== null
        ? missingQuestionNumbers.length === 0 && duplicateQuestionNumbers.size === 0
        : orderedQuestions.length > 0

    return {
        answerSection,
        questionBlocks,
        parsedQuestions,
        genericStemHint,
        analysis: {
            detectedAsMcqDocument,
            answerHintCount,
            candidateBlockCount: questionBlocks.size,
            questions: orderedQuestions,
            expectedQuestionCount: expectedQuestionSequence?.length ?? null,
            exactMatchAchieved,
            invalidQuestionNumbers: [...invalidQuestionNumbers].sort((left, right) => left - right),
            missingQuestionNumbers,
            duplicateQuestionNumbers: [...duplicateQuestionNumbers].sort((left, right) => left - right),
        },
    }
}

export function extractQuestionsFromDocumentText(text: string): ExtractedQuestionAnalysis {
    return buildStructuredExtractionContext(text).analysis
}

function answerSourceStrength(answerSource: GeneratedQuestion['answerSource']) {
    switch (answerSource) {
        case 'ANSWER_KEY':
            return 3
        case 'INLINE_ANSWER':
            return 2
        case 'INFERRED':
            return 1
        default:
            return 0
    }
}

function extractAnswerHintsFromText(text: string): Map<number, DocumentAnswerHint> {
    const normalizedText = normalizeDocumentText(text)
    const { answerSection } = splitDocumentSections(normalizedText)
    const answerHints = new Map<number, DocumentAnswerHint>()

    const lines = normalizedText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

    let currentQuestionNumber: number | null = null

    for (const line of lines) {
        const questionLabel = stripQuestionLabel(line)
        if (questionLabel) {
            currentQuestionNumber = questionLabel.questionNumber
            if (questionLabel.inlineAnswerId) {
                answerHints.set(questionLabel.questionNumber, {
                    correctOptionId: questionLabel.inlineAnswerId,
                    answerSource: 'INLINE_ANSWER',
                    evidence: truncateEvidenceText(line),
                })
            }
        }

        const answerMatch = line.match(ANSWER_LINE_REGEX)
        if (answerMatch && currentQuestionNumber !== null) {
            answerHints.set(currentQuestionNumber, {
                correctOptionId: normalizeAnswerIdent(answerMatch[1]),
                answerSource: 'INLINE_ANSWER',
                evidence: truncateEvidenceText(line),
            })
        }
    }

    if (answerSection) {
        const keyedAnswers = extractAnswerKey(answerSection)
        for (const [questionNumber, correctOptionId] of keyedAnswers.entries()) {
            if (!answerHints.has(questionNumber)) {
                answerHints.set(questionNumber, {
                    correctOptionId,
                    answerSource: 'ANSWER_KEY',
                    evidence: truncateEvidenceText(
                        buildAnswerContextSnippet(answerSection, questionNumber)
                        ?? `Q${questionNumber} ${correctOptionId}`,
                    ),
                })
            }
        }
    }

    return answerHints
}

export function reconcileGeneratedQuestionsWithTextAnswerHints(
    questions: GeneratedQuestion[],
    text: string,
) {
    const answerHints = extractAnswerHintsFromText(text)
    let repairedCount = 0

    const reconciledQuestions = questions.map((question, index) => {
        const questionNumber = index + 1
        const answerHint = answerHints.get(questionNumber)
        if (!answerHint) {
            return question
        }

        const currentCorrectOptions = question.options.filter((option) => option.isCorrect)
        const currentCorrectOptionId = currentCorrectOptions[0]?.id ?? null
        const shouldRepairCorrectOption =
            currentCorrectOptions.length !== 1
            || currentCorrectOptionId !== answerHint.correctOptionId
            || answerSourceStrength(question.answerSource) < answerSourceStrength(answerHint.answerSource)

        const nextQuestion: GeneratedQuestion = shouldRepairCorrectOption
            ? {
                ...question,
                options: question.options.map((option) => ({
                    ...option,
                    isCorrect: option.id === answerHint.correctOptionId,
                })),
                answerSource: answerHint.answerSource,
                confidence: normalizeConfidenceScore(
                    Math.max(question.confidence ?? 0, answerHint.answerSource === 'ANSWER_KEY' ? 0.97 : 0.94),
                ),
                sourceSnippet: question.sourceSnippet ?? answerHint.evidence,
                sharedContextEvidence: question.sharedContextEvidence ?? answerHint.evidence,
            }
            : {
                ...question,
                sourceSnippet: question.sourceSnippet ?? answerHint.evidence,
                sharedContextEvidence: question.sharedContextEvidence ?? answerHint.evidence,
            }

        if (shouldRepairCorrectOption) {
            repairedCount += 1
        }

        return nextQuestion
    })

    return {
        questions: reconciledQuestions,
        repairedCount,
        answerHintsRecovered: answerHints.size,
    }
}

function buildAnswerContextSnippet(answerSection: string, questionNumber: number) {
    if (!answerSection) return null

    const directQuestionMatch = answerSection.match(
        new RegExp(`(?:^|\\n)Q${questionNumber}\\b[\\s\\S]{0,1200}`, 'i')
    )
    if (directQuestionMatch) {
        return directQuestionMatch[0].trim()
    }

    const gridMatch = answerSection.match(
        new RegExp(`Q${questionNumber}\\b[\\s\\S]{0,300}`, 'i')
    )
    return gridMatch?.[0]?.trim() ?? null
}

async function repairStructuredQuestionSetWithAI(
    context: StructuredExtractionContext,
    auditUserId?: string,
): Promise<{ questions: Map<number, GeneratedQuestion>; cost?: CostInfo; error?: boolean; message?: string }> {
    const expectedQuestionCount = context.analysis.expectedQuestionCount
    if (expectedQuestionCount === null) {
        return { questions: new Map() }
    }

    const repairQuestionNumbers = [...new Set([
        ...context.analysis.invalidQuestionNumbers,
        ...context.analysis.missingQuestionNumbers,
    ])].sort((left, right) => left - right)

    if (repairQuestionNumbers.length === 0) {
        return { questions: new Map() }
    }

    if (!openai) {
        return {
            questions: new Map(),
            error: true,
            message: `Detected ${expectedQuestionCount} numbered MCQs but could not recover them exactly. OpenAI repair is unavailable because OPENAI_API_KEY is not configured.`,
        }
    }

    const model = 'gpt-4o-mini'
    const totalCost: CostInfo = { model, inputTokens: 0, outputTokens: 0, costUSD: 0 }
    const repairedQuestions = new Map<number, GeneratedQuestion>()
    const repairBatches = chunkArray(repairQuestionNumbers, 8)

    for (const repairBatch of repairBatches) {
        const batchContext = repairBatch.map(questionNumber => {
            const questionBlock = context.questionBlocks.get(questionNumber)
            const parsedQuestion = context.parsedQuestions.get(questionNumber)
            const parserIssue = parsedQuestion
                ? (
                    parsedQuestion.valid
                        ? 'Missing from final exact set.'
                        : `Parser could not validate this block (optionCount=${parsedQuestion.optionCount}).`
                )
                : 'Question block was missing from the parser output.'

            return [
                `Question ${questionNumber}`,
                `Parser issue: ${parserIssue}`,
                'Question block:',
                questionBlock?.blockText ?? '[missing]',
                'Answer context:',
                buildAnswerContextSnippet(context.answerSection, questionNumber) ?? '[none]',
            ].join('\n')
        }).join('\n\n---\n\n')

        const prompt = `You are repairing MCQ extraction from a text-only coaching document.

Extract only the requested numbered questions and return strict JSON:
{
  "questions": [
    {
      "questionNumber": 1,
      "stem": "question text",
      "options": [
        {"id": "A", "text": "option text", "isCorrect": false},
        {"id": "B", "text": "option text", "isCorrect": true},
        {"id": "C", "text": "option text", "isCorrect": false},
        {"id": "D", "text": "option text", "isCorrect": false}
      ],
      "explanation": "brief explanation",
      "difficulty": "EASY" | "MEDIUM" | "HARD",
      "topic": "short topic tag"
    }
  ]
}

Rules:
- Return only these question numbers: ${repairBatch.join(', ')}.
- Use only the provided text. Do not invent extra facts or renumber questions.
- Exactly 4 options, labeled A-D.
- Exactly 1 correct option.
- If the answer context gives 1/2/3/4, map it to A/B/C/D.
- Ignore instructions, headers, color guides, and answer-key-only lines.
- If a question cannot be recovered with confidence, omit it entirely from the JSON.

Repair targets:
${batchContext}`

        try {
            const response = await openai.chat.completions.create({
                model,
                temperature: 0,
                max_tokens: 4000,
                response_format: { type: 'json_object' },
                messages: [{ role: 'user', content: prompt }],
            })

            const content = response.choices[0]?.message?.content
            if (!content) {
                continue
            }

            const parsed = JSON.parse(content) as {
                questions?: Array<Partial<GeneratedQuestion> & { questionNumber?: number }>
            }

            const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : []
            for (const rawQuestion of rawQuestions) {
                const questionNumber = Number(rawQuestion.questionNumber)
                if (!Number.isInteger(questionNumber) || !repairBatch.includes(questionNumber)) {
                    continue
                }

                const validatedQuestion = toValidatedGeneratedQuestion(rawQuestion)
                if (validatedQuestion) {
                    repairedQuestions.set(questionNumber, validatedQuestion)
                }
            }

            const cost = calculateCost(model, response.usage as { prompt_tokens?: number; completion_tokens?: number })
            totalCost.inputTokens += cost.inputTokens
            totalCost.outputTokens += cost.outputTokens
            totalCost.costUSD += cost.costUSD
        } catch (error) {
            const failure = toAIChunkFailure(error)
            return {
                questions: repairedQuestions,
                cost: totalCost,
                error: true,
                message: failure.message,
            }
        }
    }

    if (auditUserId && (totalCost.inputTokens > 0 || totalCost.outputTokens > 0)) {
        await logCostToAudit(auditUserId, 'AI_DOC_REPAIR', totalCost)
    }

    return {
        questions: repairedQuestions,
        cost: totalCost.inputTokens > 0 || totalCost.outputTokens > 0 ? totalCost : undefined,
    }
}

// ── AI-Based Extraction Fallback ──
// Used when the regex parser fails to recognise the document format.
// Sends the raw text to GPT-4o and asks it to extract any existing MCQs faithfully.
// Unlike generateFromChunk, this never invents new questions — if no MCQs are found
// it returns an empty array so the caller can decide whether to fall through to generation.
async function extractQuestionsFromTextWithAIChunk(
    chunk: string,
    model: string,
    chunkLabel: string,
    depth = 0,
): Promise<{
    questions: GeneratedQuestion[]
    failedCount: number
    cost?: CostInfo
    failure?: AIChunkFailure
    warnings: string[]
}> {
    const prompt = `You are an expert at extracting existing MCQs from educational documents.

TASK: If the text contains pre-existing multiple-choice questions (MCQs), extract them faithfully. Do NOT create new questions.

FORMAT HANDLING:

1. MATCH-THE-FOLLOWING: Look for "List I / List II", "Column A / Column B", or similar pairing tables.
   Include the complete matching table in the stem. Preserve option combinations like "a-i, b-ii, c-iii, d-iv".
   Also include the table in "sharedContext".

2. ASSERTION-REASON: Look for "Assertion (A):" and "Reason (R):" pairs.
   Include BOTH assertion and reason text in the stem.
   Standard options: (A) Both true, R explains A / (B) Both true, R does not explain A / (C) A true, R false / (D) A false, R true.

3. STATEMENT-COMBINATION: Look for "Consider the following statements: I. ... II. ..."
   Include all statements in the stem. Options combine statement numbers.

4. PASSAGE-BASED: If questions reference a shared passage, table, or case study, include it in "sharedContext".

5. HORIZONTAL ANSWER KEYS: Some documents list answers in table format at the end (e.g., "1-B  2-A  3-C").
   Use these to determine the correct option for each question.

6. STEMLESS / IMPLICIT-STEM QUESTIONS:
   Some questions have NO explicit stem text — just a number (e.g., "Q1.", "1.") followed by options.
   This is common in "Odd One Out", "Figure Completion", "Ranking" formats.
   INFER the stem from the section heading or question type:
   - Under "ODD ONE OUT": use "Which of the following is the odd one out?"
   - Under "FIGURE COMPLETION": use "Which figure completes the pattern?"
   - Under "RANKING": use "Arrange the following in the correct order."
   NEVER return a stem shorter than 10 characters.

If MCQs are present:
- Extract each question stem exactly as written (preserve multi-line stems, assertion/reason pairs, numbered statements, etc.)
- Extract all answer options exactly as written; label them A, B, C, D in order
- Determine the correct answer from any answer key, "Answer:", "Ans:", or inline answer markers
- Use the provided explanation if present; otherwise write a brief one
- Infer difficulty (EASY/MEDIUM/HARD) and a short topic tag
- Set "answerSource" to "ANSWER_KEY", "INLINE_ANSWER", or "INFERRED"
- Set "confidence" (0-1) based on how certain you are of the extraction accuracy

If the document is theory, notes, or contains no MCQs, return: {"questions": []}

Return strict JSON only — no markdown, no prose:
{
  "questions": [
    {
      "stem": "question text",
      "options": [
        {"id": "A", "text": "...", "isCorrect": false},
        {"id": "B", "text": "...", "isCorrect": true},
        {"id": "C", "text": "...", "isCorrect": false},
        {"id": "D", "text": "...", "isCorrect": false}
      ],
      "explanation": "...",
      "difficulty": "EASY",
      "topic": "short topic tag",
      "sharedContext": "passage, table, or diagram text if applicable, otherwise null",
      "sharedContextEvidence": "brief note on what shared content this question depends on, or null",
      "sourceSnippet": "short verbatim excerpt from the source that anchors this question",
      "answerSource": "ANSWER_KEY",
      "confidence": 0.95
    }
  ]
}

Rules:
- Exactly 4 options per question (A–D); exactly 1 isCorrect: true
- Preserve the original wording — do not paraphrase or simplify
- Skip any question where the correct answer cannot be determined and cannot be reasonably inferred
- Ignore page numbers, headers, footers, colour guides, and answer-key-only rows

Text:
${chunk}`

    try {
        const response = await withOpenAIRetries(
            chunkLabel,
            () => openai!.responses.parse({
                model,
                temperature: 0,
                max_output_tokens: 8000,
                input: [
                    {
                        role: 'system',
                        content: 'You faithfully extract existing MCQs from source documents and return only strict structured output.',
                    },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'input_text',
                                text: prompt,
                            },
                        ],
                    },
                ],
                text: {
                    format: zodTextFormat(McqExtractionResponseSchema, 'mcq_text_extraction_response'),
                },
            }),
        )

        const cost = calculateCost(model, response.usage)
        if (isMaxOutputTokenTruncationResponse(response)) {
            const truncationWarning = `${chunkLabel} hit max_output_tokens; retrying with smaller text windows.`
            console.warn(`[AI] ${truncationWarning}`)
            const retryChunks = splitTextChunkForRetry(chunk)

            if (depth >= 2 || retryChunks.length < 2) {
                return {
                    questions: [],
                    failedCount: 0,
                    cost,
                    failure: buildMaxOutputTokenFailure(chunkLabel),
                    warnings: [truncationWarning],
                }
            }

            const retriedResults = await Promise.all(
                retryChunks.map((retryChunk, index) => (
                    extractQuestionsFromTextWithAIChunk(
                        retryChunk,
                        model,
                        `${chunkLabel} (split ${index + 1})`,
                        depth + 1,
                    )
                )),
            )

            const mergedQuestions = deduplicateQuestions(
                retriedResults.flatMap((result) => result.questions),
            )
            const mergedCost = mergeCosts(cost, ...retriedResults.map((result) => result.cost))
            const warnings = [truncationWarning, ...retriedResults.flatMap((result) => result.warnings)]
            const lastFailure = retriedResults.find((result) => result.failure)?.failure

            return {
                questions: mergedQuestions,
                failedCount: retriedResults.reduce((sum, result) => sum + result.failedCount, 0),
                cost: mergedCost,
                ...(lastFailure && mergedQuestions.length === 0 ? { failure: lastFailure } : {}),
                warnings,
            }
        }

        const { questions, failedCount } = coerceGeneratedQuestions(response.output_parsed?.questions ?? [])
        return {
            questions,
            failedCount,
            cost,
            warnings: [],
        }
    } catch (error) {
        return {
            questions: [],
            failedCount: 0,
            failure: toAIChunkFailure(error),
            warnings: [],
        }
    }
}

async function extractQuestionsFromTextWithAI(
    text: string,
    auditUserId?: string,
): Promise<{ questions: GeneratedQuestion[]; cost?: CostInfo; error?: boolean; message?: string }> {
    if (!openai) {
        return { questions: [], error: true, message: 'OpenAI API key not configured.' }
    }

    const model = 'gpt-4o-mini'
    const chunks = chunkDocumentTextForGeneration(text, 12000, 200)
    const allQuestions: GeneratedQuestion[] = []
    const chunkWarnings: string[] = []
    const totalCost: CostInfo = { model, inputTokens: 0, outputTokens: 0, costUSD: 0 }
    let lastFailure: AIChunkFailure | null = null

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunk = chunks[chunkIndex]
        const chunkResult = await extractQuestionsFromTextWithAIChunk(
            chunk,
            model,
            `Text extraction chunk ${chunkIndex + 1}/${chunks.length}`,
        )

        if (chunkResult.cost) {
            totalCost.inputTokens += chunkResult.cost.inputTokens
            totalCost.outputTokens += chunkResult.cost.outputTokens
            totalCost.costUSD += chunkResult.cost.costUSD
        }

        if (chunkResult.questions.length > 0) {
            allQuestions.push(...chunkResult.questions)
        }

        if (chunkResult.warnings.length > 0) {
            chunkWarnings.push(...chunkResult.warnings)
        }

        if (chunkResult.failure) {
            lastFailure = chunkResult.failure
            console.warn(`[AI] ${chunkResult.failure.message}`)
        }
    }

    if (auditUserId && (totalCost.inputTokens > 0 || totalCost.outputTokens > 0)) {
        await logCostToAudit(auditUserId, 'AI_DOC_EXTRACT', totalCost)
    }

    const dedupedQuestions = deduplicateQuestions(allQuestions)
    const warningMessage = chunkWarnings.reduce<string | undefined>(
        (message, warning) => appendAIMessage(message, warning),
        undefined,
    )

    if (dedupedQuestions.length === 0 && lastFailure) {
        return {
            questions: [],
            cost: totalCost.inputTokens > 0 || totalCost.outputTokens > 0 ? totalCost : undefined,
            error: true,
            message: warningMessage
                ? appendAIMessage(lastFailure.message, warningMessage)
                : lastFailure.message,
        }
    }

    return {
        questions: dedupedQuestions,
        cost: totalCost.inputTokens > 0 || totalCost.outputTokens > 0 ? totalCost : undefined,
        ...(warningMessage ? { message: warningMessage } : {}),
    }
}

type ExactExtractionOptions = {
    allowAiFallback?: boolean
    allowAiRepair?: boolean
}

function normalizeExactAnalysis(
    analysis: PreciseDocumentQuestionAnalysis,
): PreciseDocumentQuestionAnalysis {
    if (!analysis.exactMatchAchieved) {
        return analysis
    }

    return {
        ...analysis,
        missingQuestionNumbers: [],
        invalidQuestionNumbers: [],
        duplicateQuestionNumbers: [],
        error: false,
        message: undefined,
    }
}

export async function extractQuestionsFromDocumentTextPrecisely(
    text: string,
    auditUserId?: string,
    options: ExactExtractionOptions = {},
): Promise<PreciseDocumentQuestionAnalysis> {
    const allowAiFallback = options.allowAiFallback !== false
    const allowAiRepair = options.allowAiRepair !== false
    const context = buildStructuredExtractionContext(text)
    if (!context.analysis.detectedAsMcqDocument || context.analysis.expectedQuestionCount === null) {
        // Regex didn't recognise the document format — try AI-based extraction before
        // giving up and letting the caller fall through to question generation.
        if (allowAiFallback && text.length >= 200) {
            const aiResult = await extractQuestionsFromTextWithAI(text, auditUserId)
            if (aiResult.questions.length > 0) {
                return {
                    detectedAsMcqDocument: true,
                    answerHintCount: aiResult.questions.length,
                    candidateBlockCount: context.analysis.candidateBlockCount,
                    questions: aiResult.questions,
                    expectedQuestionCount: aiResult.questions.length,
                    exactMatchAchieved: true,
                    invalidQuestionNumbers: [],
                    missingQuestionNumbers: [],
                    duplicateQuestionNumbers: [],
                    aiRepairUsed: true,
                    cost: aiResult.cost,
                }
            }
            if (aiResult.error) {
                return {
                    ...context.analysis,
                    aiRepairUsed: false,
                    error: true,
                    message: aiResult.message,
                }
            }
        }
        return normalizeExactAnalysis({
            ...context.analysis,
            aiRepairUsed: false,
        })
    }

    if (context.analysis.exactMatchAchieved) {
        return normalizeExactAnalysis({
            ...context.analysis,
            aiRepairUsed: false,
        })
    }

    if (!allowAiRepair) {
        return {
            ...context.analysis,
            aiRepairUsed: false,
            error: true,
            message: 'Exact parser could not recover a complete MCQ set without AI repair.',
        }
    }

    const repairResult = await repairStructuredQuestionSetWithAI(context, auditUserId)
    const repairedQuestionsByNumber = new Map<number, GeneratedQuestion>()

    for (const parsedQuestion of context.parsedQuestions.values()) {
        if (parsedQuestion.valid && parsedQuestion.question) {
            repairedQuestionsByNumber.set(parsedQuestion.questionNumber, parsedQuestion.question)
        }
    }

    for (const [questionNumber, repairedQuestion] of repairResult.questions.entries()) {
        repairedQuestionsByNumber.set(questionNumber, repairedQuestion)
    }

    const expectedQuestionNumbers = Array.from(
        { length: context.analysis.expectedQuestionCount },
        (_, index) => index + 1,
    )
    const missingQuestionNumbers = expectedQuestionNumbers.filter(
        questionNumber => !repairedQuestionsByNumber.has(questionNumber),
    )
    const exactMatchAchieved = missingQuestionNumbers.length === 0
    const questions = expectedQuestionNumbers
        .map(questionNumber => repairedQuestionsByNumber.get(questionNumber))
        .filter((question): question is GeneratedQuestion => question !== undefined)

    const message = exactMatchAchieved
        ? undefined
        : (
            repairResult.message
            || `Detected ${context.analysis.expectedQuestionCount} numbered MCQs, but only recovered ${questions.length}. Missing question numbers: ${missingQuestionNumbers.join(', ')}.`
        )

    return normalizeExactAnalysis({
        ...context.analysis,
        questions,
        exactMatchAchieved,
        missingQuestionNumbers,
        invalidQuestionNumbers: exactMatchAchieved
            ? []
            : context.analysis.invalidQuestionNumbers.filter(questionNumber => missingQuestionNumbers.includes(questionNumber)),
        aiRepairUsed: repairResult.questions.size > 0,
        cost: repairResult.cost,
        error: repairResult.error || !exactMatchAchieved,
        message,
    })
}

async function classifyQuestionMetadataBatchWithAI(
    questions: GeneratedQuestion[],
): Promise<{ questions: Array<{ questionNumber: number; difficulty: GeneratedQuestion['difficulty']; topic: string }>; cost?: CostInfo; error?: boolean; message?: string }> {
    if (!openai) {
        return {
            questions: [],
            error: true,
            message: 'OpenAI API key not configured. Metadata enrichment is unavailable.',
        }
    }

    const model = 'gpt-4o-mini'
    const prompt = `You are reviewing extracted CUET-style MCQs.

For each question, assign:
- difficulty: EASY, MEDIUM, or HARD
- topic: a concise syllabus-aligned topic tag (2-6 words)

Difficulty rubric:
- EASY: direct recall, one-step identification, simple fact or formula recognition
- MEDIUM: two linked ideas, conceptual interpretation, elimination between close options, moderate calculation
- HARD: multi-step reasoning, match-the-following, assertion-reason, statement-combination, or higher cognitive discrimination

Return strict JSON:
{
  "questions": [
    {
      "questionNumber": 1,
      "difficulty": "MEDIUM",
      "topic": "Electrostatics Basics"
    }
  ]
}

Rules:
- Keep the original question numbering.
- Do not rewrite the question or options.
- Topic must stay short, specific, and curriculum-friendly.
- Classify all provided questions.

Questions:
${questions.map((question, index) => `${index + 1}. ${question.stem}
A. ${question.options[0]?.text ?? ''}
B. ${question.options[1]?.text ?? ''}
C. ${question.options[2]?.text ?? ''}
D. ${question.options[3]?.text ?? ''}
Current topic hint: ${normalizeTopicLabel(question.topic, question.stem)}
Shared context hint: ${truncateForPrompt(question.sharedContext) ?? 'None'}
Current difficulty hint: ${normalizeDifficultyLabel(question.difficulty)}`).join('\n\n')}`

    try {
        const response = await openai.chat.completions.create({
            model,
            temperature: 0,
            max_tokens: 2500,
            response_format: { type: 'json_object' },
            messages: [{ role: 'user', content: prompt }],
        })

        const content = response.choices[0]?.message?.content
        if (!content) {
            return { questions: [], error: true, message: 'OpenAI returned an empty metadata response.' }
        }

        const parsed = JSON.parse(content) as {
            questions?: Array<{ questionNumber?: number; difficulty?: string; topic?: string }>
        }
        const normalizedQuestions = Array.isArray(parsed.questions)
            ? parsed.questions
                .map(question => {
                    const questionNumber = Number(question.questionNumber)
                    if (!Number.isInteger(questionNumber) || questionNumber < 1 || questionNumber > questions.length) {
                        return null
                    }

                    return {
                        questionNumber,
                        difficulty: normalizeDifficultyLabel(question.difficulty),
                        topic: normalizeTopicLabel(question.topic, questions[questionNumber - 1]?.stem),
                    }
                })
                .filter((question): question is { questionNumber: number; difficulty: GeneratedQuestion['difficulty']; topic: string } => question !== null)
            : []

        return {
            questions: normalizedQuestions,
            cost: calculateCost(model, response.usage as { prompt_tokens?: number; completion_tokens?: number }),
        }
    } catch (error) {
        const failure = toAIChunkFailure(error)
        return {
            questions: [],
            error: true,
            message: failure.message,
        }
    }
}

interface DocumentSummaryResult {
    description?: string
    suggestedTitle?: string | null
    suggestedDurationMinutes?: number | null
    primaryTopic?: string | null
    difficultyDistribution?: { easy: number; medium: number; hard: number } | null
    cost?: CostInfo
    error?: boolean
    message?: string
}

async function summarizeDocumentQuestionSetWithAI(
    questions: GeneratedQuestion[],
    sourceLabel?: string,
): Promise<DocumentSummaryResult> {
    if (!openai) {
        return {
            description: buildFallbackDocumentDescription(questions, sourceLabel),
            error: true,
            message: 'OpenAI API key not configured. Using fallback document description.',
        }
    }

    const model = 'gpt-4o-mini'
    const hasPassageQuestions = questions.some(q => q.sharedContext && q.sharedContext.length > 100)
    const prompt = `You are analyzing a set of extracted MCQ questions to generate test metadata.

Return strict JSON with ALL of these fields:
{
  "description": "2 concise sentences under 280 chars summarizing syllabus coverage and question style",
  "suggestedTitle": "A clear, specific test title under 80 characters based on the content (e.g., 'CUET General Test - Indian History & Polity')",
  "suggestedDurationMinutes": <integer: estimated minutes based on question count, complexity, and reading load>,
  "primaryTopic": "The dominant subject area (e.g., 'Indian History', 'General Science', 'Logical Reasoning')",
  "difficultyDistribution": { "easy": <count>, "medium": <count>, "hard": <count> }
}

Rules:
- suggestedTitle should be specific to the content, not generic. Mention the subject and exam type if clear.
- suggestedDurationMinutes: use ~1.5 min per standard MCQ, ~2.5 min per passage-based or complex MCQ. Minimum 15 minutes.
- difficultyDistribution must sum to the total question count (${questions.length}).
- description: Be specific about topics covered. Do not mention parsing, AI, uploads, or engineering.
- primaryTopic: Pick the single most dominant subject from the questions.
${hasPassageQuestions ? '- This test has passage-based questions, so allocate extra time in suggestedDurationMinutes.' : ''}

Source label: ${sourceLabel ?? 'uploaded document'}
Total questions: ${questions.length}
Questions:
${questions.map((question, index) => `${index + 1}. [${normalizeDifficultyLabel(question.difficulty)}] ${normalizeTopicLabel(question.topic, question.stem)} — ${question.stem.slice(0, 120)}${truncateForPrompt(question.sharedContext, 80) ? ' [has shared context]' : ''}`).join('\n')}`

    try {
        const response = await openai.chat.completions.create({
            model,
            temperature: 0.2,
            max_tokens: 400,
            response_format: { type: 'json_object' },
            messages: [{ role: 'user', content: prompt }],
        })

        const content = response.choices[0]?.message?.content
        if (!content) {
            return { description: buildFallbackDocumentDescription(questions, sourceLabel), error: true, message: 'OpenAI returned an empty document summary response.' }
        }

        const parsed = JSON.parse(content) as {
            description?: string
            suggestedTitle?: string
            suggestedDurationMinutes?: number
            primaryTopic?: string
            difficultyDistribution?: { easy?: number; medium?: number; hard?: number }
        }

        const description = parsed.description?.replace(/\s+/g, ' ').trim()
        const suggestedTitle = parsed.suggestedTitle?.replace(/\s+/g, ' ').trim()
        const suggestedDuration = typeof parsed.suggestedDurationMinutes === 'number'
            ? Math.max(15, Math.min(300, Math.round(parsed.suggestedDurationMinutes)))
            : null
        const primaryTopic = parsed.primaryTopic?.replace(/\s+/g, ' ').trim() || null

        const dist = parsed.difficultyDistribution
        const difficultyDistribution = dist
            && typeof dist.easy === 'number'
            && typeof dist.medium === 'number'
            && typeof dist.hard === 'number'
            ? { easy: Math.max(0, dist.easy), medium: Math.max(0, dist.medium), hard: Math.max(0, dist.hard) }
            : null

        return {
            description: description && description.length > 0
                ? description.slice(0, 280)
                : buildFallbackDocumentDescription(questions, sourceLabel),
            suggestedTitle: suggestedTitle && suggestedTitle.length > 0
                ? suggestedTitle.slice(0, 80)
                : null,
            suggestedDurationMinutes: suggestedDuration,
            primaryTopic,
            difficultyDistribution,
            cost: calculateCost(model, response.usage as { prompt_tokens?: number; completion_tokens?: number }),
        }
    } catch (error) {
        const failure = toAIChunkFailure(error)
        return {
            description: buildFallbackDocumentDescription(questions, sourceLabel),
            error: true,
            message: failure.message,
        }
    }
}

export async function enrichGeneratedQuestionsMetadata(input: {
    questions: GeneratedQuestion[]
    auditUserId?: string
    sourceLabel?: string
}): Promise<DocumentMetadataEnrichmentResult> {
    if (input.questions.length === 0) {
        return {
            questions: [],
            description: buildFallbackDocumentDescription([], input.sourceLabel),
            aiUsed: false,
        }
    }

    const metadataBatches = chunkArray(input.questions, 12)
    let metadataWarning: string | undefined
    const metadataCosts: Array<CostInfo | undefined> = []
    const metadataOverrides = new Map<number, { difficulty: GeneratedQuestion['difficulty']; topic: string }>()

    for (let batchIndex = 0; batchIndex < metadataBatches.length; batchIndex++) {
        const batch = metadataBatches[batchIndex]
        const batchResult = await classifyQuestionMetadataBatchWithAI(batch)
        if (batchResult.cost) {
            metadataCosts.push(batchResult.cost)
        }

        if (batchResult.error) {
            metadataWarning = batchResult.message
            break
        }

        for (const override of batchResult.questions) {
            metadataOverrides.set((batchIndex * 12) + override.questionNumber, {
                difficulty: override.difficulty,
                topic: override.topic,
            })
        }
    }

    const questions = input.questions.map((question, index) => {
        const override = metadataOverrides.get(index + 1)
        return {
            ...question,
            difficulty: override?.difficulty ?? normalizeDifficultyLabel(question.difficulty, guessDifficulty(question.stem)),
            topic: override?.topic ?? normalizeTopicLabel(question.topic, question.stem),
        }
    })

    const descriptionResult = await summarizeDocumentQuestionSetWithAI(questions, input.sourceLabel)
    if (descriptionResult.cost) {
        metadataCosts.push(descriptionResult.cost)
    }
    if (descriptionResult.error && metadataWarning === undefined) {
        metadataWarning = descriptionResult.message
    }

    const totalCost = mergeCosts(...metadataCosts)
    if (input.auditUserId && totalCost) {
        await logCostToAudit(input.auditUserId, 'AI_DOC_METADATA', totalCost)
    }

    return {
        questions,
        description: descriptionResult.description ?? buildFallbackDocumentDescription(questions, input.sourceLabel),
        suggestedTitle: descriptionResult.suggestedTitle ?? null,
        suggestedDurationMinutes: descriptionResult.suggestedDurationMinutes ?? null,
        primaryTopic: descriptionResult.primaryTopic ?? null,
        difficultyDistribution: descriptionResult.difficultyDistribution ?? null,
        aiUsed: metadataOverrides.size > 0 || Boolean(descriptionResult.cost),
        cost: totalCost,
        warning: metadataWarning,
    }
}

// ── Generate Personalized Feedback ──
export async function generatePersonalizedFeedback(
    session: SessionData,
    questions: QuestionData[],
    auditUserId?: string
): Promise<FeedbackResult> {
    const answers = (session.answers as AnswerEntry[] | null) || []

    // Build question analysis
    const questionAnalysis = questions.map(q => {
        const answer = answers.find(a => a.questionId === q.id)
        const opts = q.options as unknown
        let correctId: string | null = null
        let correctText = ''
        let selectedText = ''

        if (Array.isArray(opts)) {
            const correct = (opts as Array<{ id: string; text: string; isCorrect: boolean }>).find(o => o.isCorrect)
            correctId = correct?.id || null
            correctText = correct?.text || 'Unknown'
            if (answer?.optionId) {
                const selected = (opts as Array<{ id: string; text: string }>).find(o => o.id === answer.optionId)
                selectedText = selected?.text || 'Unknown'
            }
        } else if (typeof opts === 'object' && opts !== null) {
            const obj = opts as Record<string, string>
            correctId = obj.correct || null
            correctText = correctId ? obj[correctId] || 'Unknown' : 'Unknown'
            if (answer?.optionId) {
                selectedText = obj[answer.optionId] || 'Unknown'
            }
        }

        const isCorrect = answer?.optionId === correctId
        return {
            question: q.stem.substring(0, 120),
            topic: q.topic || 'General',
            difficulty: q.difficulty,
            isCorrect,
            wasAnswered: !!answer?.optionId,
            studentAnswer: selectedText,
            correctAnswer: correctText,
        }
    })

    const wrongAnswers = questionAnalysis.filter(q => !q.isCorrect)
    const rightAnswers = questionAnalysis.filter(q => q.isCorrect)
    const unanswered = questionAnalysis.filter(q => !q.wasAnswered)
    const timeTaken = session.submittedAt
        ? Math.floor((session.submittedAt.getTime() - session.startedAt.getTime()) / 1000)
        : 0

    // If no OpenAI key, generate rule-based feedback
    if (!openai) {
        return generateRuleBasedFeedback(session, questionAnalysis, rightAnswers, wrongAnswers, unanswered, timeTaken)
    }

    // Build prompt for OpenAI
    const prompt = `You are an expert educational tutor. Analyze this student's test performance and provide personalized, encouraging feedback.

## Test Results
- Score: ${session.score}/${session.totalMarks} (${session.percentage?.toFixed(1)}%)
- Time taken: ${Math.floor(timeTaken / 60)}min ${timeTaken % 60}s
- Tab switches: ${session.tabSwitchCount}
- Unanswered: ${unanswered.length} questions

## Questions Analysis
${questionAnalysis.map((q, i) => `${i + 1}. [${q.difficulty}] ${q.question}
   Topic: ${q.topic}
   ${q.wasAnswered ? (q.isCorrect ? '✅ Correct' : `❌ Wrong (chose: "${q.studentAnswer}", correct: "${q.correctAnswer}")`) : '⏭ Skipped'}`).join('\n\n')}

## Instructions
Respond in JSON format:
{
  "strengths": ["2-3 specific strengths based on what they got right"],
  "weaknesses": ["2-3 areas where they need improvement based on wrong answers"],
  "actionPlan": ["3-4 actionable study recommendations"],
  "questionExplanations": {"questionIndex": "Brief explanation of why the correct answer is right"},
  "overallTag": "A short 3-5 word assessment label (e.g., 'Strong in Theory, Weak in Application')"
}

Focus especially on ${wrongAnswers.length > 0 ? 'the topics they got wrong' : 'maintaining their excellent performance'}. Be encouraging but honest.`

    const model = 'gpt-4o-mini'
    try {
        const response = await openai.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 1500,
            response_format: { type: 'json_object' },
        })

        const content = response.choices[0]?.message?.content
        if (!content) throw new Error('Empty AI response')

        // Log cost
        const cost = calculateCost(model, response.usage as { prompt_tokens?: number; completion_tokens?: number })
        if (auditUserId) await logCostToAudit(auditUserId, 'AI_FEEDBACK', cost)

        const parsed = JSON.parse(content)

        return {
            strengths: (parsed.strengths || []) as Prisma.InputJsonValue,
            weaknesses: (parsed.weaknesses || []) as Prisma.InputJsonValue,
            actionPlan: (parsed.actionPlan || []) as Prisma.InputJsonValue,
            questionExplanations: (parsed.questionExplanations || {}) as Prisma.InputJsonValue,
            overallTag: parsed.overallTag || 'Analysis Complete',
        }
    } catch (err) {
        console.error('[AI] OpenAI call failed, falling back to rule-based:', err)
        return generateRuleBasedFeedback(session, questionAnalysis, rightAnswers, wrongAnswers, unanswered, timeTaken)
    }
}

// ── Rule-Based Fallback ──
function generateRuleBasedFeedback(
    session: SessionData,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allQuestions: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rightAnswers: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wrongAnswers: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unanswered: any[],
    timeTaken: number
): FeedbackResult {
    void allQuestions; void timeTaken; // suppress unused warnings
    const pct = session.percentage || 0

    const strengths: string[] = []
    if (pct >= 80) strengths.push('Excellent overall understanding of the material')
    else if (pct >= 60) strengths.push('Good grasp of the core concepts')
    else if (pct >= 40) strengths.push('Showing foundational understanding')

    const correctTopics = [...new Set(rightAnswers.map(q => q.topic))]
    if (correctTopics.length > 0) strengths.push(`Strong performance in: ${correctTopics.slice(0, 3).join(', ')}`)
    if (unanswered.length === 0) strengths.push('Attempted all questions — good test-taking strategy')
    if (strengths.length === 0) strengths.push('Keep practicing — every attempt is a learning opportunity')

    const weaknesses: string[] = []
    const wrongTopics = [...new Set(wrongAnswers.map(q => q.topic))]
    if (wrongTopics.length > 0) weaknesses.push(`Needs improvement in: ${wrongTopics.slice(0, 3).join(', ')}`)
    if (unanswered.length > 0) weaknesses.push(`${unanswered.length} questions left unanswered`)
    const hardWrong = wrongAnswers.filter(q => q.difficulty === 'HARD')
    if (hardWrong.length > 0) weaknesses.push(`Struggled with ${hardWrong.length} hard-level questions`)
    if (weaknesses.length === 0) weaknesses.push('Minor areas for improvement — overall strong showing')

    const actionPlan: string[] = []
    if (wrongTopics.length > 0) actionPlan.push(`Review and practice problems in: ${wrongTopics.slice(0, 3).join(', ')}`)
    if (pct < 60) actionPlan.push('Focus on building strong foundations before attempting harder topics')
    if (unanswered.length > 2) actionPlan.push('Practice time management — try to attempt all questions even if unsure')
    actionPlan.push('Review the explanations for questions you got wrong')
    if (pct >= 80) actionPlan.push('Challenge yourself with harder topics to push beyond your current level')

    let overallTag = 'Analysis Complete'
    if (pct >= 90) overallTag = 'Outstanding Performance'
    else if (pct >= 75) overallTag = 'Strong Understanding'
    else if (pct >= 60) overallTag = 'Good but Room to Grow'
    else if (pct >= 40) overallTag = 'Building Foundations'
    else overallTag = 'Needs More Practice'

    const explanations: Record<string, string> = {}
    wrongAnswers.forEach((q, i) => {
        explanations[String(i)] = `The correct answer is "${q.correctAnswer}". Review the topic: ${q.topic}`
    })

    return {
        strengths: strengths as unknown as Prisma.InputJsonValue,
        weaknesses: weaknesses as unknown as Prisma.InputJsonValue,
        actionPlan: actionPlan as unknown as Prisma.InputJsonValue,
        questionExplanations: explanations as unknown as Prisma.InputJsonValue,
        overallTag,
    }
}

function toValidatedGeneratedQuestion(question: Partial<GeneratedQuestion> | null | undefined): GeneratedQuestion | null {
    if (!question) return null

    const splitVisualContext = splitStemAndVisualContext(
        typeof question.stem === 'string' ? question.stem : '',
        question.sharedContext ?? null,
    )

    const normalizedStem = normalizeStem(splitVisualContext.stem ?? '')
    const normalizedOptions = Array.isArray(question.options)
        ? question.options.map((option, index) => ({
            id: String(option?.id ?? ['A', 'B', 'C', 'D'][index] ?? '').toUpperCase(),
            text: normalizeOptionText(option?.text ?? ''),
            isCorrect: Boolean(option?.isCorrect),
        }))
        : []

    const normalizedQuestion: GeneratedQuestion = {
        stem: normalizedStem,
        options: normalizedOptions,
        explanation: typeof question.explanation === 'string' ? question.explanation.trim() : '',
        difficulty: normalizeDifficultyLabel(question.difficulty),
        topic: normalizeTopicLabel(question.topic, normalizedStem),
        sharedContext: normalizeSharedContextText(splitVisualContext.sharedContext),
        sourcePage: Number.isInteger(question.sourcePage) && Number(question.sourcePage) > 0
            ? Number(question.sourcePage)
            : null,
        sourceSnippet: truncateEvidenceText(question.sourceSnippet),
        answerSource: question.answerSource ?? null,
        confidence: typeof question.confidence === 'number'
            ? normalizeConfidenceScore(question.confidence)
            : null,
        sharedContextEvidence: truncateEvidenceText(question.sharedContextEvidence),
        extractionMode: question.extractionMode ?? null,
        referenceKind: question.referenceKind ?? null,
        referenceMode: question.referenceMode ?? null,
        referenceTitle: typeof question.referenceTitle === 'string'
            ? question.referenceTitle.trim().slice(0, 120)
            : null,
    }

    const parsed = McqQuestionSchema.safeParse(normalizedQuestion)
    return parsed.success
        ? {
            ...parsed.data,
            answerSource: normalizedQuestion.answerSource,
        }
        : null
}

function coerceGeneratedQuestions(rawQuestions: unknown): { questions: GeneratedQuestion[]; failedCount: number } {
    if (!Array.isArray(rawQuestions)) {
        return { questions: [], failedCount: 0 }
    }

    const questions: GeneratedQuestion[] = []
    let failedCount = 0
    for (let index = 0; index < rawQuestions.length; index += 1) {
        const rawQuestion = rawQuestions[index]
        const validatedQuestion = toValidatedGeneratedQuestion(rawQuestion as Partial<GeneratedQuestion>)
        if (validatedQuestion) {
            questions.push(validatedQuestion)
        } else {
            const stemPreview = rawQuestion
                && typeof rawQuestion === 'object'
                && 'stem' in rawQuestion
                && typeof rawQuestion.stem === 'string'
                ? rawQuestion.stem.slice(0, 120)
                : 'unknown stem'
            console.warn(`[AI] Dropped invalid generated question at index ${index + 1}: ${stemPreview}`)
            failedCount += 1
        }
    }

    return { questions, failedCount }
}

// ── Zod-style Validation for Generated Questions ──
function validateQuestion(q: GeneratedQuestion): boolean {
    return toValidatedGeneratedQuestion(q) !== null
}

export function verifyExtractedQuestions(
    questions: GeneratedQuestion[],
    expectedCount: number | null,
    context?: VerificationContext,
): VerificationResult {
    return verifyExtractedQuestionsV2(
        questions,
        expectedCount,
        toValidatedGeneratedQuestion,
        context,
    )
}

// ── Deduplicate questions by stem similarity ──
function deduplicateQuestions(questions: GeneratedQuestion[]): GeneratedQuestion[] {
    const seen = new Set<string>()
    return questions.filter(q => {
        const normalizedStem = q.stem.toLowerCase().replace(/\s+/g, ' ').trim()
        const normalizedOptions = q.options
            .map((option) => option.text.toLowerCase().replace(/\s+/g, ' ').trim())
            .join('|')
        const normalizedSharedContext = normalizeSharedContextText(q.sharedContext)?.toLowerCase() ?? ''
        const key = `${normalizedStem}::${normalizedOptions}::${normalizedSharedContext}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}

function buildOverlappingPageChunks(
    pageNumbers: number[],
    size = 2,
    overlap = 1,
) {
    if (pageNumbers.length === 0) {
        return []
    }

    if (pageNumbers.length <= size) {
        return [pageNumbers]
    }

    const step = Math.max(1, size - overlap)
    const chunks: number[][] = []
    for (let index = 0; index < pageNumbers.length; index += step) {
        const chunk = pageNumbers.slice(index, index + size)
        if (chunk.length === 0) {
            continue
        }

        const lastChunk = chunks[chunks.length - 1]
        if (
            lastChunk
            && lastChunk.length === chunk.length
            && lastChunk.every((value, chunkIndex) => value === chunk[chunkIndex])
        ) {
            continue
        }

        chunks.push(chunk)
        if (chunk[chunk.length - 1] === pageNumbers[pageNumbers.length - 1]) {
            break
        }
    }

    return chunks
}

function scoreNumberedQuestionCandidate(question: GeneratedQuestion) {
    const sharedContextLength = question.sharedContext?.length ?? 0
    const snippetLength = question.sourceSnippet?.length ?? 0
    const explanationLength = question.explanation?.length ?? 0
    const optionLength = question.options.reduce((sum, option) => sum + option.text.length, 0)
    const evidenceLength = question.sharedContextEvidence?.length ?? 0
    const confidence = typeof question.confidence === 'number' ? question.confidence * 100 : 0

    return (
        optionLength
        + Math.min(sharedContextLength, 1500)
        + Math.min(snippetLength, 300)
        + Math.min(explanationLength, 200)
        + Math.min(evidenceLength, 600)
        + confidence
    )
}

function coerceNumberedGeneratedQuestions(
    rawQuestions: unknown,
): { questions: Array<{ questionNumber: number; question: GeneratedQuestion }>; failedCount: number } {
    if (!Array.isArray(rawQuestions)) {
        return { questions: [], failedCount: 0 }
    }

    const questions: Array<{ questionNumber: number; question: GeneratedQuestion }> = []
    let failedCount = 0

    for (let index = 0; index < rawQuestions.length; index += 1) {
        const rawQuestion = rawQuestions[index]
        const parsed = NumberedMcqExtractionResponseSchema.shape.questions.element.safeParse(rawQuestion)
        if (!parsed.success) {
            console.warn(`[AI] Dropped invalid numbered question at index ${index + 1}.`, parsed.error.issues.map((issue) => issue.path.join('.')).join(', '))
            failedCount += 1
            continue
        }

        const numberedQuestion = parsed.data as NumberedMcqQuestion
        const validatedQuestion = toValidatedGeneratedQuestion(numberedQuestion)
        if (!validatedQuestion) {
            failedCount += 1
            continue
        }

        questions.push({
            questionNumber: numberedQuestion.questionNumber,
            question: validatedQuestion,
        })
    }

    return { questions, failedCount }
}

function mergeChunkedMultimodalQuestions(
    questionEntries: Array<{ questionNumber: number; question: GeneratedQuestion }>,
) {
    const byQuestionNumber = new Map<number, GeneratedQuestion>()

    for (const entry of questionEntries) {
        if (!Number.isInteger(entry.questionNumber) || entry.questionNumber <= 0) {
            continue
        }

        const previous = byQuestionNumber.get(entry.questionNumber)
        if (!previous || scoreNumberedQuestionCandidate(entry.question) > scoreNumberedQuestionCandidate(previous)) {
            byQuestionNumber.set(entry.questionNumber, entry.question)
        }
    }

    return Array.from(byQuestionNumber.entries())
        .sort((left, right) => left[0] - right[0])
        .map(([, question]) => question)
}

function shouldPreferChunkedMultimodalResult(
    chunked: PdfVisionFallbackResult,
    expectedCount: number,
) {
    if (chunked.error || !chunked.questions || chunked.questions.length === 0) {
        return false
    }

    if (chunked.questions.length >= expectedCount) {
        return true
    }

    return chunked.questions.length >= Math.max(8, Math.floor(expectedCount * 0.5))
}

function countPdfVerificationErrors(result: PdfVisionFallbackResult) {
    return result.verification?.issues.filter((issue) => issue.severity === 'ERROR').length ?? 0
}

function shouldPreferPdfResult(
    candidate: PdfVisionFallbackResult,
    baseline: PdfVisionFallbackResult,
) {
    const candidateQuestions = candidate.questions?.length ?? 0
    const baselineQuestions = baseline.questions?.length ?? 0
    if (candidateQuestions !== baselineQuestions) {
        return candidateQuestions > baselineQuestions
    }

    const candidateErrors = countPdfVerificationErrors(candidate)
    const baselineErrors = countPdfVerificationErrors(baseline)
    if (candidateErrors !== baselineErrors) {
        return candidateErrors < baselineErrors
    }

    return (candidate.chunkCount ?? 0) > (baseline.chunkCount ?? 0)
}

function mergeCosts(...costs: Array<CostInfo | undefined>) {
    const validCosts = costs.filter((cost): cost is CostInfo => cost !== undefined)
    if (validCosts.length === 0) return undefined

    return validCosts.reduce<CostInfo>((totalCost, cost, index) => ({
        model: index === 0 ? cost.model : `${totalCost.model} + ${cost.model}`,
        inputTokens: totalCost.inputTokens + cost.inputTokens,
        outputTokens: totalCost.outputTokens + cost.outputTokens,
        costUSD: totalCost.costUSD + cost.costUSD,
    }), {
        model: validCosts[0].model,
        inputTokens: 0,
        outputTokens: 0,
        costUSD: 0,
    })
}

const OPENAI_RETRY_DELAYS_MS = process.env.NODE_ENV === 'test'
    ? [0, 0, 0]
    : [2000, 8000, 20000]
const MAX_OUTPUT_TOKENS_INCOMPLETE_REASON = 'max_output_tokens'

async function sleepForRetry(delayMs: number) {
    if (delayMs <= 0) {
        return
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs))
}

async function withOpenAIRetries<T>(
    label: string,
    operation: () => Promise<T>,
): Promise<T> {
    let lastError: unknown

    for (let attempt = 0; attempt < OPENAI_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
            return await operation()
        } catch (error) {
            lastError = error
            const failure = toAIChunkFailure(error)
            if (!failure.retryable || attempt === OPENAI_RETRY_DELAYS_MS.length - 1) {
                throw error
            }

            console.warn(`[AI] ${label} failed on attempt ${attempt + 1}; retrying.`, failure.message)
            await sleepForRetry(OPENAI_RETRY_DELAYS_MS[attempt] ?? 0)
        }
    }

    throw lastError instanceof Error ? lastError : new Error(`${label} failed.`)
}

function isMaxOutputTokenTruncationResponse(
    response: {
        status?: string | null
        incomplete_details?: { reason?: string | null } | null
    } | null | undefined,
) {
    return response?.status === 'incomplete'
        && response.incomplete_details?.reason === MAX_OUTPUT_TOKENS_INCOMPLETE_REASON
}

function buildMaxOutputTokenFailure(context: string): AIChunkFailure {
    return {
        code: MAX_OUTPUT_TOKENS_INCOMPLETE_REASON,
        message: `${context} hit the max_output_tokens limit and needs a smaller retry window.`,
        retryable: true,
    }
}

function splitTextChunkForRetry(text: string): string[] {
    const normalized = text.trim()
    if (normalized.length < 400) {
        return []
    }

    const midpoint = Math.floor(normalized.length / 2)
    const newlineBefore = normalized.lastIndexOf('\n', midpoint)
    const newlineAfter = normalized.indexOf('\n', midpoint)
    const splitIndexCandidates = [newlineBefore, newlineAfter]
        .filter((value) => value > 120 && value < normalized.length - 120)
    const splitIndex = splitIndexCandidates[0] ?? midpoint

    const left = normalized.slice(0, splitIndex).trim()
    const right = normalized.slice(splitIndex).trim()
    if (!left || !right) {
        return []
    }

    return [left, right]
}

function appendAIMessage(currentMessage: string | undefined, nextMessage: string | undefined) {
    if (!nextMessage) {
        return currentMessage
    }

    if (!currentMessage) {
        return nextMessage
    }

    if (currentMessage.includes(nextMessage)) {
        return currentMessage
    }

    return `${currentMessage} ${nextMessage}`.trim()
}

function normalizeDifficultyLabel(
    difficulty: string | null | undefined,
    fallback: GeneratedQuestion['difficulty'] = 'MEDIUM',
): GeneratedQuestion['difficulty'] {
    const normalizedDifficulty = difficulty?.trim().toUpperCase()
    if (normalizedDifficulty === 'EASY' || normalizedDifficulty === 'MEDIUM' || normalizedDifficulty === 'HARD') {
        return normalizedDifficulty
    }

    return fallback
}

function normalizeTopicLabel(topic: string | null | undefined, fallbackStem?: string) {
    const normalizedTopic = topic
        ?.replace(/\s+/g, ' ')
        .trim()
        .replace(/^[.:)\]-]+\s*/, '')

    if (normalizedTopic && normalizedTopic.length >= 2) {
        return normalizedTopic.slice(0, 80)
    }

    return fallbackStem ? detectTopic(fallbackStem) : 'General'
}

function countByLabel(values: string[]) {
    const counts = new Map<string, number>()
    for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1])
}

function buildFallbackDocumentDescription(
    questions: GeneratedQuestion[],
    sourceLabel?: string,
) {
    if (questions.length === 0) {
        const normalizedLabel = sourceLabel
            ?.replace(/\.(docx|pdf)$/i, '')
            .replace(/[-_]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()

        return normalizedLabel
            ? `${normalizedLabel} mock test generated from the uploaded document.`
            : 'Auto-generated mock test from the uploaded document.'
    }

    const normalizedLabel = sourceLabel
        ?.replace(/\.(docx|pdf)$/i, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

    const topTopics = countByLabel(questions.map(question => normalizeTopicLabel(question.topic, question.stem)))
        .slice(0, 3)
        .map(([topic]) => topic)
    const difficultyMix = countByLabel(questions.map(question => normalizeDifficultyLabel(question.difficulty)))
    const difficultySummary = difficultyMix
        .map(([difficulty, count]) => `${count} ${difficulty.toLowerCase()}`)
        .join(', ')

    const statementHeavyCount = questions.filter(question => /(assertion|reason|consider statements|choose the correct answer)/i.test(question.stem)).length
    const formatLine = statementHeavyCount > 0
        ? `Includes ${statementHeavyCount} statement-based or assertion-style questions alongside standard MCQs.`
        : 'Includes standard CUET-style MCQs with a balanced concept-checking format.'

    const coverageLine = topTopics.length > 0
        ? `Covers ${topTopics.join(', ')} across ${questions.length} questions.`
        : `Covers ${questions.length} CUET-style questions from the uploaded source.`

    const labelPrefix = normalizedLabel ? `${normalizedLabel} mock test.` : 'Auto-generated mock test.'

    return `${labelPrefix} ${coverageLine} Difficulty mix: ${difficultySummary}. ${formatLine}`.trim()
}

function toAIChunkFailure(error: unknown): AIChunkFailure {
    if (error && typeof error === 'object') {
        const status = 'status' in error && typeof error.status === 'number' ? error.status : undefined
        const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
        const nestedMessage = 'error' in error
            && error.error
            && typeof error.error === 'object'
            && 'message' in error.error
            && typeof error.error.message === 'string'
            ? error.error.message
            : undefined
        const rootMessage = 'message' in error && typeof error.message === 'string'
            ? error.message
            : undefined
        const message = nestedMessage || rootMessage || 'OpenAI request failed.'

        if (status === 401 || code === 'invalid_api_key') {
            return {
                code: code || 'invalid_api_key',
                message: 'OpenAI API key is invalid. Update OPENAI_API_KEY before using AI document generation.',
                retryable: false,
            }
        }

        if (status === 429 || code === 'rate_limit_exceeded') {
            return {
                code: code || 'rate_limit_exceeded',
                message: 'OpenAI rate limit reached. Please try again shortly.',
                retryable: true,
            }
        }

        return {
            code,
            message,
            retryable: status === undefined
                || status === 429
                || status === 500
                || status === 502
                || status === 503
                || status === 504,
        }
    }

    return {
        message: 'OpenAI request failed.',
        retryable: true,
    }
}

// ── Generate MCQs from Document Text (with chunking + retry) ──
export async function generateQuestionsFromText(
    text: string,
    count: number = 10,
    auditUserId?: string
): Promise<{ questions?: GeneratedQuestion[]; failedCount?: number; cost?: CostInfo; error?: boolean; message?: string }> {
    if (!openai) {
        return { error: true, message: 'OpenAI API key not configured. Please set OPENAI_API_KEY.' }
    }

    const chunks = chunkDocumentTextForGeneration(text)
    const questionsPerChunk = Math.ceil(count / chunks.length)
    let allQuestions: GeneratedQuestion[] = []
    const totalCost: CostInfo = { model: 'gpt-4o-mini', inputTokens: 0, outputTokens: 0, costUSD: 0 }
    let failedCount = 0
    let lastFailure: AIChunkFailure | null = null

    for (const chunk of chunks) {
        const result = await generateFromChunk(chunk, questionsPerChunk, 'gpt-4o-mini')

        if (result.cost) {
            totalCost.inputTokens += result.cost.inputTokens
            totalCost.outputTokens += result.cost.outputTokens
            totalCost.costUSD += result.cost.costUSD
        }

        if (result.questions.length > 0) {
            allQuestions.push(...result.questions)
        }
        failedCount += result.failedCount
        if (result.failure) {
            lastFailure = result.failure
            if (!result.failure.retryable) {
                return {
                    error: true,
                    message: result.failure.message,
                    failedCount,
                    cost: totalCost,
                }
            }
        }

        // If gpt-4o-mini failed entirely on this chunk, retry with gpt-4o
        if (result.questions.length === 0 && result.failedCount > 0) {
            console.log('[AI] Retrying chunk with gpt-4o...')
            const retry = await generateFromChunk(chunk, questionsPerChunk, 'gpt-4o')
            if (retry.cost) {
                totalCost.inputTokens += retry.cost.inputTokens
                totalCost.outputTokens += retry.cost.outputTokens
                totalCost.costUSD += retry.cost.costUSD
                totalCost.model = 'gpt-4o (retry)'
            }
            if (retry.questions.length > 0) {
                allQuestions.push(...retry.questions)
                failedCount -= retry.questions.length // recovered some
                lastFailure = null
            } else if (retry.failure) {
                lastFailure = retry.failure
                if (!retry.failure.retryable) {
                    return {
                        error: true,
                        message: retry.failure.message,
                        failedCount,
                        cost: totalCost,
                    }
                }
            }
        }
    }

    // Deduplicate across chunks
    allQuestions = deduplicateQuestions(allQuestions)

    // Trim to requested count
    if (allQuestions.length > count) {
        console.info(`[AI] Generated ${allQuestions.length} questions for a requested count of ${count}; trimming overflow.`)
        allQuestions = allQuestions.slice(0, count)
    }

    if (auditUserId) await logCostToAudit(auditUserId, 'AI_GENERATE', totalCost)

    if (allQuestions.length === 0 && lastFailure) {
        return {
            error: true,
            message: lastFailure.message,
            failedCount,
            cost: totalCost,
        }
    }

    return { questions: allQuestions, failedCount: Math.max(0, failedCount), cost: totalCost }
}

// ── Cross-Model AI Verification ──
export async function verifyExtractedQuestionsWithAI(
    questions: GeneratedQuestion[],
    extractionModel: string,
    auditUserId?: string,
): Promise<AIVerificationResult> {
    if (!openai || questions.length === 0) {
        return {
            issues: [],
            overallAssessment: questions.length === 0
                ? 'No questions to verify.'
                : 'OpenAI API key not configured. Skipping AI verification.',
            confidence: 0,
            error: !openai,
            message: !openai ? 'OpenAI API key not configured.' : undefined,
        }
    }

    // Cross-model: use the opposite model for independent verification
    const model = extractionModel.includes('gpt-4o-mini') ? 'gpt-4o' : 'gpt-4o-mini'
    const totalCost: CostInfo = { model, inputTokens: 0, outputTokens: 0, costUSD: 0 }
    const allIssues: AIVerificationResult['issues'] = []

    const batches = chunkArray(questions, 15)

    for (const [batchIndex, batch] of batches.entries()) {
        const batchStartQuestionNumber = batchIndex * 15
        const questionsText = batch.map((q, i) => {
            const questionNumber = batchStartQuestionNumber + i + 1
            const correctOpt = q.options.find(o => o.isCorrect)
            const optionsList = q.options.map(o => `  ${o.id}. ${o.text}${o.isCorrect ? ' [MARKED CORRECT]' : ''}`).join('\n')
            return [
                `Q${questionNumber}:`,
                `  Stem: ${q.stem}`,
                q.sharedContext ? `  Shared Context: ${truncateForPrompt(q.sharedContext, 500)}` : null,
                `  Options:\n${optionsList}`,
                `  Correct: ${correctOpt?.id ?? 'NONE'}`,
                `  Explanation: ${truncateForPrompt(q.explanation, 200) ?? 'none'}`,
                `  Difficulty: ${q.difficulty}`,
                `  Topic: ${q.topic}`,
            ].filter(Boolean).join('\n')
        }).join('\n\n')

        const prompt = `You are an independent quality verifier for extracted MCQ questions.
A different AI model extracted these questions from an educational document. Your job is to find errors.

CHECK EACH QUESTION FOR:
1. STEM CLARITY: Is the stem a complete, understandable question? Flag fragments or garbled text.
2. OPTION INTEGRITY: Are there exactly 4 distinct options? Are they meaningful (not empty/duplicate)?
3. ANSWER CORRECTNESS: Does the marked correct answer actually appear correct given the stem and explanation? Flag suspicious answers.
4. SHARED CONTEXT: If the stem references a "passage", "table", "following", "above" etc., is shared context present? Flag missing context.
5. EXPLANATION QUALITY: Does the explanation logically support the marked correct answer?
6. NUMBERING: Check for any numbering issues across questions.

IMPORTANT:
- Only flag genuine issues. Do not flag questions that look correct.
- Use severity "WARNING" for all issues (never "ERROR").
- Use category "CROSS" for all issues.
- Prefix issue codes with "AI_CHECK_" (e.g., "AI_CHECK_WRONG_ANSWER", "AI_CHECK_MISSING_CONTEXT", "AI_CHECK_GARBLED_STEM", "AI_CHECK_DUPLICATE_OPTIONS", "AI_CHECK_BAD_EXPLANATION").
- questionNumber must be the exact global question number shown in each block label (for example, if the block says "Q16", return questionNumber: 16).
- If all questions look correct, return an empty issues array with high confidence.

Questions to verify:
${questionsText}

Return strict JSON matching the schema.`

        try {
            const response = await openai.chat.completions.create({
                model,
                temperature: 0,
                max_tokens: 3000,
                response_format: { type: 'json_object' },
                messages: [{ role: 'user', content: prompt }],
            })

            const content = response.choices[0]?.message?.content
            const cost = calculateCost(model, response.usage as { prompt_tokens?: number; completion_tokens?: number })
            totalCost.inputTokens += cost.inputTokens
            totalCost.outputTokens += cost.outputTokens
            totalCost.costUSD += cost.costUSD

            if (content) {
                const parsed = AIVerificationResponseSchema.safeParse(JSON.parse(content))
                if (parsed.success) {
                    const normalizedIssues = (
                        batchStartQuestionNumber > 0
                        && parsed.data.issues.length > 0
                        && parsed.data.issues.every(
                            (issue) => issue.questionNumber >= 1 && issue.questionNumber <= batch.length,
                        )
                    )
                        ? parsed.data.issues.map((issue) => ({
                            ...issue,
                            questionNumber: issue.questionNumber + batchStartQuestionNumber,
                        }))
                        : parsed.data.issues

                    allIssues.push(...normalizedIssues)
                }
            }
        } catch (error) {
            const failure = toAIChunkFailure(error)
            console.error('[AI] Cross-model verification batch failed:', error)
            return {
                issues: allIssues,
                overallAssessment: `AI verification partially completed with errors: ${failure.message}`,
                confidence: 0.3,
                cost: totalCost.inputTokens > 0 ? totalCost : undefined,
                error: true,
                message: failure.message,
            }
        }
    }

    if (auditUserId && (totalCost.inputTokens > 0 || totalCost.outputTokens > 0)) {
        await logCostToAudit(auditUserId, 'AI_VERIFY', totalCost)
    }

    return {
        issues: allIssues,
        overallAssessment: allIssues.length === 0
            ? 'All questions passed AI cross-model verification.'
            : `AI verification found ${allIssues.length} potential issue(s) across ${questions.length} questions.`,
        confidence: allIssues.length === 0 ? 0.95 : Math.max(0.4, 0.95 - (allIssues.length * 0.05)),
        cost: totalCost,
    }
}

type PdfMultimodalExtractionOptions = {
    preferChunkedVisualExtraction?: boolean
    allowOneShotFallbackAfterChunked?: boolean
}

async function extractQuestionsFromPdfMultimodalOneShot(
    buffer: Buffer,
    expectedCount: number = 50,
    auditUserId?: string,
    fileName: string = 'uploaded.pdf',
): Promise<PdfVisionFallbackResult> {
    if (!openai) {
        return {
            error: true,
            message: 'OpenAI API key not configured. Please set OPENAI_API_KEY.',
            pageCount: 0,
            chunkCount: 0,
            mode: 'EXTRACTED',
        }
    }

    const { getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const model = 'gpt-4o'
    const totalCost: CostInfo = { model, inputTokens: 0, outputTokens: 0, costUSD: 0 }

    try {
        const pageCount = pdf.numPages
        if (pageCount === 0) {
            return {
                error: true,
                message: 'PDF has no pages available for multimodal extraction.',
                pageCount: 0,
                chunkCount: 0,
                mode: 'EXTRACTED',
            }
        }

        const response = await withOpenAIRetries(
            'Multimodal PDF extraction (one-shot)',
            () => openai.responses.parse({
                model,
                temperature: 0,
                max_output_tokens: 32000,
                input: [
                    {
                        role: 'system',
                        content: 'You extract existing CUET-style MCQs from uploaded PDF files with high precision and return only strict structured output.',
                    },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'input_text',
                                text: `Extract the existing MCQs from this PDF with high precision.

FORMAT HANDLING RULES:

1. MATCH-THE-FOLLOWING / LIST MATCHING:
   Look for "List I / List II", "Column A / Column B", or similar pairing tables.
   The question stem MUST include the complete matching table reproduced as text.
   Options are typically coded combinations like "(A) a-i, b-ii, c-iii, d-iv".
   Preserve the full table in "sharedContext" as well.

2. ASSERTION-REASON:
   Look for "Assertion (A):" and "Reason (R):" pairs.
   Include BOTH the assertion and reason text in the stem.
   Standard options follow the A-R pattern:
   A. Both A and R are true and R is the correct explanation of A
   B. Both A and R are true but R is NOT the correct explanation of A
   C. A is true but R is false
   D. A is false but R is true

3. VENN DIAGRAMS & DATA TABLES:
   Put the actual OCR-visible diagram/table block into "sharedContext" first, preserving line breaks and spacing exactly when the PDF already contains ASCII/box-drawing text.
   After the preserved block, you may add 1 short explanatory sentence if needed.
   For Venn diagrams: describe the sets, overlaps, labels, and any numbers shown.
   For data tables: reproduce the full table structure in text with row/column headers and values.

4. FIGURE COMPLETION / FIGURE SERIES:
   If the OCR excerpt already shows the figure using ASCII, Unicode shapes, slashes, stars, circles, or box-drawing characters, copy that exact figure block into "sharedContext" before any explanation.
   Preserve spacing and line breaks inside that block.
   Then describe the visual pattern in "sharedContext" (shapes, rotation, progression).
   Note what the missing element should look like based on the pattern.

5. PASSAGE-BASED QUESTIONS:
   Include the FULL passage in "sharedContext". Multiple questions may share the same passage.
   Preserve the passage exactly as written, including any case study or comprehension text.

6. HORIZONTAL ANSWER KEYS:
   Some PDFs have answer keys in a table format at the end (e.g., "1-B  2-A  3-C  4-D").
   Use these to determine the correct option for each question.

7. MULTI-COLUMN LAYOUTS:
   Questions may span multiple columns on the page.
   Read left-to-right, top-to-bottom within each column before moving to the next.

8. DATA INTERPRETATION:
   Reproduce all tables, charts, or datasets as structured text in "sharedContext".
   Include all row/column headers and numeric values exactly as shown.

9. STATEMENT-COMBINATION:
   Look for "Consider the following statements: I. ... II. ... III. ..."
   The stem must include all statements. Options combine statement numbers (e.g., "Only I and III").

10. STEMLESS / IMPLICIT-STEM QUESTIONS:
   Some questions have NO explicit stem text — just a number (e.g., "Q1.", "1.") followed directly by options or figures.
   This is common in "Odd One Out", "Find the Missing", "Figure Completion", "Figure Formation", "Counting Triangles/Figures" formats.
   INFER the stem from the section heading or question type:
   - Under "ODD ONE OUT" or "ODD MAN OUT": use "Which of the following is the odd one out?"
   - Under "FIGURE COMPLETION": use "Which figure completes the pattern?"
   - Under "FIGURE FORMATION" or "COUNTING TRIANGLES": use the specific counting question visible in the figure context.
   - Under "RANKING" or "ARRANGEMENT": use "Arrange the following in the correct order."
   NEVER return a stem shorter than 10 characters. If you cannot infer a meaningful stem, describe what the question is asking based on the visual context.

11. VISUAL OPTIONS:
   When answer choices are figures, symbols, or patterns (not text), describe each option textually.
   For example: "Option A: Three filled circles arranged in a triangle" or "Option B: Star followed by square followed by circle."
   Include the visual description of each option in the option text field.

GENERAL RULES:
- Return up to ${expectedCount} complete questions.
- Preserve the stem wording as closely as possible — do NOT paraphrase.
- Normalize answer labels to A, B, C, D in the order they appear.
- Each question must have exactly 4 options and exactly 1 correct option (isCorrect: true).
- Include "confidence" (0-1), "sourcePage", "sourceSnippet", and "answerSource" for each question.
- When a figure is textually representable from OCR, prefer preserving the actual OCR figure block in "sharedContext" over replacing it with a generic prose summary.
- "answerSource" must be one of: "ANSWER_KEY", "INLINE_ANSWER", or "INFERRED".
- If a question cannot be recovered confidently, skip it instead of fabricating details.
- Ignore headers, footers, decorative text, and page numbers.
- Use a concise explanation when the source does not include one.
- Assign a short topic tag and EASY/MEDIUM/HARD difficulty.

Return strict JSON with a top-level "questions" array only.`,
                        },
                            {
                                type: 'input_file',
                                filename: fileName,
                                file_data: `data:application/pdf;base64,${buffer.toString('base64')}`,
                            },
                        ],
                    },
                ],
                text: {
                    format: zodTextFormat(McqExtractionResponseSchema, 'mcq_extraction_response'),
                },
            }),
        )

        const cost = calculateCost(model, response.usage)
        totalCost.inputTokens += cost.inputTokens
        totalCost.outputTokens += cost.outputTokens
        totalCost.costUSD += cost.costUSD

        if (isMaxOutputTokenTruncationResponse(response)) {
            console.warn('[AI] Multimodal PDF extraction (one-shot) hit max_output_tokens; retrying with chunked page windows.')
            return {
                mode: 'EXTRACTED',
                error: true,
                truncated: true,
                message: buildMaxOutputTokenFailure('Multimodal PDF extraction (one-shot)').message,
                pageCount,
                chunkCount: 1,
                questions: [],
                failedCount: Math.max(1, expectedCount),
                cost: totalCost,
            }
        }

        const { questions, failedCount } = coerceGeneratedQuestions(response.output_parsed?.questions ?? [])
        const dedupedQuestions = deduplicateQuestions(questions)
        const verification = verifyExtractedQuestions(dedupedQuestions, expectedCount)

        return {
            mode: 'EXTRACTED',
            questions: dedupedQuestions,
            failedCount,
            cost: totalCost,
            pageCount,
            chunkCount: 1,
            verification,
        }
    } catch (error) {
        const failure = toAIChunkFailure(error)
        console.error('[AI] Multimodal PDF extraction failed:', error)
        return {
            mode: 'EXTRACTED',
            error: true,
            message: failure.message,
            pageCount: pdf.numPages,
            chunkCount: 1,
            questions: [],
            failedCount: Math.max(1, expectedCount),
            cost: totalCost.inputTokens > 0 || totalCost.outputTokens > 0 ? totalCost : undefined,
        }
    } finally {
        await pdf.cleanup()
    }
}

async function extractQuestionsFromPdfMultimodalChunked(
    buffer: Buffer,
    expectedCount: number = 50,
    auditUserId?: string,
    fileName: string = 'uploaded.pdf',
): Promise<PdfVisionFallbackResult> {
    if (!openai) {
        return {
            error: true,
            message: 'OpenAI API key not configured. Please set OPENAI_API_KEY.',
            pageCount: 0,
            chunkCount: 0,
            mode: 'EXTRACTED',
        }
    }

    const { extractText, getDocumentProxy, renderPageAsImage } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const model = 'gpt-4o'
    const totalCost: CostInfo = { model, inputTokens: 0, outputTokens: 0, costUSD: 0 }

    try {
        const pageCount = pdf.numPages
        if (pageCount === 0) {
            return {
                error: true,
                message: 'PDF has no pages available for multimodal extraction.',
                pageCount: 0,
                chunkCount: 0,
                mode: 'EXTRACTED',
            }
        }

        const canvasModule = await loadCanvasModule()
        if (!canvasModule) {
            return {
                error: true,
                message: 'Canvas-backed PDF page rendering is unavailable in this runtime.',
                pageCount,
                chunkCount: 0,
                mode: 'EXTRACTED',
            }
        }

        let textResult: { text: string | string[] }
        try {
            textResult = await extractText(pdf, { mergePages: false })
        } catch {
            textResult = { text: [] as string[] }
        }
        const safeTextResult = textResult ?? { text: [] as string[] }
        const pageTexts = Array.isArray(safeTextResult.text) ? safeTextResult.text : [safeTextResult.text]
        const pageNumbers = Array.from({ length: pageCount }, (_, index) => index + 1)
        const pageChunks = buildOverlappingPageChunks(pageNumbers, 2, 1)
        const extractedQuestions: Array<{ questionNumber: number; question: GeneratedQuestion }> = []
        let failedCount = 0
        let chunkFailures = 0
        let lastFailure: AIChunkFailure | null = null

        const extractPageChunkQuestions = async (
            pageChunk: number[],
            depth = 0,
        ): Promise<{
            questions: Array<{ questionNumber: number; question: GeneratedQuestion }>
            failedCount: number
            chunkFailures: number
            failure: AIChunkFailure | null
        }> => {
            const userContent: Array<
                | { type: 'input_text'; text: string }
                | { type: 'input_image'; image_url: string; detail: 'auto' }
            > = [
                {
                    type: 'input_text',
                    text: `Extract the existing MCQs visible on these PDF pages with high precision.

This document may contain visual reasoning questions such as figure completion, figure formation, Venn diagrams, mirror/water images, paper folding, odd-one-out, or diagram-based counting.

STEMLESS / IMPLICIT-STEM QUESTIONS:
Some questions have NO explicit stem text — just a number (e.g., "Q1.", "1.") followed directly by options or figures.
This is common in "Odd One Out", "Figure Completion", "Figure Formation", "Counting Triangles" formats.
INFER the stem from the section heading or question type:
- Under "ODD ONE OUT": use "Which of the following is the odd one out?"
- Under "FIGURE COMPLETION": use "Which figure completes the pattern?"
- Under "FIGURE FORMATION" or triangle counting: use the specific counting question from the figure context.
NEVER return a stem shorter than 10 characters.

VISUAL OPTIONS:
When answer choices are figures, symbols, or patterns (not text), describe each option textually.
Example: "Option A: Three filled circles in a triangle" or "Option B: Star, square, circle pattern."

OCR FIGURE PRESERVATION:
If the OCR excerpt already contains a figure using ASCII/Unicode shapes, stars, circles, slashes, or box-drawing characters, copy that figure block into "sharedContext" exactly as shown.
Preserve spacing and line breaks for that figure block before adding any short explanation.

Rules:
- Return only questions that are visible on the provided pages.
- Each question must include its true questionNumber from the paper.
- If adjacent chunks overlap and the same question appears again, that is okay; preserve the same questionNumber.
- Keep the stem focused on the actual question prompt. Move the figure/diagram/table description into sharedContext.
- If the answer choices are visual, describe each option textually and keep exactly 4 options.
- Preserve answer keys from the page if present. answerSource must be ANSWER_KEY, INLINE_ANSWER, or INFERRED.
- Include sourcePage, sourceSnippet, confidence, and sharedContextEvidence.
- Do not fabricate unseen questions or missing options.
- Skip unusable questions instead of hallucinating.

Return strict JSON with a top-level "questions" array only.`,
                },
            ]

            for (const pageNumber of pageChunk) {
                const pageText = normalizeDocumentText(pageTexts[pageNumber - 1] ?? '')
                const imageUrl = await renderPageAsImage(pdf, pageNumber, {
                    canvasImport: async () => canvasModule,
                    scale: 1.85,
                    toDataURL: true,
                })

                userContent.push({
                    type: 'input_text',
                    text: `Page ${pageNumber} OCR excerpt:\n${truncateForPrompt(pageText, 2400) ?? 'No OCR text available.'}`,
                })
                userContent.push({
                    type: 'input_image',
                    image_url: imageUrl,
                    detail: 'auto',
                })
            }

            try {
                const response = await withOpenAIRetries(
                    `Chunked multimodal PDF extraction (pages ${pageChunk.join(', ')})`,
                    () => openai.responses.parse({
                        model,
                        temperature: 0,
                        max_output_tokens: 16000,
                        input: [
                            {
                                role: 'system',
                                content: 'You extract existing CUET-style MCQs from specific PDF page windows and return only strict structured output.',
                            },
                            {
                                role: 'user',
                                content: userContent,
                            },
                        ],
                        text: {
                            format: zodTextFormat(
                                NumberedMcqExtractionResponseSchema,
                                'numbered_mcq_extraction_response',
                            ),
                        },
                    }),
                )

                const cost = calculateCost(model, response.usage)
                totalCost.inputTokens += cost.inputTokens
                totalCost.outputTokens += cost.outputTokens
                totalCost.costUSD += cost.costUSD

                if (isMaxOutputTokenTruncationResponse(response)) {
                    console.warn(`[AI] Chunked multimodal PDF extraction hit max_output_tokens for ${fileName} pages ${pageChunk.join(', ')}.`)
                    if (depth >= 1 || pageChunk.length <= 1) {
                        return {
                            questions: [],
                            failedCount: 0,
                            chunkFailures: 1,
                            failure: buildMaxOutputTokenFailure(
                                `Chunked multimodal PDF extraction for ${fileName} pages ${pageChunk.join(', ')}`,
                            ),
                        }
                    }

                    let nestedQuestions: Array<{ questionNumber: number; question: GeneratedQuestion }> = []
                    let nestedFailedCount = 0
                    let nestedChunkFailures = 0
                    let nestedFailure: AIChunkFailure | null = null

                    for (const pageNumber of pageChunk) {
                        const nestedResult = await extractPageChunkQuestions([pageNumber], depth + 1)
                        nestedQuestions = nestedQuestions.concat(nestedResult.questions)
                        nestedFailedCount += nestedResult.failedCount
                        nestedChunkFailures += nestedResult.chunkFailures
                        nestedFailure = nestedFailure ?? nestedResult.failure
                    }

                    return {
                        questions: nestedQuestions,
                        failedCount: nestedFailedCount,
                        chunkFailures: nestedChunkFailures,
                        failure: nestedFailure,
                    }
                }

                const normalized = coerceNumberedGeneratedQuestions(response.output_parsed?.questions ?? [])
                return {
                    questions: normalized.questions,
                    failedCount: normalized.failedCount,
                    chunkFailures: 0,
                    failure: null,
                }
            } catch (error) {
                console.error('[AI] Chunked multimodal PDF extraction failed for page chunk:', pageChunk, error)
                return {
                    questions: [],
                    failedCount: 0,
                    chunkFailures: 1,
                    failure: toAIChunkFailure(error),
                }
            }
        }

        for (const pageChunk of pageChunks) {
            const chunkResult = await extractPageChunkQuestions(pageChunk)
            extractedQuestions.push(...chunkResult.questions)
            failedCount += chunkResult.failedCount
            chunkFailures += chunkResult.chunkFailures
            lastFailure = chunkResult.failure ?? lastFailure
        }

        const mergedQuestions = mergeChunkedMultimodalQuestions(extractedQuestions)
        const verification = verifyExtractedQuestions(mergedQuestions, expectedCount)

        if (mergedQuestions.length === 0) {
            return {
                mode: 'EXTRACTED',
                error: true,
                message: lastFailure?.message ?? 'Chunked multimodal extraction could not recover any usable questions.',
                pageCount,
                chunkCount: pageChunks.length,
                questions: [],
                failedCount: Math.max(1, failedCount || expectedCount),
                cost: totalCost.inputTokens > 0 || totalCost.outputTokens > 0 ? totalCost : undefined,
            }
        }

        return {
            mode: 'EXTRACTED',
            questions: mergedQuestions,
            failedCount,
            cost: totalCost,
            pageCount,
            chunkCount: pageChunks.length,
            verification,
            ...(chunkFailures > 0
                ? {
                    message: `Chunked multimodal extraction skipped ${chunkFailures} page chunk(s) while recovering the visual question set.`,
                }
                : {}),
        }
    } catch (error) {
        const failure = toAIChunkFailure(error)
        console.error('[AI] Chunked multimodal PDF extraction failed:', error)
        return {
            mode: 'EXTRACTED',
            error: true,
            message: failure.message,
            pageCount: pdf.numPages,
            chunkCount: 0,
            questions: [],
            failedCount: Math.max(1, expectedCount),
            cost: totalCost.inputTokens > 0 || totalCost.outputTokens > 0 ? totalCost : undefined,
        }
    } finally {
        await pdf.cleanup()
    }
}

export async function extractQuestionsFromPdfMultimodal(
    buffer: Buffer,
    expectedCount: number = 50,
    auditUserId?: string,
    fileName: string = 'uploaded.pdf',
    options: PdfMultimodalExtractionOptions = {},
): Promise<PdfVisionFallbackResult> {
    if (!options.preferChunkedVisualExtraction) {
        const oneShot = await extractQuestionsFromPdfMultimodalOneShot(buffer, expectedCount, auditUserId, fileName)
        if (oneShot.truncated) {
            const chunkedRetry = await extractQuestionsFromPdfMultimodalChunked(
                buffer,
                expectedCount,
                auditUserId,
                fileName,
            )
            const mergedCost = mergeCosts(oneShot.cost, chunkedRetry.cost)
            if (auditUserId && mergedCost) {
                await logCostToAudit(auditUserId, 'AI_MULTIMODAL_EXTRACT', mergedCost)
            }
            return {
                ...chunkedRetry,
                cost: mergedCost,
                message: appendAIMessage(
                    'One-shot multimodal extraction hit max_output_tokens and was retried with chunked page windows.',
                    chunkedRetry.message,
                ),
            }
        }

        if (auditUserId && oneShot.cost) {
            await logCostToAudit(auditUserId, 'AI_MULTIMODAL_EXTRACT', oneShot.cost)
        }

        return oneShot
    }

    const chunked = await extractQuestionsFromPdfMultimodalChunked(
        buffer,
        expectedCount,
        auditUserId,
        fileName,
    )
    if (shouldPreferChunkedMultimodalResult(chunked, expectedCount)) {
        if (auditUserId && chunked.cost) {
            await logCostToAudit(auditUserId, 'AI_MULTIMODAL_EXTRACT', chunked.cost)
        }
        return chunked
    }

    if (options.allowOneShotFallbackAfterChunked === false) {
        if (auditUserId && chunked.cost) {
            await logCostToAudit(auditUserId, 'AI_MULTIMODAL_EXTRACT', chunked.cost)
        }
        return chunked
    }

    const oneShot = await extractQuestionsFromPdfMultimodalOneShot(
        buffer,
        expectedCount,
        auditUserId,
        fileName,
    )
    if (oneShot.truncated) {
        if (auditUserId && chunked.cost) {
            await logCostToAudit(auditUserId, 'AI_MULTIMODAL_EXTRACT', chunked.cost)
        }
        return {
            ...chunked,
            message: appendAIMessage(
                chunked.message,
                'One-shot multimodal fallback also hit max_output_tokens and the chunked result was kept.',
            ),
        }
    }

    const preferredResult = shouldPreferPdfResult(chunked, oneShot) ? chunked : oneShot
    const mergedCost = mergeCosts(chunked.cost, oneShot.cost)
    if (auditUserId && mergedCost) {
        await logCostToAudit(auditUserId, 'AI_MULTIMODAL_EXTRACT', mergedCost)
    }

    return {
        ...preferredResult,
        cost: mergedCost,
    }
}

function normalizeVisualReferences(rawReferences: unknown) {
    if (!Array.isArray(rawReferences)) {
        return []
    }

    const references = rawReferences
        .map((reference) => VisualReferenceExtractionSchema.safeParse(reference))
        .filter((parsed): parsed is { success: true; data: import('@/lib/services/ai-extraction-schemas').VisualReferenceExtraction } => parsed.success)
        .map(({ data }) => ({
            questionNumber: data.questionNumber,
            sharedContext: normalizeSharedContextText(data.sharedContext) ?? data.sharedContext,
            sourcePage: Number.isInteger(data.sourcePage) && Number(data.sourcePage) > 0 ? Number(data.sourcePage) : null,
            sourceSnippet: truncateEvidenceText(data.sourceSnippet),
            sharedContextEvidence: truncateEvidenceText(data.sharedContextEvidence ?? data.sourceSnippet),
            confidence: typeof data.confidence === 'number' ? normalizeConfidenceScore(data.confidence) : null,
        }))
        .filter((reference) => Boolean(reference.sharedContext))

    const referencesByQuestion = new Map<number, (typeof references)[number]>()
    for (const reference of references) {
        const previous = referencesByQuestion.get(reference.questionNumber)
        if (!previous || (reference.sharedContext?.length ?? 0) > (previous.sharedContext?.length ?? 0)) {
            referencesByQuestion.set(reference.questionNumber, reference)
        }
    }

    return Array.from(referencesByQuestion.values()).sort((left, right) => left.questionNumber - right.questionNumber)
}

async function loadCanvasModule(): Promise<CanvasModule | null> {
    try {
        return requireCanvasModule(OPTIONAL_CANVAS_MODULE) as CanvasModule
    } catch (error) {
        console.warn('[AI] Canvas-backed PDF rendering unavailable in this runtime:', error)
        return null
    }
}

export async function extractVisualReferencesFromPdfImages(
    buffer: Buffer,
    auditUserId?: string,
    fileName: string = 'uploaded.pdf',
): Promise<VisualReferenceExtractionResult> {
    if (!openai) {
        return {
            error: true,
            message: 'OpenAI API key not configured. Please set OPENAI_API_KEY.',
            pageCount: 0,
            chunkCount: 0,
            references: [],
        }
    }

    const { extractText, getDocumentProxy, renderPageAsImage } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const model = 'gpt-4o'
    const totalCost: CostInfo = { model, inputTokens: 0, outputTokens: 0, costUSD: 0 }

    try {
        const pageCount = pdf.numPages
        if (pageCount === 0) {
            return {
                error: true,
                message: 'PDF has no pages available for visual-reference extraction.',
                pageCount: 0,
                chunkCount: 0,
                references: [],
            }
        }

        const canvasModule = await loadCanvasModule()
        if (!canvasModule) {
            return {
                error: true,
                message: 'Visual-reference extraction is unavailable because PDF page rendering is not available in this runtime.',
                pageCount,
                chunkCount: 0,
                references: [],
            }
        }

        let textResult: { text: string | string[] }
        try {
            textResult = await extractText(pdf, { mergePages: false })
        } catch {
            textResult = { text: [] as string[] }
        }
        const safeTextResult = textResult ?? { text: [] as string[] }
        const pageTexts = Array.isArray(safeTextResult.text) ? safeTextResult.text : [safeTextResult.text]
        const pageNumbers = Array.from({ length: pageCount }, (_, index) => index + 1)
        const pageChunks = chunkArray(pageNumbers, 2)
        const extractedReferences: ReturnType<typeof normalizeVisualReferences> = []
        let chunkFailures = 0
        let lastFailure: AIChunkFailure | null = null

        const extractPageChunkReferences = async (
            pageChunk: number[],
            depth = 0,
        ): Promise<{
            references: ReturnType<typeof normalizeVisualReferences>
            chunkFailures: number
            failure: AIChunkFailure | null
        }> => {
            const userContent: Array<
                | { type: 'input_text'; text: string }
                | { type: 'input_image'; image_url: string; detail: 'auto' }
            > = [
                {
                    type: 'input_text',
                    text: `Extract only visual-reference context from these mock-test PDF pages.

VISUAL TYPE HANDLING:

1. VENN DIAGRAMS: Describe the sets, their labels, overlap regions, and any numbers/items shown in each region.
   If OCR already contains a text/box-drawing Venn diagram, copy that diagram block first with spacing preserved.
   Example sharedContext: "Venn diagram with Set A (Mammals) and Set B (Aquatic). Overlap contains: Whale, Dolphin. A only: Cat, Dog. B only: Fish, Shark."

2. FIGURE SERIES / COMPLETION: Describe the visual pattern (shapes, rotations, size progression, shading changes).
   If OCR already contains an ASCII/Unicode figure, preserve that figure block exactly in sharedContext before the explanation.
   Do NOT replace a visible figure with a generic summary like "pattern of shapes" — keep the actual OCR-visible symbols/line-work first.
   Example:
   "★ ☆ ☆
    ★ ★ ☆
    ?"
   Pattern: one additional star appears in each row from left to right.

3. MIRROR IMAGE / WATER IMAGE: Describe the original figure and the axis of reflection.
   Example: "Original figure is the letter 'R' with a dot above. Mirror axis is vertical."

4. PAPER FOLDING / CUTTING: Describe the fold direction(s), punch position, and expected unfolded result.
   Example: "Square paper folded in half vertically, then a triangular cut at bottom-right corner."

5. DATA TABLES / CHARTS: Reproduce the table or chart data as structured text including all headers and values.

6. MAPS / GEOGRAPHIC DIAGRAMS: Describe regions, labels, compass directions, and any marked locations.

7. GRAPHS: Describe axes, labels, data points/lines, and any trends visible.

Rules:
- Return only question numbers that depend on a visual, figure, Venn diagram, embedded image, chart, graph, map, or non-linear visual prompt.
- Do not return normal text-only questions.
- sharedContext must capture the visual information a student must see before answering, described textually.
- sharedContext should be student-usable, not vague. Prefer a faithful OCR/block reconstruction plus 1 short interpretation line.
- When OCR already contains a diagram/table/figure block, preserve that block with line breaks and spacing instead of replacing it with a generic summary.
- sourcePage must identify the page the visual appears on.
- sourceSnippet should quote a short OCR/instruction snippet that proves the visual belongs to that question set.
- sharedContextEvidence should briefly explain what visual cue is being carried into the question.
- confidence should be between 0 and 1.
- If no question on these pages depends on a visual reference, return an empty references array.
- Never invent answer choices, question stems, or question numbers.`,
                },
            ]

            for (const pageNumber of pageChunk) {
                const pageText = normalizeDocumentText(pageTexts[pageNumber - 1] ?? '')
                const imageUrl = await renderPageAsImage(pdf, pageNumber, {
                    canvasImport: async () => canvasModule,
                    scale: 1.65,
                    toDataURL: true,
                })

                userContent.push({
                    type: 'input_text',
                    text: `Page ${pageNumber} OCR excerpt:\n${truncateForPrompt(pageText, 1800) ?? 'No OCR text available.'}`,
                })
                userContent.push({
                    type: 'input_image',
                    image_url: imageUrl,
                    detail: 'auto',
                })
            }

            try {
                const response = await withOpenAIRetries(
                    `Visual-reference extraction (pages ${pageChunk.join(', ')})`,
                    () => openai.responses.parse({
                        model,
                        temperature: 0,
                        max_output_tokens: 8000,
                        input: [
                            {
                                role: 'system',
                                content: 'You extract only visual-reference context from uploaded CUET mock-test PDF pages and return strict structured output.',
                            },
                            {
                                role: 'user',
                                content: userContent,
                            },
                        ],
                        text: {
                            format: zodTextFormat(
                                VisualReferenceExtractionResponseSchema,
                                'visual_reference_extraction_response',
                            ),
                        },
                    }),
                )

                const cost = calculateCost(model, response.usage)
                totalCost.inputTokens += cost.inputTokens
                totalCost.outputTokens += cost.outputTokens
                totalCost.costUSD += cost.costUSD

                if (isMaxOutputTokenTruncationResponse(response)) {
                    console.warn(`[AI] Visual-reference extraction hit max_output_tokens for ${fileName} pages ${pageChunk.join(', ')}.`)
                    if (depth >= 1 || pageChunk.length <= 1) {
                        return {
                            references: [],
                            chunkFailures: 1,
                            failure: buildMaxOutputTokenFailure(
                                `Visual-reference extraction for ${fileName} pages ${pageChunk.join(', ')}`,
                            ),
                        }
                    }

                    let nestedReferences: ReturnType<typeof normalizeVisualReferences> = []
                    let nestedFailures = 0
                    let nestedFailure: AIChunkFailure | null = null

                    for (const pageNumber of pageChunk) {
                        const nestedResult = await extractPageChunkReferences([pageNumber], depth + 1)
                        nestedReferences = nestedReferences.concat(nestedResult.references)
                        nestedFailures += nestedResult.chunkFailures
                        nestedFailure = nestedFailure ?? nestedResult.failure
                    }

                    return {
                        references: nestedReferences,
                        chunkFailures: nestedFailures,
                        failure: nestedFailure,
                    }
                }

                const parsedReferences = VisualReferenceExtractionResponseSchema.safeParse(response.output_parsed)
                if (parsedReferences.success) {
                    return {
                        references: normalizeVisualReferences(parsedReferences.data.references),
                        chunkFailures: 0,
                        failure: null,
                    }
                }

                return {
                    references: [],
                    chunkFailures: 0,
                    failure: null,
                }
            } catch (error) {
                console.error('[AI] Visual-reference extraction failed for page chunk:', pageChunk, error)
                return {
                    references: [],
                    chunkFailures: 1,
                    failure: toAIChunkFailure(error),
                }
            }
        }

        for (const pageChunk of pageChunks) {
            const chunkResult = await extractPageChunkReferences(pageChunk)
            extractedReferences.push(...chunkResult.references)
            chunkFailures += chunkResult.chunkFailures
            lastFailure = chunkResult.failure ?? lastFailure
        }

        if (auditUserId && (totalCost.inputTokens > 0 || totalCost.outputTokens > 0)) {
            await logCostToAudit(auditUserId, 'AI_VISUAL_REFERENCE_EXTRACT', totalCost)
        }

        const references = normalizeVisualReferences(extractedReferences)
        if (references.length === 0 && chunkFailures > 0) {
            return {
                error: true,
                message: lastFailure?.message ?? 'Visual-reference extraction could not recover any usable diagram context.',
                pageCount,
                chunkCount: pageChunks.length,
                references: [],
                cost: totalCost,
            }
        }

        return {
            references,
            pageCount,
            chunkCount: pageChunks.length,
            cost: totalCost,
            ...(chunkFailures > 0
                ? {
                    message: `Visual-reference extraction skipped ${chunkFailures} page chunk(s) while recovering diagram context.`,
                }
                : {}),
        }
    } finally {
        await pdf.cleanup()
    }
}

export async function generateQuestionsFromPdfVisionFallback(
    buffer: Buffer,
    count: number = 30,
    auditUserId?: string,
    fileName: string = 'uploaded.pdf',
): Promise<PdfVisionFallbackResult> {
    const multimodalResult = await extractQuestionsFromPdfMultimodal(buffer, count, auditUserId, fileName)
    if (!multimodalResult.error && multimodalResult.questions && multimodalResult.questions.length > 0) {
        return multimodalResult
    }

    let text = ''
    try {
        text = await parsePdfToText(buffer)
    } catch (error) {
        console.error('[AI] PDF text fallback parsing failed:', error)
    }

    if (text.trim().length < 50) {
        return multimodalResult.error
            ? multimodalResult
            : {
                mode: 'GENERATED',
                error: true,
                message: 'Could not recover usable PDF content for AI generation fallback.',
                pageCount: multimodalResult.pageCount,
                chunkCount: multimodalResult.chunkCount,
            }
    }

    const generatedResult = await generateQuestionsFromText(text, count, auditUserId)
    if (generatedResult.error || !generatedResult.questions || generatedResult.questions.length === 0) {
        return {
            mode: 'GENERATED',
            error: true,
            message: generatedResult.message || multimodalResult.message || 'AI generation fallback could not recover the document.',
            pageCount: multimodalResult.pageCount,
            chunkCount: multimodalResult.chunkCount,
            failedCount: generatedResult.failedCount,
            cost: mergeCosts(multimodalResult.cost, generatedResult.cost),
        }
    }

    return {
        mode: 'GENERATED',
        questions: deduplicateQuestions(generatedResult.questions),
        failedCount: generatedResult.failedCount,
        cost: mergeCosts(multimodalResult.cost, generatedResult.cost),
        pageCount: multimodalResult.pageCount,
        chunkCount: multimodalResult.chunkCount,
        verification: verifyExtractedQuestions(generatedResult.questions, null),
    }
}

// ── Single-Chunk Generation ──
async function generateFromChunk(
    chunk: string,
    count: number,
    model: string
): Promise<{ questions: GeneratedQuestion[]; failedCount: number; cost?: CostInfo; failure?: AIChunkFailure }> {
    const prompt = `You are an expert test creator. Generate ${count} multiple-choice questions from the following educational content. Cover as many major sections, subtopics, definitions, formulas, and examples from the source as possible. Do not produce random trivia or repetitive paraphrases.

QUESTION FORMAT VARIETY:
When the content supports it, vary the question formats:
- Standard MCQ: Direct factual or conceptual questions.
- Assertion-Reason: When the content has cause-effect relationships, generate "Assertion (A): ... Reason (R): ..." style questions with standard AR options.
- Statement-Combination: When the content lists multiple related facts, generate "Consider the following statements: I. ... II. ..." questions.
- Application-Based: Generate scenario or case-based questions that test understanding, not just recall.

Each question MUST have:
- A clear, unambiguous stem
- Exactly 4 options labeled A-D
- Exactly 1 correct answer
- A brief explanation of why the correct answer is right
- A difficulty rating (EASY/MEDIUM/HARD) — aim for a mix of ~30% EASY, ~50% MEDIUM, ~20% HARD
- A topic tag

Content:
${chunk}

Respond in JSON format:
{
  "questions": [
    {
      "stem": "question text",
      "options": [
        {"id": "A", "text": "option text", "isCorrect": false},
        {"id": "B", "text": "option text", "isCorrect": true},
        {"id": "C", "text": "option text", "isCorrect": false},
        {"id": "D", "text": "option text", "isCorrect": false}
      ],
      "explanation": "why B is correct",
      "difficulty": "MEDIUM",
      "topic": "topic name"
    }
  ]
    }`

    try {
        const response = await withOpenAIRetries(
            `Question generation chunk (${model})`,
            () => openai!.chat.completions.create({
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 4000,
                response_format: { type: 'json_object' },
            }),
        )

        const content = response.choices[0]?.message?.content
        if (!content) throw new Error('Empty AI response')

        const cost = calculateCost(model, response.usage as { prompt_tokens?: number; completion_tokens?: number })
        const parsed = JSON.parse(content)
        const { questions, failedCount } = coerceGeneratedQuestions(parsed.questions)

        return { questions, failedCount, cost }
    } catch (err) {
        console.error(`[AI] Question generation failed with ${model}:`, err)
        return { questions: [], failedCount: count, failure: toAIChunkFailure(err) }
    }
}

// ── Parse DOCX to Plain Text ──
export async function parseDocxToText(buffer: Buffer): Promise<string> {
    const mammoth = await import('mammoth')

    const normalizeDocxHtml = (html: string) => normalizeDocumentText(
        html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|section|article|h[1-6]|table|tr|ul|ol)>/gi, '\n')
            .replace(/<(li|td|th)[^>]*>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&#39;/g, '\'')
            .replace(/&quot;/gi, '"'),
    )

    try {
        const htmlResult = await mammoth.convertToHtml({ buffer })
        const normalizedHtml = normalizeDocxHtml(htmlResult.value)
        if (normalizedHtml.length > 0) {
            return normalizedHtml
        }
    } catch (error) {
        console.warn('[AI] DOCX HTML conversion failed, falling back to raw text extraction.', error)
    }

    const rawTextResult = await mammoth.extractRawText({ buffer })
    return normalizeDocumentText(rawTextResult.value)
}

export async function parsePdfToText(buffer: Buffer): Promise<string> {
    const { getDocumentProxy, extractText } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buffer))

    try {
        const result = await extractText(pdf, { mergePages: false })
        const pages = Array.isArray(result.text) ? result.text : [result.text]
        return normalizeDocumentText(pages.join('\n'))
    } finally {
        await pdf.cleanup()
    }
}

export async function attachSharedContextsFromPdf(
    buffer: Buffer,
    questions: GeneratedQuestion[],
): Promise<GeneratedQuestion[]> {
    if (questions.length === 0) {
        return questions
    }

    const { getDocumentProxy, extractText } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buffer))

    try {
        const result = await extractText(pdf, { mergePages: false })
        const pages = Array.isArray(result.text) ? result.text : [result.text]
        return attachSharedContextsFromPageText(questions, pages)
    } finally {
        await pdf.cleanup()
    }
}

export async function parseDocumentToText(buffer: Buffer, fileName: string): Promise<string> {
    const lowerFileName = fileName.toLowerCase()
    if (lowerFileName.endsWith('.docx')) {
        return parseDocxToText(buffer)
    }

    if (lowerFileName.endsWith('.pdf')) {
        return parsePdfToText(buffer)
    }

    throw new Error('Unsupported document format')
}
