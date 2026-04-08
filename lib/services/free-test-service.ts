import { Prisma, SessionStatus } from '@prisma/client'

import {
    FREE_BATCH_KIND,
    MAX_FREE_TOTAL_ATTEMPTS,
    STANDARD_BATCH_KIND,
} from '@/lib/config/platform-policy'
import { prisma } from '@/lib/prisma'
import {
    calculateQuestionAttemptSummary,
    calculateTotalMarks,
    getCorrectOptionId,
    resolveTestSettings,
} from '@/lib/utils/test-settings'

const COMPLETED_SESSION_STATUSES: SessionStatus[] = ['SUBMITTED', 'TIMED_OUT', 'FORCE_SUBMITTED']
const SUBMISSION_GRACE_PERIOD_MS = 30 * 1000
const FREE_ATTEMPT_ALREADY_USED_MESSAGE =
    'You have already given this free mock and are out of attempts. Get enrolled to UNIMONKS to access the paid ones.'

type SafeQuestionOption = {
    id: string
    text: string
}

type AnswerEntry = {
    questionId: string
    optionId: string | null
    markedForReview?: boolean
    answeredAt: string
}

type FreeTestServiceErrorCode =
    | 'DEADLINE_PASSED'
    | 'FORBIDDEN'
    | 'FREE_ATTEMPT_ALREADY_USED'
    | 'LEAD_ACCESS_REQUIRED'
    | 'NOT_FOUND'
    | 'SESSION_ENDED'
    | 'SESSION_IN_PROGRESS'
    | 'TIMED_OUT'

export type FreeTestServiceError = {
    error: true
    code: FreeTestServiceErrorCode
    message: string
    details?: Record<string, unknown>
}

export type PublicMockCard = {
    id: string
    title: string
    description: string | null
    durationMinutes: number
    questionCount: number
    updatedAt: Date
}

export type PublicMockCatalog = {
    freeTests: PublicMockCard[]
    premiumTests: PublicMockCard[]
    policy: {
        maxFreeAttempts: number
    }
}

export type PublicLeadAttemptState =
    | {
        status: 'IN_PROGRESS'
        sessionId: string
        sessionStatus: SessionStatus
        serverDeadline: string
    }
    | {
        status: 'USED'
        sessionId: string
        sessionStatus: SessionStatus
        serverDeadline: string
        submittedAt: string | null
        score: number | null
        percentage: number | null
    }

export type PublicFreeTestDetail = {
    test: {
        id: string
        title: string
        description: string | null
        durationMinutes: number
        questionCount: number
        updatedAt: Date
    }
    leadAttempt: PublicLeadAttemptState | null
}

export type PublicFreeSessionPayload = {
    sessionId: string
    testId: string
    testTitle: string
    questions: Array<{
        id: string
        order: number
        stem: string
        sharedContext: string | null
        options: SafeQuestionOption[]
        difficulty: string
        topic: string | null
    }>
    answers: AnswerEntry[]
    serverDeadline: string
    durationMinutes: number
    resumed: boolean
}

export type PublicFreeResultPayload = {
    session: {
        id: string
        status: SessionStatus
        score: number
        totalMarks: number
        percentage: number
        submittedAt: string | null
        startedAt: string
        durationMinutes: number
    }
    test: {
        id: string
        title: string
        description: string | null
        questionCount: number
    }
    performance: {
        correctCount: number
        incorrectCount: number
        unansweredCount: number
        passingScore: number
        passed: boolean
    }
    questionReview: Array<{
        id: string
        order: number
        stem: string
        sharedContext: string | null
        difficulty: string
        topic: string | null
        explanation: string | null
        selectedOptionId: string | null
        correctOptionId: string | null
        isCorrect: boolean
        options: SafeQuestionOption[]
    }>
}

function serviceError(
    code: FreeTestServiceErrorCode,
    message: string,
    details?: Record<string, unknown>,
): FreeTestServiceError {
    return {
        error: true,
        code,
        message,
        details,
    }
}

