import { prisma } from '@/lib/prisma'

export async function hardDeleteTestsById(testIds: string[]) {
    const uniqueIds = [...new Set(testIds.filter(Boolean))]

    if (uniqueIds.length === 0) {
        return { deletedCount: 0 }
    }

    const deletedTests = await prisma.test.deleteMany({
        where: {
            id: { in: uniqueIds },
        },
    })

    return { deletedCount: deletedTests.count }
}

export async function hardDeleteTestById(testId: string) {
    return hardDeleteTestsById([testId])
}
