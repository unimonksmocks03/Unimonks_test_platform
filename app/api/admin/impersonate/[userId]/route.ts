import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
import { withAuth } from '@/lib/middleware/auth-guard'
import { prisma } from '@/lib/prisma'
import { createSession, setAuthCookies } from '@/lib/session'
import {
    setImpersonationContext,
    validateImpersonationTarget,
} from '@/lib/services/impersonation-service'
import { Role } from '@prisma/client'

// POST /api/admin/impersonate/[userId] — start impersonation
async function postHandler(
    req: NextRequest,
    ctx: { userId: string; role: Role; params?: Record<string, string> }
) {
    const targetUserId = ctx.params?.userId
    if (!targetUserId) {
        return NextResponse.json({ error: true, code: 'BAD_REQUEST', message: 'Target user ID required' }, { status: 400 })
    }

    if (targetUserId === ctx.userId) {
        return NextResponse.json({ error: true, code: 'BAD_REQUEST', message: 'Cannot impersonate yourself' }, { status: 400 })
    }

    const targetUser = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, name: true, email: true, role: true, status: true },
    })

    if (!targetUser) {
        return NextResponse.json({ error: true, code: 'NOT_FOUND', message: 'Target user not found' }, { status: 404 })
    }

    const guardResult = validateImpersonationTarget(
        { userId: ctx.userId, role: ctx.role },
        targetUser,
    )

    if (!guardResult.allowed) {
        return NextResponse.json(
            {
                error: true,
                code: guardResult.code,
                message: guardResult.message,
            },
            { status: guardResult.status },
        )
    }

    // Create new session as target user
    const { accessToken, refreshToken } = await createSession(targetUser.id, targetUser.role)

    // Audit log
    await prisma.auditLog.create({
        data: {
            userId: ctx.userId,
            action: 'IMPERSONATE_START',
            metadata: { targetUserId: targetUser.id, targetEmail: targetUser.email },
            ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
        },
    })

    const response = NextResponse.json({
        message: 'Impersonation started',
        user: targetUser,
        impersonating: true,
    })

    await setImpersonationContext(response, {
        originalUserId: ctx.userId,
        originalRole: ctx.role,
        impersonatedUserId: targetUser.id,
        impersonatedUserRole: targetUser.role,
    })
    setAuthCookies(response, accessToken, refreshToken)
    return response
}

export const POST = withAuth(postHandler, ['ADMIN'])