function buildPublicFreeTestWhere(testId?: string): Prisma.TestWhereInput {
    return {
        ...(testId ? { id: testId } : {}),
        status: 'PUBLISHED',
        assignments: {
            some: {
                batch: {
                    is: {
                        kind: FREE_BATCH_KIND,
                    },
                },
            },
            none: {
                OR: [
                    { studentId: { not: null } },
                ],
            },
        },
    }
}

function buildPublicPremiumTestWhere(): Prisma.TestWhereInput {
    return {
        status: 'PUBLISHED',
        assignments: {
            some: {
                batch: {
                    is: {
                        kind: STANDARD_BATCH_KIND,
                    },
                },
            },
            none: {
                OR: [
                    { studentId: { not: null } },
                    {
                        batch: {
                            is: {
                                kind: FREE_BATCH_KIND,
                            },
                        },
                    },
                ],
            },
        },
    }
}

function readPassingScore(settings: unknown) {
    return resolveTestSettings(settings).passingScore
}

function shouldShuffleQuestions(settings: unknown) {
    return resolveTestSettings(settings).shuffleQuestions
}

function createSeededRandom(seed: string) {
    let hash = 2166136261

    for (let index = 0; index < seed.length; index += 1) {
        hash ^= seed.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }

    return () => {
        hash += 0x6d2b79f5
        let value = hash
        value = Math.imul(value ^ (value >>> 15), value | 1)
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
}

function shuffleArray<T>(input: T[], seed: string) {
    const shuffled = [...input]
    const random = createSeededRandom(seed)

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1))
        ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
    }

    return shuffled
}

function toSafeOptions(rawOptions: unknown): SafeQuestionOption[] {
    if (Array.isArray(rawOptions)) {
        return (rawOptions as Array<{ id: string; text: string }>).map((option) => ({
            id: option.id,
            text: option.text,
        }))
    }

    if (rawOptions && typeof rawOptions === 'object') {
        const optionMap = rawOptions as Record<string, string>
        return ['A', 'B', 'C', 'D']
            .filter((key) => key !== 'correct' && typeof optionMap[key] === 'string')
            .map((key) => ({
                id: key,
                text: optionMap[key],
            }))
    }

    return []
}

function stripCorrectAnswers(
    questions: Array<{
        id: string
        order: number
        stem: string
        sharedContext: string | null
        options: unknown
        difficulty: string
        topic: string | null
    }>,
    settings: unknown,
    sessionSeed?: string,
) {
    const sanitized = questions.map((question) => ({
        id: question.id,
        order: question.order,
        stem: question.stem,
        sharedContext: question.sharedContext,
        options: toSafeOptions(question.options),
        difficulty: question.difficulty,
        topic: question.topic,
    }))

    if (!shouldShuffleQuestions(settings) || !sessionSeed) {
        return sanitized
    }

    return shuffleArray(sanitized, sessionSeed).map((question, index) => ({
        ...question,
        order: index + 1,
    }))
}

function orderQuestionReviewForSession(
    questions: Array<{
        id: string
        order: number
        stem: string
        sharedContext: string | null
        options: Prisma.JsonValue
        difficulty: string
        topic: string | null
        explanation: string | null
    }>,
    settings: Prisma.JsonValue,
    sessionSeed: string,
) {
    if (!shouldShuffleQuestions(settings)) {
        return questions
    }

    return shuffleArray(questions, sessionSeed).map((question, index) => ({
        ...question,
        order: index + 1,
    }))
}

function mergeAnswerEntries(
    existing: AnswerEntry[],
    incoming: Array<{ questionId: string; optionId: string | null; markedForReview?: boolean; answeredAt?: string }>,
) {
    const merged = [...existing]

    for (const item of incoming) {
        const nextEntry: AnswerEntry = {
            questionId: item.questionId,
            optionId: item.optionId,
            markedForReview: item.markedForReview,
            answeredAt: item.answeredAt ?? new Date().toISOString(),
        }

        const incomingAnsweredAt = new Date(nextEntry.answeredAt).getTime()
        const existingIndex = merged.findIndex((entry) => entry.questionId === item.questionId)

        if (existingIndex === -1) {
            merged.push(nextEntry)
            continue
        }

        const currentAnsweredAt = new Date(merged[existingIndex].answeredAt).getTime()
        if (Number.isFinite(currentAnsweredAt) && currentAnsweredAt > incomingAnsweredAt) {
            continue
        }

        merged[existingIndex] = {
            ...merged[existingIndex],
            ...nextEntry,
        }
    }

    return merged
}

