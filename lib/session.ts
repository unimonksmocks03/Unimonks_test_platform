import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import {
    generateAccessToken,
    generateRefreshToken,
    verifyAccessToken,
    JWTPayload,
} from '@/lib/auth'

const SESSION_TTL = 24 * 60 * 60 // 24 hours in seconds
const APP_SESSION_ROLES = new Set<Role>(['ADMIN', 'SUB_ADMIN', 'STUDENT'])

function refreshKey(token: string) {
    return `refresh:${token}`
}

function userSessionsKey(userId: string) {
    return `user:sessions:${userId}`
}

/**
 * Create a new session: generate tokens, store refresh in Redis.
 * Also tracks the token in a per-user set for efficient logout.
 */
export async function createSession(userId: string, role: Role) {
    const accessToken = generateAccessToken(userId, role)
    const refreshToken = generateRefreshToken()

    // Store mapping refresh:token → userId + track in user's session set
    const pipeline = redis.pipeline()
    pipeline.set(refreshKey(refreshToken), userId, 'EX', SESSION_TTL)
    pipeline.sadd(userSessionsKey(userId), refreshToken)
    pipeline.expire(userSessionsKey(userId), SESSION_TTL)
    await pipeline.exec()

    return { accessToken, refreshToken }
}

/**
 * Rotate refresh token: old → delete, new pair → return.
 * Updates the per-user session set atomically.
 */
export async function refreshSession(
    oldRefreshToken: string
): Promise<{ accessToken: string; refreshToken: string; userId: string } | null> {
    const userId = await redis.get(refreshKey(oldRefreshToken))
    if (!userId) return null

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            role: true,
            status: true,
        },
    })

    if (!user || user.status !== 'ACTIVE' || !APP_SESSION_ROLES.has(user.role)) {
        const pipeline = redis.pipeline()
        pipeline.del(refreshKey(oldRefreshToken))
        pipeline.srem(userSessionsKey(userId), oldRefreshToken)
        await pipeline.exec()
        return null
    }

    const accessToken = generateAccessToken(userId, user.role)
    const refreshToken = generateRefreshToken()

    // Atomic: delete old, create new, update session set
    const pipeline = redis.pipeline()
    pipeline.del(refreshKey(oldRefreshToken))
    pipeline.set(refreshKey(refreshToken), userId, 'EX', SESSION_TTL)
    pipeline.srem(userSessionsKey(userId), oldRefreshToken)
    pipeline.sadd(userSessionsKey(userId), refreshToken)
    pipeline.expire(userSessionsKey(userId), SESSION_TTL)
    await pipeline.exec()

    return { accessToken, refreshToken, userId }
}

/**
 * Remove all refresh tokens for a user (used on logout).
 * Uses the per-user session set for O(1) lookup — no SCAN needed.
 */
export async function destroySession(userId: string) {
    const sessionSetKey = userSessionsKey(userId)
    const tokens = await redis.smembers(sessionSetKey)

    if (tokens.length > 0) {
        const pipeline = redis.pipeline()
        for (const token of tokens) {
            pipeline.del(refreshKey(token))
        }
        pipeline.del(sessionSetKey)
        pipeline.del(`role:${userId}`)
        await pipeline.exec()
    }
}

export const destroyAllSessions = destroySession

// Set httpOnly cookies on a response
export function setAuthCookies(
    response: NextResponse,
    accessToken: string,
    refreshToken: string
): NextResponse {
    const isProduction = process.env.NODE_ENV === 'production'

    response.cookies.set('access_token', accessToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        path: '/',
        maxAge: SESSION_TTL,
    })

    response.cookies.set('refresh_token', refreshToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        path: '/api/auth/refresh',
        maxAge: SESSION_TTL,
    })

    return response
}

// Clear auth cookies
export function clearAuthCookies(response: NextResponse): NextResponse {
    response.cookies.set('access_token', '', { maxAge: 0, path: '/' })
    response.cookies.set('refresh_token', '', { maxAge: 0, path: '/api/auth/refresh' })
    return response
}

// Read and verify session from request cookies
export function getSessionFromRequest(request: NextRequest): JWTPayload | null {
    const token = request.cookies.get('access_token')?.value
    if (!token) return null
    return verifyAccessToken(token)
}
