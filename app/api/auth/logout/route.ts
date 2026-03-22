import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { destroySession, clearAuthCookies, getSessionFromRequest } from '@/lib/session'
import { withErrorHandler } from '@/lib/middleware/error-handler'
import {
    clearImpersonationContextCookie,
    deleteImpersonationContext,
    resolveImpersonationContext,
} from '@/lib/services/impersonation-service'

async function logoutHandler(req: NextRequest): Promise<NextResponse> {
    const session = getSessionFromRequest(req)
    const impersonationContext = await resolveImpersonationContext(req)

    if (session) {
        await destroySession(session.userId)

        // Audit log
        await prisma.auditLog.create({
            data: {
                userId: session.userId,
                action: 'LOGOUT',
                ipAddress: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
            },
        })
    }

    const response = NextResponse.json({ message: 'Logged out successfully' })
    if (impersonationContext) {
        await deleteImpersonationContext(impersonationContext.contextId)
    }

    clearImpersonationContextCookie(response)
    return clearAuthCookies(response)
}

export const POST = withErrorHandler(logoutHandler)
