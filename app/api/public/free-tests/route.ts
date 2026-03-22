import { NextResponse } from 'next/server'

import { listPublicMockCatalog } from '@/lib/services/free-test-service'

export const dynamic = 'force-dynamic'

export async function GET() {
    const catalog = await listPublicMockCatalog()
    return NextResponse.json(catalog)
}
