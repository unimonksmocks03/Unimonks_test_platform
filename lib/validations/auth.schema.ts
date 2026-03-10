import { z } from 'zod'

export const SendOTPSchema = z.object({
    email: z.string().trim().email('Valid email is required'),
})

export const VerifyOTPSchema = z.object({
    email: z.string().trim().email('Valid email is required'),
    otp: z.string().length(6, 'OTP must be 6 digits').regex(/^\d{6}$/, 'OTP must be 6 digits'),
})

export type SendOTPInput = z.infer<typeof SendOTPSchema>
export type VerifyOTPInput = z.infer<typeof VerifyOTPSchema>
