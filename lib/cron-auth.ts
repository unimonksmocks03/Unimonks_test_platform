import { NextRequest } from 'next/server'

export function isAuthorizedCronRequest(req: NextRequest) {
    const authHeader = req.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
        return true
    }

    if (process.env.NODE_ENV !== 'production') {
        return true
    }

    const userAgent = req.headers.get('user-agent') || ''
    return userAgent.toLowerCase().startsWith('vercel-cron/')
}
