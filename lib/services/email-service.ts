import * as nodemailer from 'nodemailer'
import { getAppEnv, getEmailEnv } from '@/lib/env'

const APP_NAME = 'Unimonk'

function getTransporter() {
  const { gmailUser, gmailAppPassword } = getEmailEnv()

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailAppPassword,
    },
  })
}

export async function sendOTPEmail(to: string, otp: string): Promise<void> {
  const emailEnv = getEmailEnv()

  if (process.env.NODE_ENV !== 'production' && emailEnv.enableDevOtpLogs) {
    console.log(`\n=============================\n[DEV] OTP for ${to}: ${otp}\n=============================\n`)
  }

  await getTransporter().sendMail({
    from: `"${APP_NAME}" <${emailEnv.gmailUser}>`,
    to,
    subject: `${otp} is your ${APP_NAME} login code`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
        <div style="background: linear-gradient(135deg, #6C63FF 0%, #4F46E5 100%); padding: 40px 32px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700;">${APP_NAME}</h1>
          <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Test Platform</p>
        </div>
        <div style="padding: 40px 32px; background: #ffffff;">
          <h2 style="color: #1a1a2e; font-size: 22px; margin: 0 0 16px;">Your Login Code</h2>
          <p style="color: #555; line-height: 1.6; margin: 0 0 24px;">
            Enter the following code to sign in to your ${APP_NAME} account. This code will expire in <strong>5 minutes</strong>.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <div style="display: inline-block; background: #f8f7ff; border: 2px solid #e8e5ff; border-radius: 12px; padding: 20px 40px;">
              <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #4F46E5; font-family: monospace;">${otp}</span>
            </div>
          </div>
          <p style="color: #888; font-size: 13px; line-height: 1.6; margin: 24px 0 0;">
            If you didn't request this code, you can safely ignore this email. Someone may have entered your email by mistake.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
          <p style="color: #bbb; font-size: 12px; margin: 0; text-align: center;">
            ${APP_NAME} · Secure Test Platform
          </p>
        </div>
      </div>
    `,
  })
}

export async function sendWelcomeEmail(to: string, name: string): Promise<void> {
  const emailEnv = getEmailEnv()
  const loginUrl = `${getAppEnv().NEXT_PUBLIC_APP_URL}/login`

  await getTransporter().sendMail({
    from: `"${APP_NAME}" <${emailEnv.gmailUser}>`,
    to,
    subject: `Welcome to ${APP_NAME} — Your account is ready`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
        <div style="background: linear-gradient(135deg, #6C63FF 0%, #4F46E5 100%); padding: 40px 32px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700;">${APP_NAME}</h1>
          <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Test Platform</p>
        </div>
        <div style="padding: 40px 32px; background: #ffffff;">
          <h2 style="color: #1a1a2e; font-size: 22px; margin: 0 0 16px;">Welcome, ${name}! 👋</h2>
          <p style="color: #555; line-height: 1.6; margin: 0 0 24px;">
            Your ${APP_NAME} account has been created by your administrator. You can log in using your email address — we'll send you a one-time code each time you sign in. No password needed!
          </p>
          <div style="background: #f8f7ff; border: 1px solid #e8e5ff; border-radius: 8px; padding: 20px 24px; margin: 24px 0;">
            <p style="margin: 0 0 8px; color: #555; font-size: 14px;"><strong>Email:</strong> ${to}</p>
            <p style="margin: 0; color: #555; font-size: 14px;"><strong>Login Method:</strong> Email OTP (one-time passcode)</p>
          </div>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${loginUrl}" style="display: inline-block; background: linear-gradient(135deg, #6C63FF 0%, #4F46E5 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Log In Now
            </a>
          </div>
          <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
          <p style="color: #bbb; font-size: 12px; margin: 0; text-align: center;">
            ${APP_NAME} · Secure Test Platform
          </p>
        </div>
      </div>
    `,
  })
}
