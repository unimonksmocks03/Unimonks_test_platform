import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { generateOTP, hashOTP } from '@/lib/auth'
import { sendOTPEmail } from '@/lib/services/email-service'
import { SendOTPSchema } from '@/lib/validations/auth.schema'
import { AppError } from '@/lib/middleware/error-handler'
import { withErrorHandler } from '@/lib/middleware/error-handler'
import { sendOTPRateLimit } from '@/lib/middleware/rate-limiter'

const OTP_EXPIRY_MINUTES = 5
const GENERIC_SUCCESS_MESSAGE = 'If the email is registered and active, a login code has been sent.'
const AUTHENTICATED_ROLES = new Set(['ADMIN', 'SUB_ADMIN', 'STUDENT'])

async function sendOTPHandler(req: NextRequest): Promise<NextResponse> {
    const body = await req.json()
    const parsed = SendOTPSchema.safeParse(body)

    if (!parsed.success) {
        return NextResponse.json(
            { error: true, code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.issues },
            { status: 400 }
        )
    }

    const { email } = parsed.data

    const user = await prisma.user.findUnique({ where: { email } })

    if (!user || user.status !== 'ACTIVE' || !AUTHENTICATED_ROLES.has(user.role)) {
        return NextResponse.json({ message: GENERIC_SUCCESS_MESSAGE })
    }

    // Generate and store hashed OTP
    const otp = generateOTP()
    const hashedOTP = hashOTP(otp)
    const expiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)

    await prisma.user.update({
        where: { id: user.id },
        data: { otp: hashedOTP, otpExpiry: expiry },
    })

    const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'

    try {
        await sendOTPEmail(user.email, otp)
    } catch (err) {
        await prisma.user.update({
            where: { id: user.id },
            data: { otp: null, otpExpiry: null },
        })

        console.error('[WARN] Failed to send OTP email:', err)
        throw new AppError('Unable to send a login code right now. Please try again in a few minutes.', 503, 'OTP_DELIVERY_FAILED')
    }

    void prisma.auditLog.create({
            data: { userId: user.id, action: 'OTP_SENT', ipAddress },
        }).catch((err) => {
            console.error('[WARN] Failed to create audit log:', err)
        })

    return NextResponse.json({ message: GENERIC_SUCCESS_MESSAGE })
}

export const POST = sendOTPRateLimit(withErrorHandler(sendOTPHandler) as (req: NextRequest, ...args: unknown[]) => Promise<NextResponse>)
