import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

function isNeonConnectionString(connectionString: string) {
    return new URL(connectionString).hostname.includes('neon.tech')
}

export function getPrismaConnectionString() {
    const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL

    if (!connectionString) {
        throw new Error('DIRECT_URL or DATABASE_URL is required for Prisma scripts')
    }

    return connectionString
}

export function createScriptPrismaClient() {
    const connectionString = getPrismaConnectionString()
    const adapter = isNeonConnectionString(connectionString)
        ? new PrismaNeon({ connectionString })
        : new PrismaPg({ connectionString })

    return new PrismaClient({ adapter })
}
