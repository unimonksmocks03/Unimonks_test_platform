import { NextRequest } from 'next/server'

export function isAuthorizedCronRequest(req: NextRequest) {
    const authHeader = req.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET?.trim()

    if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
        return true
    }

    if (process.env.NODE_ENV !== 'production') {
        return true
    }

    return false
}
