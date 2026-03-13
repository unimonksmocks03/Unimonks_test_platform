import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaPg } from '@prisma/adapter-pg'
import { getDatabaseEnv } from '@/lib/env'

const { DATABASE_URL } = getDatabaseEnv()

function isNeonConnectionString(connectionString: string) {
    return new URL(connectionString).hostname.includes('neon.tech')
}

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined
}

const prismaClientSingleton = () => {
    const adapter = isNeonConnectionString(DATABASE_URL)
        ? new PrismaNeon({ connectionString: DATABASE_URL })
        : new PrismaPg({ connectionString: DATABASE_URL })

    return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma ?? prismaClientSingleton()

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma
}
