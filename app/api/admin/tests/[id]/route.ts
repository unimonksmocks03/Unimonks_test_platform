import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
import { withAuth } from '@/lib/middleware/auth-guard'
import { prisma } from '@/lib/prisma'
import { Role } from '@prisma/client'
import { hardDeleteTestById } from '@/lib/services/test-lifecycle'

// DELETE /api/admin/tests/[id] — admin can force-delete any test
async function deleteHandler(req: NextRequest, ctx: { userId: string; role: Role }) {
    const url = new URL(req.url)
    const id = url.pathname.split('/').pop()

    if (!id) {
        return NextResponse.json({ error: true, message: 'Test ID required' }, { status: 400 })
    }

    const test = await prisma.test.findUnique({ where: { id } })
    if (!test) {
        return NextResponse.json({ error: true, message: 'Test not found' }, { status: 404 })
    }

    // Admin can delete any test regardless of status
    await hardDeleteTestById(id)

    return NextResponse.json({ message: `Test "${test.title}" deleted successfully` })
}

export const DELETE = withAuth(deleteHandler, ['ADMIN'])
