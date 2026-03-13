import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'

export const dynamic = 'force-dynamic'

async function checkDatabase() {
    try {
        await prisma.$queryRaw`SELECT 1`
        return { ok: true }
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : 'Unknown database error',
        }
    }
}

async function checkRedis() {
    try {
        await redis.get('health:ping')
        return { ok: true }
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : 'Unknown redis error',
        }
    }
}

export async function GET() {
    const [database, redisStatus] = await Promise.all([checkDatabase(), checkRedis()])
    const ok = database.ok && redisStatus.ok

    return NextResponse.json(
        {
            status: ok ? 'ok' : 'degraded',
            timestamp: new Date().toISOString(),
            environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
            region: process.env.VERCEL_REGION || 'local',
            checks: {
                database,
                redis: redisStatus,
            },
        },
        { status: ok ? 200 : 503 }
    )
}