function toCatalogCard(test: {
    id: string
    title: string
    description: string | null
    durationMinutes: number
    updatedAt: Date
    _count: {
        questions: number
    }
}): PublicMockCard {
    return {
        id: test.id,
        title: test.title,
        description: test.description,
        durationMinutes: test.durationMinutes,
        questionCount: test._count.questions,
        updatedAt: test.updatedAt,
    }
}

function toLeadAttemptState(session: {
    id: string
    status: SessionStatus
    serverDeadline: Date
    submittedAt: Date | null
    score: number | null
    percentage: number | null
} | null): PublicLeadAttemptState | null {
    if (!session) {
        return null
    }

    const hasExpired = session.status === 'IN_PROGRESS' && session.serverDeadline.getTime() <= Date.now()

    if (session.status === 'IN_PROGRESS' && !hasExpired) {
        return {
            status: 'IN_PROGRESS',
            sessionId: session.id,
            sessionStatus: session.status,
            serverDeadline: session.serverDeadline.toISOString(),
        }
    }

    return {
        status: 'USED',
        sessionId: session.id,
        sessionStatus: hasExpired ? 'TIMED_OUT' : session.status,
        serverDeadline: session.serverDeadline.toISOString(),
        submittedAt: session.submittedAt?.toISOString() ?? null,
        score: session.score,
        percentage: session.percentage,
    }
}

function toResultPayload(session: {
    id: string
    status: SessionStatus
    startedAt: Date
    submittedAt: Date | null
    score: number | null
    totalMarks: number
    percentage: number | null
    answers: Prisma.JsonValue | null
    test: {
        id: string
        title: string
        description: string | null
        durationMinutes: number
        settings: Prisma.JsonValue
        questions: Array<{
            id: string
            order: number
            stem: string
            sharedContext: string | null
            options: Prisma.JsonValue
            difficulty: string
            topic: string | null
            explanation: string | null
        }>
    }
}): PublicFreeResultPayload {
    const answers = ((session.answers as AnswerEntry[] | null) ?? []).reduce<Record<string, AnswerEntry>>(
        (accumulator, answer) => {
            accumulator[answer.questionId] = answer
            return accumulator
        },
        {},
    )

    const orderedQuestions = orderQuestionReviewForSession(
        session.test.questions,
        session.test.settings,
        session.id,
    )

    const questionReview = orderedQuestions.map((question) => {
        const selectedOptionId = answers[question.id]?.optionId ?? null
        const correctOptionId = getCorrectOptionId(question.options)

        return {
            id: question.id,
            order: question.order,
            stem: question.stem,
            sharedContext: question.sharedContext,
            difficulty: question.difficulty,
            topic: question.topic,
            explanation: question.explanation,
            selectedOptionId,
            correctOptionId,
            isCorrect: selectedOptionId !== null && selectedOptionId === correctOptionId,
            options: toSafeOptions(question.options),
        }
    })

    const correctCount = questionReview.filter((question) => question.isCorrect).length
    const unansweredCount = questionReview.filter((question) => question.selectedOptionId === null).length
    const incorrectCount = questionReview.length - correctCount - unansweredCount
    const passingScore = readPassingScore(session.test.settings)
    const percentage = session.percentage ?? 0

    return {
        session: {
            id: session.id,
            status: session.status,
            score: session.score ?? 0,
            totalMarks: session.totalMarks,
            percentage,
            submittedAt: session.submittedAt?.toISOString() ?? null,
            startedAt: session.startedAt.toISOString(),
            durationMinutes: session.test.durationMinutes,
        },
        test: {
            id: session.test.id,
            title: session.test.title,
            description: session.test.description,
            questionCount: session.test.questions.length,
        },
        performance: {
            correctCount,
            incorrectCount,
            unansweredCount,
            passingScore,
            passed: percentage >= passingScore,
        },
        questionReview,
    }
}

