import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
import { withAuth } from '@/lib/middleware/auth-guard'
import { prisma } from '@/lib/prisma'
import { createSession, setAuthCookies } from '@/lib/session'
import {
    canUseImpersonationContext,
    clearImpersonationContextCookie,
    deleteImpersonationContext,
    resolveImpersonationContext,
} from '@/lib/services/impersonation-service'
import { Role } from '@prisma/client'

// POST /api/admin/stop-impersonation — restore original admin session
async function postHandler(req: NextRequest, ctx: { userId: string; role: Role }) {
    const context = await resolveImpersonationContext(req)

    if (!context) {
        const response = NextResponse.json(
            { error: true, code: 'NOT_IMPERSONATING', message: 'No active impersonation session found' },
            { status: 400 }
        )

        return clearImpersonationContextCookie(response)
    }

    if (!canUseImpersonationContext(context, ctx.userId)) {
        const response = NextResponse.json(
            { error: true, code: 'FORBIDDEN', message: 'This impersonation session does not belong to the current user' },
            { status: 403 },
        )

        return clearImpersonationContextCookie(response)
    }

    // Restore admin session
    const { accessToken, refreshToken } = await createSession(context.originalUserId, context.originalRole)

    const admin = await prisma.user.findUnique({
        where: { id: context.originalUserId },
        select: { id: true, name: true, email: true, role: true },
    })

    await deleteImpersonationContext(context.contextId)

    // Audit log
    await prisma.auditLog.create({
        data: {
            userId: context.originalUserId,
            action: 'IMPERSONATE_END',
            metadata: JSON.parse(JSON.stringify({ impersonatedUserId: context.impersonatedUserId })),
            ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
        },
    })

    const response = NextResponse.json({
        message: 'Impersonation ended',
        user: admin,
    })

    setAuthCookies(response, accessToken, refreshToken)
    return clearImpersonationContextCookie(response)
}

// Any authenticated user can stop impersonation
// (they may be authenticated as the impersonated user)
export const POST = withAuth(postHandler)
