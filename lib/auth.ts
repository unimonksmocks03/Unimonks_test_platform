import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { Role } from '@prisma/client'
import { getAuthEnv } from '@/lib/env'

const authEnv = getAuthEnv()
const JWT_SECRET = authEnv.JWT_SECRET
const ACCESS_TOKEN_EXPIRY = '24h' // 24 hours for OTP-based session

export interface JWTPayload {
    userId: string
    role: Role
    iat?: number
    exp?: number
}

// Generate a 6-digit numeric OTP
export function generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString()
}

// Hash OTP for DB storage (SHA-256 is fine for short-lived 6-digit codes and avoids bcrypt slowness)
export function hashOTP(otp: string): string {
    return crypto.createHash('sha256').update(otp).digest('hex')
}

// Verify OTP
export function verifyOTP(otp: string, hash: string): boolean {
    return hashOTP(otp) === hash
}

// Access Token (24 hours)
export function generateAccessToken(userId: string, role: Role): string {
    return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY })
}

// Refresh Token (opaque UUID — stored in Redis)
export function generateRefreshToken(): string {
    return crypto.randomUUID()
}

// Verify and decode access token. Returns null on failure.
export function verifyAccessToken(token: string): JWTPayload | null {
    try {
        return jwt.verify(token, JWT_SECRET) as JWTPayload
    } catch {
        return null
    }
}