export async function listPublicMockCatalog(): Promise<PublicMockCatalog> {
    const [freeTests, premiumTests] = await Promise.all([
        prisma.test.findMany({
            where: buildPublicFreeTestWhere(),
            select: {
                id: true,
                title: true,
                description: true,
                durationMinutes: true,
                updatedAt: true,
                _count: {
                    select: {
                        questions: true,
                    },
                },
            },
            orderBy: [
                { updatedAt: 'desc' },
                { createdAt: 'desc' },
            ],
        }),
        prisma.test.findMany({
            where: buildPublicPremiumTestWhere(),
            select: {
                id: true,
                title: true,
                description: true,
                durationMinutes: true,
                updatedAt: true,
                _count: {
                    select: {
                        questions: true,
                    },
                },
            },
            orderBy: [
                { updatedAt: 'desc' },
                { createdAt: 'desc' },
            ],
            take: 6,
        }),
    ])

    return {
        freeTests: freeTests.map(toCatalogCard),
        premiumTests: premiumTests.map(toCatalogCard),
        policy: {
            maxFreeAttempts: MAX_FREE_TOTAL_ATTEMPTS,
        },
    }
}

export async function listPublicFreeTestsForSitemap() {
    const tests = await prisma.test.findMany({
        where: buildPublicFreeTestWhere(),
        select: {
            id: true,
            updatedAt: true,
        },
    })

    return tests
}

export async function getPublicFreeTestIdentity(testId: string) {
    return prisma.test.findFirst({
        where: buildPublicFreeTestWhere(testId),
        select: {
            id: true,
            title: true,
        },
    })
}

export async function getPublicFreeTestDetail(
    testId: string,
    leadId?: string | null,
): Promise<PublicFreeTestDetail | FreeTestServiceError> {
    const [test, leadSession] = await Promise.all([
        prisma.test.findFirst({
            where: buildPublicFreeTestWhere(testId),
            select: {
                id: true,
                title: true,
                description: true,
                durationMinutes: true,
                updatedAt: true,
                _count: {
                    select: {
                        questions: true,
                    },
                },
            },
        }),
        leadId
            ? prisma.leadTestSession.findUnique({
                where: {
                    testId_leadId: {
                        testId,
                        leadId,
                    },
                },
                select: {
                    id: true,
                    status: true,
                    serverDeadline: true,
                    submittedAt: true,
                    score: true,
                    percentage: true,
                },
            })
            : Promise.resolve(null),
    ])

    if (!test) {
        return serviceError('NOT_FOUND', 'This free mock is not available.')
    }

    return {
        test: {
            id: test.id,
            title: test.title,
            description: test.description,
            durationMinutes: test.durationMinutes,
            questionCount: test._count.questions,
            updatedAt: test.updatedAt,
        },
        leadAttempt: toLeadAttemptState(leadSession),
    }
}

