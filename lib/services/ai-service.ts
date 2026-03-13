import OpenAI from 'openai'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

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

export interface GeneratedQuestion {
    stem: string
    options: { id: string; text: string; isCorrect: boolean }[]
    explanation: string
    difficulty: string
    topic: string
}

interface CostInfo {
    model: string
    inputTokens: number
    outputTokens: number
    costUSD: number
}

export type DocumentQuestionStrategy = 'EXTRACTED' | 'AI_GENERATED'

export interface ExtractedQuestionAnalysis {
    detectedAsMcqDocument: boolean
    answerHintCount: number
    candidateBlockCount: number
    questions: GeneratedQuestion[]
}

// ── Cost Tracking Helper ──
function calculateCost(model: string, usage?: { prompt_tokens?: number; completion_tokens?: number }): CostInfo {
    const rates = MODEL_COSTS[model] || MODEL_COSTS['gpt-4o-mini']
    const inputTokens = usage?.prompt_tokens ?? 0
    const outputTokens = usage?.completion_tokens ?? 0
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
function chunkText(text: string, maxChars = 16000, overlap = 500): string[] {
    if (text.length <= maxChars) return [text]
    const chunks: string[] = []
    let start = 0
    while (start < text.length) {
        const end = Math.min(start + maxChars, text.length)
        chunks.push(text.slice(start, end))
        start = end - overlap
        if (start >= text.length) break
    }
    return chunks
}

function normalizeDocumentText(text: string): string {
    return text
        .replace(/\r\n?/g, '\n')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
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

function stripQuestionLabel(line: string): { questionNumber: number | null; stem: string } | null {
    const questionStartMatch = line.match(
        /^(?:question\s*|ques(?:tion)?\s*|q\s*)?(\d+)\s*(?:[.)\-:]|\b)\s*(.+)$/i
    )

    if (!questionStartMatch) return null

    return {
        questionNumber: Number.parseInt(questionStartMatch[1], 10),
        stem: normalizeStem(questionStartMatch[2]),
    }
}

function looksLikeQuestionStart(line: string): boolean {
    return stripQuestionLabel(line) !== null
}

function extractAnswerKey(text: string): Map<number, string> {
    const answerKey = new Map<number, string>()
    const answerSectionMatch = text.match(
        /(?:^|\n)(?:answer\s*key|answers?|correct\s*answers?)\s*[:\-]?\s*([\s\S]{0,4000})$/i
    )

    const searchArea = answerSectionMatch?.[1] ?? ''
    if (!searchArea) return answerKey

    const pairRegex = /(\d{1,4})\s*[\).:\-]?\s*(?:option\s*)?([A-D])\b/gi
    let match: RegExpExecArray | null
    while ((match = pairRegex.exec(searchArea)) !== null) {
        answerKey.set(Number.parseInt(match[1], 10), match[2].toUpperCase())
    }

    return answerKey
}

function parseQuestionBlock(block: string, answerKey: Map<number, string>): {
    answerHintUsed: boolean
    candidate: boolean
    question: GeneratedQuestion | null
} {
    const rawLines = block
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)

    if (rawLines.length === 0) {
        return { answerHintUsed: false, candidate: false, question: null }
    }

    const firstLine = stripQuestionLabel(rawLines[0])
    if (!firstLine || !firstLine.stem) {
        return { answerHintUsed: false, candidate: false, question: null }
    }

    const stemParts = [firstLine.stem]
    const options = new Map<string, string>()
    let activeOption: string | null = null
    let correctOptionId: string | null = null
    let explanation = ''
    let answerHintUsed = false

    for (const line of rawLines.slice(1)) {
        if (looksLikeQuestionStart(line)) break

        const answerMatch = line.match(
            /^(?:answer|ans(?:wer)?|correct\s*answer|correct\s*option|right\s*answer)\s*[:\-]?\s*(?:option\s*)?([A-D])\b/i
        )
        if (answerMatch) {
            correctOptionId = answerMatch[1].toUpperCase()
            answerHintUsed = true
            activeOption = null
            continue
        }

        const explanationMatch = line.match(/^(?:explanation|reason)\s*[:\-]?\s*(.+)$/i)
        if (explanationMatch) {
            explanation = explanationMatch[1].trim()
            activeOption = null
            continue
        }

        const optionMatch = line.match(/^\(?([A-D])\)?\s*[.)\-:]?\s+(.+)$/i)
        if (optionMatch) {
            const optionId = optionMatch[1].toUpperCase()
            const optionText = normalizeOptionText(optionMatch[2])

            if (!optionText) continue

            if (/\((?:correct)\)|\[(?:correct)\]|✓|✅/i.test(optionMatch[2])) {
                correctOptionId = optionId
                answerHintUsed = true
            }

            options.set(optionId, optionText)
            activeOption = optionId
            continue
        }

        if (activeOption && options.has(activeOption)) {
            options.set(activeOption, `${options.get(activeOption)} ${normalizeOptionText(line)}`.trim())
            continue
        }

        stemParts.push(line)
    }

    if (!correctOptionId && firstLine.questionNumber !== null) {
        const keyedAnswer = answerKey.get(firstLine.questionNumber)
        if (keyedAnswer) {
            correctOptionId = keyedAnswer
            answerHintUsed = true
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
        stem: normalizeStem(stemParts.join(' ')),
        options: optionEntries,
        explanation: explanation || 'Imported from structured MCQ document.',
        difficulty: guessDifficulty(stemParts.join(' ')),
        topic: detectTopic(stemParts.join(' ')),
    }

    return {
        answerHintUsed,
        candidate: true,
        question: validateQuestion(question) ? question : null,
    }
}

