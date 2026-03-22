import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { clearAuthCookies, destroySession, getSessionFromRequest } from '@/lib/session'
import { withErrorHandler } from '@/lib/middleware/error-handler'

const AUTHENTICATED_ROLES = new Set(['ADMIN', 'SUB_ADMIN', 'STUDENT'])

async function getSessionHandler(req: NextRequest): Promise<NextResponse> {
    const session = getSessionFromRequest(req)

    if (!session) {
        const response = NextResponse.json(
            { error: true, code: 'UNAUTHORIZED', message: 'Authentication required' },
            { status: 401 }
        )
        return clearAuthCookies(response)
    }

    const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            status: true,
        },
    })

    if (!user || user.status !== 'ACTIVE' || !AUTHENTICATED_ROLES.has(user.role)) {
        await destroySession(session.userId)
        const response = NextResponse.json(
            { error: true, code: 'UNAUTHORIZED', message: 'Authentication required' },
            { status: 401 }
        )
        return clearAuthCookies(response)
    }

    return NextResponse.json({
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role.toLowerCase(),
        },
    })
}

export const GET = withErrorHandler(getSessionHandler)