export async function startPublicFreeTestSession(
    leadId: string,
    testId: string,
): Promise<PublicFreeSessionPayload | FreeTestServiceError> {
    return prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
            'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
            leadId,
            testId,
        )

        const test = await tx.test.findFirst({
            where: buildPublicFreeTestWhere(testId),
            select: {
                id: true,
                title: true,
                durationMinutes: true,
                settings: true,
                questions: {
                    orderBy: {
                        order: 'asc',
                    },
                    select: {
                        id: true,
                        order: true,
                        stem: true,
                        sharedContext: true,
                        options: true,
                        difficulty: true,
                        topic: true,
                    },
                },
            },
        })

        if (!test) {
            return serviceError('NOT_FOUND', 'This free mock is not available.')
        }

        const existingSession = await tx.leadTestSession.findUnique({
            where: {
                testId_leadId: {
                    testId,
                    leadId,
                },
            },
        })

        if (existingSession) {
            if (existingSession.status === 'IN_PROGRESS') {
                if (existingSession.serverDeadline.getTime() <= Date.now()) {
                    const timedOutResult = await submitLeadSessionWithTransaction(
                        tx,
                        leadId,
                        existingSession.id,
                        true,
                    )

                    return serviceError(
                        'FREE_ATTEMPT_ALREADY_USED',
                        FREE_ATTEMPT_ALREADY_USED_MESSAGE,
                        {
                            sessionId: existingSession.id,
                            status: 'error' in timedOutResult
                                ? existingSession.status
                                : timedOutResult.status,
                        },
                    )
                }

                return {
                    sessionId: existingSession.id,
                    testId: test.id,
                    testTitle: test.title,
                    questions: stripCorrectAnswers(test.questions, test.settings, existingSession.id),
                    answers: (existingSession.answers as AnswerEntry[] | null) ?? [],
                    serverDeadline: existingSession.serverDeadline.toISOString(),
                    durationMinutes: test.durationMinutes,
                    resumed: true,
                }
            }

            return serviceError(
                'FREE_ATTEMPT_ALREADY_USED',
                FREE_ATTEMPT_ALREADY_USED_MESSAGE,
                {
                    sessionId: existingSession.id,
                    status: existingSession.status,
                },
            )
        }

        const now = new Date()
        const serverDeadline = new Date(now.getTime() + test.durationMinutes * 60 * 1000)

        const session = await tx.leadTestSession.create({
            data: {
                testId: test.id,
                leadId,
                status: 'IN_PROGRESS',
                startedAt: now,
                serverDeadline,
                answers: [] as Prisma.InputJsonValue,
                totalMarks: calculateTotalMarks(test.questions.length, test.settings),
            },
        })

        return {
            sessionId: session.id,
            testId: test.id,
            testTitle: test.title,
            questions: stripCorrectAnswers(test.questions, test.settings, session.id),
            answers: [],
            serverDeadline: serverDeadline.toISOString(),
            durationMinutes: test.durationMinutes,
            resumed: false,
        }
    })
}

export async function getPublicFreeSession(
    leadId: string,
    sessionId: string,
): Promise<PublicFreeSessionPayload | FreeTestServiceError> {
    const session = await prisma.leadTestSession.findUnique({
        where: {
            id: sessionId,
        },
        select: {
            id: true,
            leadId: true,
            status: true,
            answers: true,
            serverDeadline: true,
            test: {
                select: {
                    id: true,
                    title: true,
                    durationMinutes: true,
                    settings: true,
                    questions: {
                        orderBy: {
                            order: 'asc',
                        },
                        select: {
                            id: true,
                            order: true,
                            stem: true,
                            sharedContext: true,
                            options: true,
                            difficulty: true,
                            topic: true,
                        },
                    },
                },
            },
        },
    })

    if (!session) {
        return serviceError('NOT_FOUND', 'Free mock session not found.')
    }

    if (session.leadId !== leadId) {
        return serviceError('FORBIDDEN', 'Access denied.')
    }

    if (session.status !== 'IN_PROGRESS') {
        return serviceError('SESSION_ENDED', 'This free mock attempt has already ended.', {
            sessionId: session.id,
            status: session.status,
        })
    }

    if (session.serverDeadline.getTime() <= Date.now()) {
        await submitPublicFreeTest(leadId, session.id, true)

        return serviceError('TIMED_OUT', 'This free mock attempt has already ended.', {
            sessionId: session.id,
            status: 'TIMED_OUT',
        })
    }

    return {
        sessionId: session.id,
        testId: session.test.id,
        testTitle: session.test.title,
        questions: stripCorrectAnswers(session.test.questions, session.test.settings, session.id),
        answers: (session.answers as AnswerEntry[] | null) ?? [],
        serverDeadline: session.serverDeadline.toISOString(),
        durationMinutes: session.test.durationMinutes,
        resumed: true,
    }
}