export function extractQuestionsFromDocumentText(text: string): ExtractedQuestionAnalysis {
    const structuredText = normalizeDocumentText(text)
        .replace(/\n(?=\d+\s*[.)])/g, '\n')
        .replace(/([^\n])\s+(?=(?:question\s*\d+|ques(?:tion)?\s*\d+|q\s*\d+|\d+\s*[.)-])\s)/gi, '$1\n')
        .replace(/([^\n])\s+(?=(?:\(?[A-D]\)?\s*[.)\-:])\s+)/g, '$1\n')
        .replace(/([^\n])\s+(?=(?:answer|ans(?:wer)?|correct\s*answer|explanation)\s*[:\-])/gi, '$1\n')

    const answerKey = extractAnswerKey(structuredText)
    const blocks = structuredText
        .split(/\n(?=(?:question\s*|ques(?:tion)?\s*|q\s*)?\d+\s*(?:[.)\-:]|\b)\s+)/i)
        .map(block => block.trim())
        .filter(Boolean)

    const questions: GeneratedQuestion[] = []
    let candidateBlockCount = 0
    let answerHintCount = 0

    for (const block of blocks) {
        const parsed = parseQuestionBlock(block, answerKey)
        if (!parsed.candidate) continue

        candidateBlockCount++
        if (parsed.answerHintUsed) answerHintCount++
        if (parsed.question) questions.push(parsed.question)
    }

    const detectedAsMcqDocument =
        questions.length >= 5 || (questions.length >= 3 && answerHintCount >= Math.ceil(questions.length / 2))

    return {
        detectedAsMcqDocument,
        answerHintCount,
        candidateBlockCount,
        questions: deduplicateQuestions(questions),
    }
}

// ── Generate Personalized Feedback ──
export async function generatePersonalizedFeedback(
    session: SessionData,
    questions: QuestionData[],
    teacherId?: string
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
        if (teacherId) await logCostToAudit(teacherId, 'AI_FEEDBACK', cost)

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

// ── Zod-style Validation for Generated Questions ──
function validateQuestion(q: GeneratedQuestion): boolean {
    if (!q.stem || q.stem.length < 3) return false
    if (!Array.isArray(q.options) || q.options.length !== 4) return false
    const correctCount = q.options.filter(o => o.isCorrect).length
    if (correctCount !== 1) return false
    if (q.options.some(o => !o.text || !o.id)) return false
    return true
}

// ── Deduplicate questions by stem similarity ──
function deduplicateQuestions(questions: GeneratedQuestion[]): GeneratedQuestion[] {
    const seen = new Set<string>()
    return questions.filter(q => {
        const key = q.stem.toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 80)
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}

// ── Generate MCQs from Document Text (with chunking + retry) ──
export async function generateQuestionsFromText(
    text: string,
    count: number = 10,
    teacherId?: string
): Promise<{ questions?: GeneratedQuestion[]; failedCount?: number; cost?: CostInfo; error?: boolean; message?: string }> {
    if (!openai) {
        return { error: true, message: 'OpenAI API key not configured. Please set OPENAI_API_KEY.' }
    }

    const chunks = chunkText(text)
    const questionsPerChunk = Math.ceil(count / chunks.length)
    let allQuestions: GeneratedQuestion[] = []
    const totalCost: CostInfo = { model: 'gpt-4o-mini', inputTokens: 0, outputTokens: 0, costUSD: 0 }
    let failedCount = 0

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
            }
        }
    }

    // Deduplicate across chunks
    allQuestions = deduplicateQuestions(allQuestions)

    // Trim to requested count
    if (allQuestions.length > count) {
        allQuestions = allQuestions.slice(0, count)
    }

    // Log cost to AuditLog if we have a teacherId
    if (teacherId) await logCostToAudit(teacherId, 'AI_GENERATE', totalCost)

    return { questions: allQuestions, failedCount: Math.max(0, failedCount), cost: totalCost }
}

// ── Single-Chunk Generation ──
async function generateFromChunk(
    chunk: string,
    count: number,
    model: string
): Promise<{ questions: GeneratedQuestion[]; failedCount: number; cost?: CostInfo }> {
    const prompt = `You are an expert test creator. Generate ${count} multiple-choice questions from the following educational content. Cover as many major sections, subtopics, definitions, formulas, and examples from the source as possible. Do not produce random trivia or repetitive paraphrases. Each question MUST have:
- A clear, unambiguous stem
- Exactly 4 options labeled A-D
- Exactly 1 correct answer
- A brief explanation of why the correct answer is right
- A difficulty rating (EASY/MEDIUM/HARD)
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
        const response = await openai!.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 4000,
            response_format: { type: 'json_object' },
        })

        const content = response.choices[0]?.message?.content
        if (!content) throw new Error('Empty AI response')

        const cost = calculateCost(model, response.usage as { prompt_tokens?: number; completion_tokens?: number })
        const parsed = JSON.parse(content)
        const rawQuestions: GeneratedQuestion[] = parsed.questions || []

        // Validate each question
        const valid: GeneratedQuestion[] = []
        let failed = 0
        for (const q of rawQuestions) {
            if (validateQuestion(q)) {
                valid.push(q)
            } else {
                failed++
            }
        }

        return { questions: valid, failedCount: failed, cost }
    } catch (err) {
        console.error(`[AI] Question generation failed with ${model}:`, err)
        return { questions: [], failedCount: count }
    }
}

// ── Parse DOCX to Plain Text ──
export async function parseDocxToText(buffer: Buffer): Promise<string> {
    // Dynamic import to avoid bundling issues
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    return normalizeDocumentText(result.value)
}

export async function parsePdfToText(buffer: Buffer): Promise<string> {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: buffer })

    try {
        const result = await parser.getText()
        return normalizeDocumentText(result.text)
    } finally {
        await parser.destroy()
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
