import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
import { withAuth } from '@/lib/middleware/auth-guard'
import { getAdminOverview } from '@/lib/services/analytics-service'

async function getHandler() {
    const result = await getAdminOverview()
    return NextResponse.json(result)
}

export const GET = withAuth(getHandler, ['ADMIN'])
