import 'dotenv/config'

import { BatchKind, BatchStatus, Role, UserStatus } from '@prisma/client'

import {
    FREE_BATCH_CODE,
    FREE_BATCH_KIND,
    FREE_BATCH_NAME,
} from '../lib/config/platform-policy'
import { normalizeOptionalEmail } from '../lib/utils/contact-normalization'
import { createScriptPrismaClient } from '../prisma/runtime'

const prisma = createScriptPrismaClient()

function getOwnerAdminConfig() {
    const email = normalizeOptionalEmail(process.env.OWNER_ADMIN_EMAIL)
    const name = process.env.OWNER_ADMIN_NAME?.trim()

    if (!email) {
        throw new Error('OWNER_ADMIN_EMAIL is required for bootstrap-owner-admin')
    }

    if (!name) {
        throw new Error('OWNER_ADMIN_NAME is required for bootstrap-owner-admin')
    }

    return { email, name }
}

async function ensureSingleOwnerAdmin(email: string, name: string) {
    const existingAdmins = await prisma.user.findMany({
        where: { role: Role.ADMIN },
        orderBy: { createdAt: 'asc' },
        select: {
            id: true,
            email: true,
            status: true,
        },
    })

    const foreignAdmins = existingAdmins.filter((admin) => admin.email !== email)
    if (foreignAdmins.length > 0) {
        throw new Error(
            `Bootstrap refused because additional ADMIN records already exist: ${foreignAdmins.map((admin) => admin.email).join(', ')}`,
        )
    }

    return prisma.user.upsert({
        where: { email },
        update: {
            name,
            role: Role.ADMIN,
            status: UserStatus.ACTIVE,
        },
        create: {
            email,
            name,
            role: Role.ADMIN,
            status: UserStatus.ACTIVE,
        },
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
        },
    })
}

async function ensureFreeBatch() {
    const existingFreeBatch = await prisma.batch.findFirst({
        where: {
            OR: [
                { kind: FREE_BATCH_KIND },
                { code: FREE_BATCH_CODE },
                { name: FREE_BATCH_NAME },
            ],
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
    })

    if (existingFreeBatch) {
        return prisma.batch.update({
            where: { id: existingFreeBatch.id },
            data: {
                name: FREE_BATCH_NAME,
                code: FREE_BATCH_CODE,
                kind: BatchKind.FREE_SYSTEM,
                status: BatchStatus.ACTIVE,
            },
        })
    }

    return prisma.batch.create({
        data: {
            name: FREE_BATCH_NAME,
            code: FREE_BATCH_CODE,
            kind: BatchKind.FREE_SYSTEM,
            status: BatchStatus.ACTIVE,
        },
    })
}

async function main() {
    const { email, name } = getOwnerAdminConfig()

    console.log('🔐 Bootstrapping owner admin...')

    const admin = await ensureSingleOwnerAdmin(email, name)
    const freeBatch = await ensureFreeBatch()

    console.log(`✅ Owner admin ready: ${admin.email}`)
    console.log(`✅ FREE-Batch ready: ${freeBatch.code}`)
    console.log('ℹ️ Production bootstrap finished with only the owner admin and FREE-Batch guaranteed.')
}

main()
    .catch((error) => {
        console.error('❌ Failed to bootstrap owner admin:', error)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
