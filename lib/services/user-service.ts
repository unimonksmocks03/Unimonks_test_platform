import { prisma } from '@/lib/prisma'
import { destroyAllSessions } from '@/lib/session'
import { sendWelcomeEmail } from '@/lib/services/email-service'
import type { CreateUserInput, UpdateUserInput, UserQueryInput } from '@/lib/validations/user.schema'
import { Role, UserStatus, Prisma } from '@prisma/client'

/**
 * Admin-level user management service.
 * All functions here assume the caller has admin-panel access (enforced at route level).
 * Owner-only restrictions for sub-admin management are enforced here.
 */

// ── List Users (paginated, filterable, searchable) ──
export async function listUsers(query: UserQueryInput) {
    const { search, role, status, page, limit } = query
    const skip = (page - 1) * limit

    const where: Prisma.UserWhereInput = {}

    if (search) {
        where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
        ]
    }
    if (role) where.role = role as Role
    if (status) where.status = status as UserStatus

    const [users, total] = await Promise.all([
        prisma.user.findMany({
            where,
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                status: true,
                createdAt: true,
                updatedAt: true,
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
        }),
        prisma.user.count({ where }),
    ])

    return {
        users,
        total,
        page,
        totalPages: Math.ceil(total / limit),
    }
}

function canGrantSubAdmin(actorRole: Role) {
    return actorRole === 'ADMIN'
}

// ── Create User ──
export async function createUser(actorRole: Role, data: CreateUserInput) {
    if (data.role === 'SUB_ADMIN' && !canGrantSubAdmin(actorRole)) {
        return {
            error: true,
            code: 'OWNER_ADMIN_REQUIRED',
            message: 'Only the primary admin can grant sub-admin access',
        }
    }

    // Check email uniqueness
    const existing = await prisma.user.findUnique({ where: { email: data.email } })
    if (existing) {
        return { error: true, code: 'DUPLICATE_EMAIL', message: 'A user with this email already exists' }
    }

    const user = await prisma.user.create({
        data: {
            email: data.email,
            name: data.name,
            role: data.role as Role,
            status: 'ACTIVE',
        },
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
            createdAt: true,
        },
    })

    // Send welcome email (non-blocking — don't let email failure break user creation)
    try {
        await sendWelcomeEmail(user.email, user.name)
    } catch (emailError) {
        console.error('[WARN] Failed to send welcome email:', emailError)
    }

    return { user }
}

// ── Update User ──
export async function updateUser(actorRole: Role, id: string, data: UpdateUserInput) {
    // Check user exists
    const existing = await prisma.user.findUnique({ where: { id } })
    if (!existing) {
        return { error: true, code: 'NOT_FOUND', message: 'User not found' }
    }

    const isOwnerAdmin = existing.role === 'ADMIN'
    const isSubAdmin = existing.role === 'SUB_ADMIN'
    const actorCanManageSubAdmins = canGrantSubAdmin(actorRole)

    if (data.role === 'ADMIN' && existing.role !== 'ADMIN') {
        return {
            error: true,
            code: 'SOLE_ADMIN_ONLY',
            message: 'Creating additional admin accounts is not allowed',
        }
    }

    if (isOwnerAdmin) {
        if (actorRole !== 'ADMIN') {
            return {
                error: true,
                code: 'OWNER_ADMIN_REQUIRED',
                message: 'Only the owner admin can manage the primary admin account',
            }
        }

        if (data.role && data.role !== 'ADMIN') {
            return {
                error: true,
                code: 'ADMIN_PROTECTED',
                message: 'The primary admin role cannot be changed',
            }
        }

        if (data.status && data.status !== 'ACTIVE') {
            return {
                error: true,
                code: 'ADMIN_PROTECTED',
                message: 'The primary admin cannot be deactivated or suspended',
            }
        }
    }

    if (!actorCanManageSubAdmins && (isSubAdmin || data.role === 'SUB_ADMIN')) {
        return {
            error: true,
            code: 'OWNER_ADMIN_REQUIRED',
            message: 'Only the primary admin can create or manage sub-admin accounts',
        }
    }

    // If email is being changed, check uniqueness
    if (data.email && data.email !== existing.email) {
        const emailTaken = await prisma.user.findUnique({ where: { email: data.email } })
        if (emailTaken) {
            return { error: true, code: 'DUPLICATE_EMAIL', message: 'A user with this email already exists' }
        }
    }

    const updateData: Prisma.UserUpdateInput = {}
    if (data.name) updateData.name = data.name
    if (data.email) updateData.email = data.email
    if (data.role) updateData.role = data.role as Role
    if (data.status) updateData.status = data.status as UserStatus

    const user = await prisma.user.update({
        where: { id },
        data: updateData,
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
            createdAt: true,
            updatedAt: true,
        },
    })

    if (existing.status === 'ACTIVE' && user.status !== 'ACTIVE') {
        await destroyAllSessions(id)
    }

    return { user }
}

// ── Delete User (soft delete → status = INACTIVE) ──
export async function deleteUser(actorRole: Role, id: string) {
    const existing = await prisma.user.findUnique({ where: { id } })
    if (!existing) {
        return { error: true, code: 'NOT_FOUND', message: 'User not found' }
    }

    if (existing.role === 'ADMIN') {
        return {
            error: true,
            code: 'ADMIN_PROTECTED',
            message: 'The primary admin cannot be deleted',
        }
    }

    if (existing.role === 'SUB_ADMIN' && !canGrantSubAdmin(actorRole)) {
        return {
            error: true,
            code: 'OWNER_ADMIN_REQUIRED',
            message: 'Only the primary admin can deactivate or delete a sub-admin',
        }
    }

    if (existing.status === 'INACTIVE') {
        return { error: true, code: 'ALREADY_DELETED', message: 'User is already inactive' }
    }

    await prisma.user.update({
        where: { id },
        data: { status: 'INACTIVE' },
    })

    await destroyAllSessions(id)

    return { message: 'User deactivated successfully' }
}
