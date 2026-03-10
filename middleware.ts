import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify, type JWTPayload as JosePayload } from 'jose'

interface JWTPayload extends JosePayload {
    userId: string
    role: 'ADMIN' | 'TEACHER' | 'STUDENT'
}

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret')
const ALLOWED_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const MAX_JSON_BODY = 100 * 1024 // 100KB

async function verifyToken(token: string): Promise<JWTPayload | null> {
    try {
        const { payload } = await jwtVerify(token, JWT_SECRET)
        return payload as JWTPayload
    } catch {
        return null
    }
}

// Routes that don't require authentication
const PUBLIC_ROUTES = ['/login', '/reset-password', '/forgot-password']

// Role → protected path prefix mapping
const ROLE_ROUTES: Record<string, 'ADMIN' | 'TEACHER' | 'STUDENT'> = {
    '/admin': 'ADMIN',
    '/teacher': 'TEACHER',
    '/student': 'STUDENT',
}

export async function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl

    // CORS enforcement for API routes
    if (pathname.startsWith('/api/')) {
        const origin = req.headers.get('origin')
        // In production, strictly enforce origin
        if (process.env.NODE_ENV === 'production' && origin && origin !== ALLOWED_ORIGIN) {
            return NextResponse.json(
                { error: true, code: 'CORS_DENIED', message: 'Origin not allowed' },
                { status: 403 }
            )
        }

        // Request body size limit for non-file-upload JSON endpoints
        const contentType = req.headers.get('content-type') || ''
        const contentLength = parseInt(req.headers.get('content-length') || '0')
        if (contentType.includes('application/json') && contentLength > MAX_JSON_BODY) {
            return NextResponse.json(
                { error: true, code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 100KB limit' },
                { status: 413 }
            )
        }
    }

    // Allow auth API routes publicly
    if (pathname.startsWith('/api/auth/')) {
        return NextResponse.next()
    }

    // Allow public page routes
    if (PUBLIC_ROUTES.some((r) => pathname.startsWith(r))) {
        return NextResponse.next()
    }

    // Read and verify access token from cookie
    const token = req.cookies.get('access_token')?.value
    const payload = token ? await verifyToken(token) : null

    // Unauthenticated: redirect to /login
    if (!payload) {
        const loginUrl = new URL('/login', req.url)
        return NextResponse.redirect(loginUrl)
    }

    // Arena is accessible to any authenticated user
    if (pathname.startsWith('/arena') || pathname.startsWith('/api/arena')) {
        const requestHeaders = new Headers(req.headers)
        requestHeaders.set('x-user-id', payload.userId)
        requestHeaders.set('x-user-role', payload.role)
        return NextResponse.next({ request: { headers: requestHeaders } })
    }

    // Role-based route enforcement
    for (const [prefix, requiredRole] of Object.entries(ROLE_ROUTES)) {
        if (pathname.startsWith(prefix) || pathname.startsWith(`/api${prefix}`)) {
            if (payload.role !== requiredRole) {
                // API routes: return 403 JSON
                if (pathname.startsWith('/api/')) {
                    return NextResponse.json(
                        { error: true, code: 'FORBIDDEN', message: 'Access denied' },
                        { status: 403 }
                    )
                }
                // Page routes: redirect to their own dashboard
                const dashboardMap: Record<string, string> = {
                    ADMIN: '/admin/dashboard',
                    TEACHER: '/teacher/dashboard',
                    STUDENT: '/student/dashboard',
                }
                return NextResponse.redirect(new URL(dashboardMap[payload.role] || '/login', req.url))
            }
            break
        }
    }

    // Inject user info as headers for downstream API route handlers
    const requestHeaders = new Headers(req.headers)
    requestHeaders.set('x-user-id', payload.userId)
    requestHeaders.set('x-user-role', payload.role)

    return NextResponse.next({
        request: { headers: requestHeaders },
    })
}

export const config = {
    matcher: [
        '/admin/:path*',
        '/teacher/:path*',
        '/student/:path*',
        '/arena/:path*',
        '/api/admin/:path*',
        '/api/teacher/:path*',
        '/api/student/:path*',
        '/api/arena/:path*',
    ],
}