export async function savePublicFreeBatchAnswers(
    leadId: string,
    sessionId: string,
    incomingAnswers: Array<{ questionId: string; optionId: string | null; markedForReview?: boolean; answeredAt?: string }>,
) {
    return prisma.$transaction(async (tx) => {
        const lockedSession = await tx.$queryRawUnsafe<Array<{
            id: string
            leadId: string
            status: SessionStatus
            serverDeadline: Date
            answers: Prisma.JsonValue | null
            test: {
                _count: {
                    questions: number
                }
            }
        }>>(
            `SELECT "LeadTestSession".id,
                    "LeadTestSession"."leadId",
                    "LeadTestSession".status,
                    "LeadTestSession"."serverDeadline",
                    "LeadTestSession".answers
             FROM "LeadTestSession"
             WHERE "LeadTestSession".id = $1
             FOR UPDATE`,
            sessionId,
        )

        const session = lockedSession[0]

        if (!session) {
            return serviceError('NOT_FOUND', 'Free mock session not found.')
        }

        if (session.leadId !== leadId) {
            return serviceError('FORBIDDEN', 'Access denied.')
        }

        if (session.status !== 'IN_PROGRESS') {
            return serviceError('SESSION_ENDED', 'This free mock attempt has already ended.')
        }

        if (new Date(session.serverDeadline).getTime() < Date.now()) {
            return serviceError('DEADLINE_PASSED', 'Time is up for this free mock.')
        }

        const mergedAnswers = mergeAnswerEntries(
            (session.answers as AnswerEntry[] | null) ?? [],
            incomingAnswers,
        )

        await tx.leadTestSession.update({
            where: {
                id: sessionId,
            },
            data: {
                answers: mergedAnswers as Prisma.InputJsonValue,
            },
        })

        return {
            saved: true,
            answeredCount: mergedAnswers.filter((answer) => answer.optionId !== null).length,
            syncedCount: incomingAnswers.length,
        }
    })
}

export async function getPublicFreeSessionStatus(
    leadId: string,
    sessionId: string,
) {
    const session = await prisma.leadTestSession.findUnique({
        where: {
            id: sessionId,
        },
        select: {
            id: true,
            leadId: true,
            status: true,
            serverDeadline: true,
            answers: true,
            test: {
                select: {
                    _count: {
                        select: {
                            questions: true,
                        },
                    },
                },
            },
        },
    })

    if (!session) {
        return serviceError('NOT_FOUND', 'Free mock session not found.')
    }

    if (session.leadId !== leadId) {
        return serviceError('FORBIDDEN', 'Access denied.')
    }

    const answers = (session.answers as AnswerEntry[] | null) ?? []
    const timeRemaining = Math.max(
        0,
        Math.floor((session.serverDeadline.getTime() - Date.now()) / 1000),
    )

    return {
        timeRemaining,
        answeredCount: answers.filter((answer) => answer.optionId !== null).length,
        totalQuestions: session.test._count.questions,
        status: session.status,
    }
}

async function submitLeadSessionWithTransaction(
    tx: Prisma.TransactionClient,
    leadId: string,
    sessionId: string,
    force = false,
    incomingAnswers?: Array<{ questionId: string; optionId: string | null; markedForReview?: boolean; answeredAt?: string }>,
) {
    const lockedSession = await tx.$queryRawUnsafe<Array<{
        id: string
        leadId: string
        testId: string
        status: SessionStatus
        startedAt: Date
        serverDeadline: Date
        answers: Prisma.JsonValue | null
    }>>(
        `SELECT id,
                "leadId",
                "testId",
                status,
                "startedAt",
                "serverDeadline",
                answers
         FROM "LeadTestSession"
         WHERE id = $1
         FOR UPDATE`,
        sessionId,
    )

    const session = lockedSession[0]

    if (!session) {
        return serviceError('NOT_FOUND', 'Free mock session not found.')
    }

    if (session.leadId !== leadId) {
        return serviceError('FORBIDDEN', 'Access denied.')
    }

    if (session.status !== 'IN_PROGRESS') {
        return serviceError('SESSION_ENDED', 'This free mock attempt has already ended.', {
            sessionId,
            status: session.status,
        })
    }

    if (!force && new Date(session.serverDeadline).getTime() + SUBMISSION_GRACE_PERIOD_MS < Date.now()) {
        return serviceError('DEADLINE_PASSED', 'Time is up for this free mock.', {
            sessionId,
        })
    }

    const test = await tx.test.findUnique({
        where: {
            id: session.testId,
        },
        select: {
            id: true,
            title: true,
            description: true,
            durationMinutes: true,
            settings: true,
            questions: {
                orderBy: {
                    order: 'asc',
                },
                select: {
                    id: true,
                    order: true,
                    stem: true,
                    sharedContext: true,
                    options: true,
                    difficulty: true,
                    topic: true,
                    explanation: true,
                },
            },
        },
    })

    if (!test) {
        return serviceError('NOT_FOUND', 'This free mock is not available.')
    }

    const answers = mergeAnswerEntries(
        (session.answers as AnswerEntry[] | null) ?? [],
        incomingAnswers ?? [],
    )

    const {
        score,
        totalMarks,
        percentage,
    } = calculateQuestionAttemptSummary(test.questions, answers, test.settings)
    const submittedAt = new Date()
    const nextStatus: SessionStatus = force
        ? (new Date(session.serverDeadline).getTime() < Date.now() ? 'TIMED_OUT' : 'FORCE_SUBMITTED')
        : 'SUBMITTED'

    await tx.leadTestSession.update({
        where: {
            id: sessionId,
        },
        data: {
            status: nextStatus,
            submittedAt,
            score,
            totalMarks,
            percentage,
            answers: answers as Prisma.InputJsonValue,
        },
    })

    return {
        score,
        totalMarks,
        percentage,
        timeTaken: Math.floor((submittedAt.getTime() - new Date(session.startedAt).getTime()) / 1000),
        status: nextStatus,
    }
}

