import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify, type JWTPayload as JosePayload } from 'jose'

interface JWTPayload extends JosePayload {
    userId: string
    role: string
}

type AppRole = 'ADMIN' | 'SUB_ADMIN' | 'STUDENT'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET!)
if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required')
}
const MAX_JSON_BODY = 100 * 1024 // 100KB

function normalizeOrigin(value: string | null | undefined) {
    if (!value) return null

    try {
        return new URL(value).origin
    } catch {
        return null
    }
}

function getAllowedOrigins(req: NextRequest) {
    const origins = new Set<string>()
    const configuredOrigin = normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000')
    const requestOrigin = normalizeOrigin(req.nextUrl.origin)
    const forwardedProto = req.headers.get('x-forwarded-proto')
    const forwardedHost = req.headers.get('x-forwarded-host')
    const forwardedOrigin = forwardedProto && forwardedHost
        ? normalizeOrigin(`${forwardedProto}://${forwardedHost}`)
        : null

    if (configuredOrigin) origins.add(configuredOrigin)
    if (requestOrigin) origins.add(requestOrigin)
    if (forwardedOrigin) origins.add(forwardedOrigin)

    return origins
}

async function verifyToken(token: string): Promise<JWTPayload | null> {
    try {
        const { payload } = await jwtVerify(token, JWT_SECRET)
        return payload as JWTPayload
    } catch {
        return null
    }
}

function withRequestId(response: NextResponse, requestId: string) {
    response.headers.set('x-request-id', requestId)
    return response
}

function nextWithHeaders(requestHeaders: Headers, requestId: string) {
    return withRequestId(
        NextResponse.next({
            request: { headers: requestHeaders },
        }),
        requestId
    )
}

const PUBLIC_ROUTES = ['/login', '/reset-password', '/forgot-password']

const ROLE_ROUTES: Record<string, AppRole[]> = {
    '/admin': ['ADMIN', 'SUB_ADMIN'],
    '/student': ['STUDENT'],
}

function isAppRole(role: string): role is AppRole {
    return role === 'ADMIN' || role === 'SUB_ADMIN' || role === 'STUDENT'
}

export async function proxy(req: NextRequest) {
    const { pathname } = req.nextUrl
    const requestId = req.headers.get('x-request-id') || crypto.randomUUID()
    const requestHeaders = new Headers(req.headers)
    requestHeaders.set('x-request-id', requestId)

    if (pathname.startsWith('/api/')) {
        const origin = req.headers.get('origin')
        if (process.env.NODE_ENV === 'production' && origin) {
            const normalizedOrigin = normalizeOrigin(origin)
            const allowedOrigins = getAllowedOrigins(req)

            if (!normalizedOrigin || !allowedOrigins.has(normalizedOrigin)) {
            return withRequestId(
                NextResponse.json(
                    { error: true, code: 'CORS_DENIED', message: 'Origin not allowed' },
                    { status: 403 }
                ),
                requestId
            )
            }
        }

        const contentType = req.headers.get('content-type') || ''
        const contentLength = parseInt(req.headers.get('content-length') || '0')
        if (contentType.includes('application/json') && contentLength > MAX_JSON_BODY) {
            return withRequestId(
                NextResponse.json(
                    { error: true, code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 100KB limit' },
                    { status: 413 }
                ),
                requestId
            )
        }
    }

    if (pathname.startsWith('/api/auth/') || pathname.startsWith('/api/webhooks/')) {
        return nextWithHeaders(requestHeaders, requestId)
    }

    if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
        return nextWithHeaders(requestHeaders, requestId)
    }

    const token = req.cookies.get('access_token')?.value
    const payload = token ? await verifyToken(token) : null

    if (!payload || !isAppRole(payload.role)) {
        return withRequestId(NextResponse.redirect(new URL('/login', req.url)), requestId)
    }

    requestHeaders.set('x-user-id', payload.userId)
    requestHeaders.set('x-user-role', payload.role)

    if (pathname.startsWith('/arena') || pathname.startsWith('/api/arena')) {
        return nextWithHeaders(requestHeaders, requestId)
    }

    for (const [prefix, requiredRoles] of Object.entries(ROLE_ROUTES)) {
        if (pathname.startsWith(prefix) || pathname.startsWith(`/api${prefix}`)) {
            if (!requiredRoles.includes(payload.role)) {
                if (pathname.startsWith('/api/')) {
                    return withRequestId(
                        NextResponse.json(
                            { error: true, code: 'FORBIDDEN', message: 'Access denied' },
                            { status: 403 }
                        ),
                        requestId
                    )
                }

                const dashboardMap: Record<string, string> = {
                    ADMIN: '/admin/dashboard',
                    SUB_ADMIN: '/admin/dashboard',
                    STUDENT: '/student/dashboard',
                }

                return withRequestId(
                    NextResponse.redirect(new URL(dashboardMap[payload.role] || '/login', req.url)),
                    requestId
                )
            }
            break
        }
    }

    return nextWithHeaders(requestHeaders, requestId)
}

export const config = {
    matcher: [
        '/admin/:path*',
        '/student/:path*',
        '/arena/:path*',
        '/api/admin/:path*',
        '/api/student/:path*',
        '/api/arena/:path*',
        '/api/webhooks/:path*',
    ],
}
