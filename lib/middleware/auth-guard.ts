import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { getSessionFromRequest } from '@/lib/session'
import { AppError } from '@/lib/middleware/error-handler'

const APP_ROLES = new Set<Role>(['ADMIN', 'SUB_ADMIN', 'STUDENT'])

function hasRequiredRole(sessionRole: Role, allowedRoles?: Role[]) {
    if (!allowedRoles) return true
    if (allowedRoles.includes(sessionRole)) return true

    return sessionRole === 'SUB_ADMIN' && allowedRoles.includes('ADMIN')
}

type Handler = (
    req: NextRequest,
    context: { userId: string; role: Role; params?: Record<string, string> }
) => Promise<NextResponse>

/**
 * Higher-Order Function that guards a route handler:
 * - Verifies access_token from cookie
 * - Checks that user role is in allowedRoles (if provided)
 * - Injects {userId, role} into handler context
 * - Catches errors and returns structured JSON (built-in error handling)
 *
 * Compatible with Next.js 16 where route params are a Promise.
 */
export function withAuth(handler: Handler, allowedRoles?: Role[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return async (req: NextRequest, routeContext?: any) => {
        try {
            const session = getSessionFromRequest(req)

            if (!session) {
                return NextResponse.json({ error: true, code: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 })
            }

            if (!APP_ROLES.has(session.role)) {
                return NextResponse.json({ error: true, code: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 })
            }

            if (!hasRequiredRole(session.role, allowedRoles)) {
                return NextResponse.json({ error: true, code: 'FORBIDDEN', message: 'Insufficient permissions' }, { status: 403 })
            }

            // Next.js 16: params is a Promise, earlier versions it's a plain object
            let params: Record<string, string> | undefined
            if (routeContext?.params) {
                params = routeContext.params instanceof Promise
                    ? await routeContext.params
                    : routeContext.params
            }

            return await handler(req, { userId: session.userId, role: session.role, params })
        } catch (err) {
            if (err instanceof AppError) {
                return NextResponse.json(
                    { error: true, code: err.code, message: err.message },
                    { status: err.statusCode }
                )
            }
            console.error(`[ERROR] ${req.method} ${req.nextUrl.pathname}:`, err)
            return NextResponse.json(
                { error: true, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
                { status: 500 }
            )
        }
    }
}
