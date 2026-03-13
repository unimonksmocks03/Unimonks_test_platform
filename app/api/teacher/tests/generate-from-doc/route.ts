import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
import { withAuth } from '@/lib/middleware/auth-guard'
import {
    extractQuestionsFromDocumentText,
    generateQuestionsFromText,
    parseDocumentToText,
} from '@/lib/services/ai-service'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { Role, Prisma } from '@prisma/client'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const MIN_GENERATED_QUESTIONS = 30
const RATE_LIMIT_KEY = (userId: string) => `ai:docgen:${userId}`
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW = 3600 // 1 hour in seconds

export const maxDuration = 60 // Large DOCX parsing + AI generation can exceed the default serverless budget

async function postHandler(
    req: NextRequest,
    ctx: { userId: string; role: Role }
) {
    // 1. Rate limiting (5/hour per teacher)
    const key = RATE_LIMIT_KEY(ctx.userId)
    const current = await redis.incr(key)
    if (current === 1) await redis.expire(key, RATE_LIMIT_WINDOW)
    if (current > RATE_LIMIT_MAX) {
        const ttl = await redis.ttl(key)
        return NextResponse.json(
            { error: true, code: 'RATE_LIMITED', message: `Upload limit reached. Try again in ${ttl}s.`, retryAfter: ttl },
            { status: 429 }
        )
    }

    // 2. Parse FormData
    let formData: FormData
    try {
        formData = await req.formData()
    } catch {
        return NextResponse.json(
            { error: true, code: 'BAD_REQUEST', message: 'Invalid form data' },
            { status: 400 }
        )
    }

    const file = formData.get('file') as File | null
    const countRaw = formData.get('count')
    const titleRaw = formData.get('title')
    const requestedCount = countRaw ? Number.parseInt(String(countRaw), 10) : Number.NaN
    const generationTarget = Number.isFinite(requestedCount)
        ? Math.max(MIN_GENERATED_QUESTIONS, requestedCount)
        : MIN_GENERATED_QUESTIONS

    if (!file) {
        return NextResponse.json(
            { error: true, code: 'BAD_REQUEST', message: 'No file provided' },
            { status: 400 }
        )
    }

    // 3. Validate file type
    const fileName = file.name.toLowerCase()
    const isSupportedDocument = fileName.endsWith('.docx') || fileName.endsWith('.pdf')
    if (!isSupportedDocument) {
        return NextResponse.json(
            { error: true, code: 'BAD_REQUEST', message: 'Only .docx and .pdf files are supported' },
            { status: 400 }
        )
    }

    // 4. Validate file size
    if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
            { error: true, code: 'BAD_REQUEST', message: `File too large. Max ${MAX_FILE_SIZE / 1024 / 1024}MB.` },
            { status: 400 }
        )
    }

    // 5. Check teacher status
    const teacher = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { status: true } })
    if (!teacher || teacher.status !== 'ACTIVE') {
        return NextResponse.json(
            { error: true, code: 'FORBIDDEN', message: 'Only active teachers can generate tests' },
            { status: 403 }
        )
    }

    // 6. Parse uploaded document → Text
    let text: string
    try {
        const arrayBuffer = await file.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        text = await parseDocumentToText(buffer, file.name)
    } catch (err) {
        console.error('[AI-DOC] Failed to parse uploaded document:', err)
        return NextResponse.json(
            {
                error: true,
                code: 'PARSE_ERROR',
                message: 'Failed to parse document. Ensure it is a valid .docx or text-based .pdf file.',
            },
            { status: 400 }
        )
    }

    if (text.length < 50) {
        return NextResponse.json(
            { error: true, code: 'BAD_REQUEST', message: 'Document has too little text to generate questions from.' },
            { status: 400 }
        )
    }

    // 7. Extract structured MCQs first, otherwise fall back to AI generation from notes.
    const extracted = extractQuestionsFromDocumentText(text)
    const usedStrategy = extracted.detectedAsMcqDocument ? 'EXTRACTED' : 'AI_GENERATED'
    const result = extracted.detectedAsMcqDocument
        ? {
            error: false,
            message: undefined,
            questions: extracted.questions,
            failedCount: Math.max(0, extracted.candidateBlockCount - extracted.questions.length),
            cost: undefined,
        }
        : await generateQuestionsFromText(text, generationTarget, ctx.userId)

    if (result.error || !result.questions || result.questions.length === 0) {
        return NextResponse.json(
            { error: true, code: 'GENERATION_FAILED', message: result.message || 'Failed to generate questions.' },
            { status: 500 }
        )
    }

    // 8. Create DRAFT Test + Questions
    const baseTitle = file.name.replace(/\.(docx|pdf)$/i, '')
    const testTitle = String(titleRaw || `AI Generated Test — ${baseTitle || new Date().toLocaleDateString()}`)
    const test = await prisma.test.create({
        data: {
            teacherId: ctx.userId,
            title: testTitle,
            description: `Auto-generated from document: ${file.name}`,
            durationMinutes: Math.max(15, result.questions.length * 2),
            status: 'DRAFT',
            source: 'AI_GENERATED',
            questions: {
                create: result.questions.map((q, i) => ({
                    order: i + 1,
                    stem: q.stem,
                    options: q.options as unknown as Prisma.InputJsonValue,
                    explanation: q.explanation || null,
                    difficulty: (q.difficulty as 'EASY' | 'MEDIUM' | 'HARD') || 'MEDIUM',
                    topic: q.topic || null,
                })),
            },
        },
    })

    // 9. AuditLog entry
    await prisma.auditLog.create({
        data: {
            userId: ctx.userId,
            action: 'AI_GENERATE_FROM_DOC',
            metadata: {
                testId: test.id,
                fileName: file.name,
                fileSize: file.size,
                strategy: usedStrategy,
                extractedQuestionCandidates: extracted.candidateBlockCount,
                extractedQuestions: extracted.questions.length,
                questionsGenerated: result.questions.length,
                failedCount: result.failedCount || 0,
                generationTarget: usedStrategy === 'AI_GENERATED' ? generationTarget : null,
                costUSD: result.cost?.costUSD || 0,
            } as unknown as Prisma.InputJsonValue,
        },
    })

    // 10. Return response (file is NOT stored)
    return NextResponse.json({
        test: { id: test.id, title: testTitle },
        strategy: usedStrategy,
        extractedQuestions: extracted.questions.length,
        generationTarget: usedStrategy === 'AI_GENERATED' ? generationTarget : null,
        questionsGenerated: result.questions.length,
        failedCount: result.failedCount || 0,
        cost: result.cost,
    }, { status: 201 })
}

export const POST = withAuth(postHandler, ['TEACHER'])
