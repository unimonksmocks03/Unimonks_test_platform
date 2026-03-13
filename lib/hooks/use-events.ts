'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { apiClient } from '@/lib/api-client'

interface SSEEvent {
    type: string
    data: Record<string, unknown>
    timestamp: string
}

interface UseEventsOptions {
    /** Enable or disable polling (default: true) */
    enabled?: boolean
    /** Polling interval in ms (default: 5000) */
    interval?: number
}

/**
 * React hook for consuming events via short polling.
 *
 * Replaces the previous EventSource (SSE) approach which was incompatible
 * with Vercel's serverless model. Instead, polls GET /api/events/poll
 * at a configurable interval.
 *
 * Usage:
 * ```tsx
 * const { connected, lastEvent } = useEvents((event) => {
 *   if (event.type === 'feedback:ready') {
 *     // Refresh results page
 *   }
 * })
 * ```
 */
export function useEvents(
    onEvent: (event: SSEEvent) => void,
    options: UseEventsOptions = {}
) {
    const { enabled = true, interval = 5000 } = options
    const [connected, setConnected] = useState(false)
    const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null)
    const intervalRef = useRef<NodeJS.Timeout | null>(null)
    const onEventRef = useRef(onEvent)

    // Keep callback ref up-to-date without re-triggering effect
    useEffect(() => {
        onEventRef.current = onEvent
    }, [onEvent])

    const poll = useCallback(async () => {
        try {
            const res = await apiClient.get<{ events: SSEEvent[] }>('/api/events/poll')
            if (res.ok && res.data.events.length > 0) {
                setConnected(true)
                for (const event of res.data.events) {
                    setLastEvent(event)
                    onEventRef.current(event)
                }
            } else if (res.ok) {
                setConnected(true)
            }
        } catch {
            setConnected(false)
        }
    }, [])

    useEffect(() => {
        if (!enabled) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setConnected(false)
            return
        }

        // Initial poll immediately
        poll()

        // Then poll at interval
        intervalRef.current = setInterval(poll, interval)

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current)
                intervalRef.current = null
            }
        }
    }, [enabled, interval, poll])

    return { connected, lastEvent }
}