export async function submitPublicFreeTest(
    leadId: string,
    sessionId: string,
    force = false,
    incomingAnswers?: Array<{ questionId: string; optionId: string | null; markedForReview?: boolean; answeredAt?: string }>,
) {
    return prisma.$transaction((tx) =>
        submitLeadSessionWithTransaction(tx, leadId, sessionId, force, incomingAnswers),
    )
}

export async function getPublicFreeResult(
    leadId: string,
    sessionId: string,
): Promise<PublicFreeResultPayload | FreeTestServiceError> {
    let session = await prisma.leadTestSession.findUnique({
        where: {
            id: sessionId,
        },
        select: {
            id: true,
            leadId: true,
            status: true,
            startedAt: true,
            submittedAt: true,
            score: true,
            totalMarks: true,
            percentage: true,
            serverDeadline: true,
            answers: true,
            test: {
                select: {
                    id: true,
                    title: true,
                    description: true,
                    durationMinutes: true,
                    settings: true,
                    questions: {
                        orderBy: {
                            order: 'asc',
                        },
                        select: {
                            id: true,
                            order: true,
                            stem: true,
                            sharedContext: true,
                            options: true,
                            difficulty: true,
                            topic: true,
                            explanation: true,
                        },
                    },
                },
            },
        },
    })

    if (!session) {
        return serviceError('NOT_FOUND', 'Free mock result not found.')
    }

    if (session.leadId !== leadId) {
        return serviceError('FORBIDDEN', 'Access denied.')
    }

    if (session.status === 'IN_PROGRESS') {
        if (session.serverDeadline.getTime() > Date.now()) {
            return serviceError('SESSION_IN_PROGRESS', 'Finish the free mock before viewing the result.', {
                sessionId,
            })
        }

        const submitResult = await submitPublicFreeTest(leadId, sessionId, true)

        if ('error' in submitResult) {
            return submitResult
        }

        session = await prisma.leadTestSession.findUnique({
            where: {
                id: sessionId,
            },
            select: {
                id: true,
                leadId: true,
                status: true,
                startedAt: true,
                submittedAt: true,
                score: true,
                totalMarks: true,
                percentage: true,
                serverDeadline: true,
                answers: true,
                test: {
                    select: {
                        id: true,
                        title: true,
                        description: true,
                        durationMinutes: true,
                        settings: true,
                        questions: {
                            orderBy: {
                                order: 'asc',
                            },
                            select: {
                                id: true,
                                order: true,
                                stem: true,
                                sharedContext: true,
                                options: true,
                                difficulty: true,
                                topic: true,
                                explanation: true,
                            },
                        },
                    },
                },
            },
        })

        if (!session) {
            return serviceError('NOT_FOUND', 'Free mock result not found.')
        }
    }

    if (!COMPLETED_SESSION_STATUSES.includes(session.status)) {
        return serviceError('TIMED_OUT', 'This free mock result is not available yet.')
    }

    return toResultPayload(session)
}
