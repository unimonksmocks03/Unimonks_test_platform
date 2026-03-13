import { prisma } from '@/lib/prisma'
import { enqueueAIFeedback } from '@/lib/queue/qstash'
import { submitTest } from '@/lib/services/submission-service'

const RECONCILIATION_LIMIT = 100

export async function reconcileSessionsAndFeedback(limit = RECONCILIATION_LIMIT) {
    const now = new Date()

    const expiredSessions = await prisma.testSession.findMany({
        where: {
            status: 'IN_PROGRESS',
            serverDeadline: { lt: now },
        },
        select: {
            id: true,
            studentId: true,
        },
        orderBy: { serverDeadline: 'asc' },
        take: limit,
    })

    let forceSubmitted = 0
    let forceSubmitFailures = 0

    for (const session of expiredSessions) {
        try {
            const result = await submitTest(session.studentId, session.id, true)
            if ('error' in result && result.error) {
                forceSubmitFailures++
            } else {
                forceSubmitted++
            }
        } catch {
            forceSubmitFailures++
        }
    }

    const sessionsMissingFeedback = await prisma.testSession.findMany({
        where: {
            status: { in: ['SUBMITTED', 'TIMED_OUT', 'FORCE_SUBMITTED'] },
            submittedAt: { not: null },
            aiFeedback: { is: null },
        },
        select: {
            id: true,
        },
        orderBy: { submittedAt: 'asc' },
        take: limit,
    })

    let feedbackEnqueued = 0
    let feedbackEnqueueFailures = 0

    for (const session of sessionsMissingFeedback) {
        try {
            await enqueueAIFeedback(session.id)
            feedbackEnqueued++
        } catch {
            feedbackEnqueueFailures++
        }
    }

    return {
        checkedExpiredSessions: expiredSessions.length,
        forceSubmitted,
        forceSubmitFailures,
        checkedFeedbackSessions: sessionsMissingFeedback.length,
        feedbackEnqueued,
        feedbackEnqueueFailures,
    }
}
