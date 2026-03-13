import { redis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'

/**
 * Event Service — Redis List-based event delivery.
 *
 * Instead of Pub/Sub (which requires long-lived connections incompatible
 * with Vercel serverless), events are pushed to per-user Redis lists.
 *
 * Producers call `emitToUser()` → LPUSH to `events:{userId}` (TTL 5min)
 * Consumers call `GET /api/events/poll` → LRANGE + DEL to drain the list
 */

const EVENT_TTL_SECONDS = 300 // 5 minutes

// Event structure
export interface SSEEvent {
    type: string
    data: Record<string, unknown>
    timestamp: string
}

/**
 * Emit an event to a specific user via Redis list.
 * Events are stored in a per-user list with a 5-minute TTL.
 * The consumer (poll endpoint) drains the list atomically.
 */
export async function emitToUser(userId: string, event: Omit<SSEEvent, 'timestamp'>) {
    const key = `events:${userId}`
    const fullEvent: SSEEvent = {
        ...event,
        timestamp: new Date().toISOString(),
    }

    // LPUSH + EXPIRE in a pipeline for atomicity
    const pipeline = redis.pipeline()
    pipeline.lpush(key, JSON.stringify(fullEvent))
    pipeline.expire(key, EVENT_TTL_SECONDS)
    await pipeline.exec()
}

/**
 * Drain all pending events for a user.
 * Returns the events and deletes them from Redis atomically.
 */
export async function drainEvents(userId: string): Promise<SSEEvent[]> {
    const key = `events:${userId}`

    // LRANGE to get all, then DEL — use pipeline for speed
    const pipeline = redis.pipeline()
    pipeline.lrange(key, 0, -1)
    pipeline.del(key)
    const results = await pipeline.exec()

    if (!results || !results[0] || !results[0][1]) {
        return []
    }

    const rawEvents = results[0][1] as string[]
    return rawEvents
        .map(raw => {
            try { return JSON.parse(raw) as SSEEvent } catch { return null }
        })
        .filter((e): e is SSEEvent => e !== null)
        .reverse() // LPUSH stores newest first, reverse for chronological order
}

/**
 * Emit an event to all students in a batch.
 */
export async function emitToBatch(batchId: string, event: Omit<SSEEvent, 'timestamp'>) {
    const students = await prisma.batchStudent.findMany({
        where: { batchId },
        select: { studentId: true },
    })

    const promises = students.map(s => emitToUser(s.studentId, event))
    await Promise.allSettled(promises)
}
