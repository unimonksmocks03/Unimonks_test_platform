import crypto from 'node:crypto'

import { Role, UserStatus } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'

const IMPERSONATION_CONTEXT_TTL_SECONDS = 24 * 60 * 60

export const IMPERSONATION_CONTEXT_COOKIE_NAME = 'impersonation_context'

export type ImpersonationContextRecord = {
    originalUserId: string
    originalRole: Role
    impersonatedUserId: string
    impersonatedUserRole: Role
    createdAt: string
}

export type StoredImpersonationContext = ImpersonationContextRecord & {
    contextId: string
}

type ImpersonationTarget = {
    id: string
    role: Role
    status: UserStatus
}

type ImpersonationGuardResult =
    | {
        allowed: true
    }
    | {
        allowed: false
        status: number
        code: string
        message: string
    }

function impersonationContextKey(contextId: string) {
    return `impersonation:context:${contextId}`
}

export function validateImpersonationTarget(
    actor: { userId: string; role: Role },
    target: ImpersonationTarget,
): ImpersonationGuardResult {
    if (target.id === actor.userId) {
        return {
            allowed: false,
            status: 400,
            code: 'BAD_REQUEST',
            message: 'Cannot impersonate yourself',
        }
    }

    if (target.status !== 'ACTIVE') {
        return {
            allowed: false,
            status: 403,
            code: 'TARGET_USER_INACTIVE',
            message: 'Only active users can be impersonated',
        }
    }

    if (target.role === 'ADMIN') {
        return {
            allowed: false,
            status: 403,
            code: 'OWNER_ADMIN_PROTECTED',
            message: 'The primary admin account cannot be impersonated',
        }
    }

    if (actor.role === 'SUB_ADMIN' && target.role !== 'STUDENT') {
        return {
            allowed: false,
            status: 403,
            code: 'SUB_ADMIN_IMPERSONATION_FORBIDDEN',
            message: 'Sub-admins can only impersonate student accounts',
        }
    }

    return { allowed: true }
}

export async function setImpersonationContext(
    response: NextResponse,
    context: Omit<ImpersonationContextRecord, 'createdAt'>,
) {
    const { redis } = await import('@/lib/redis')
    const contextId = crypto.randomUUID()
    const record: ImpersonationContextRecord = {
        ...context,
        createdAt: new Date().toISOString(),
    }

    await redis.set(
        impersonationContextKey(contextId),
        JSON.stringify(record),
        'EX',
        IMPERSONATION_CONTEXT_TTL_SECONDS,
    )

    response.cookies.set(IMPERSONATION_CONTEXT_COOKIE_NAME, contextId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: IMPERSONATION_CONTEXT_TTL_SECONDS,
    })

    return contextId
}

export async function resolveImpersonationContext(request: NextRequest): Promise<StoredImpersonationContext | null> {
    const { redis } = await import('@/lib/redis')
    const contextId = request.cookies.get(IMPERSONATION_CONTEXT_COOKIE_NAME)?.value
    if (!contextId) {
        return null
    }

    const raw = await redis.get(impersonationContextKey(contextId))
    if (!raw) {
        return null
    }

    try {
        const parsed = JSON.parse(raw) as ImpersonationContextRecord

        if (
            typeof parsed.originalUserId !== 'string' ||
            typeof parsed.originalRole !== 'string' ||
            typeof parsed.impersonatedUserId !== 'string' ||
            typeof parsed.impersonatedUserRole !== 'string'
        ) {
            return null
        }

        return {
            contextId,
            ...parsed,
        }
    } catch {
        return null
    }
}

export function canUseImpersonationContext(context: StoredImpersonationContext, currentUserId: string) {
    return currentUserId === context.originalUserId || currentUserId === context.impersonatedUserId
}

export async function deleteImpersonationContext(contextId: string) {
    const { redis } = await import('@/lib/redis')
    await redis.del(impersonationContextKey(contextId))
}

export function clearImpersonationContextCookie(response: NextResponse) {
    response.cookies.set(IMPERSONATION_CONTEXT_COOKIE_NAME, '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 0,
    })

    return response
}
