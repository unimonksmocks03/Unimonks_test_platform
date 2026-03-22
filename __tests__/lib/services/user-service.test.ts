import { beforeEach, expect, test, vi } from 'vitest'

const prismaMock = {
    user: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
    },
}

const destroyAllSessionsMock = vi.fn()
const sendWelcomeEmailMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
    prisma: prismaMock,
}))

vi.mock('@/lib/session', () => ({
    destroyAllSessions: destroyAllSessionsMock,
}))

vi.mock('@/lib/services/email-service', () => ({
    sendWelcomeEmail: sendWelcomeEmailMock,
}))

const servicePromise = import('../../../lib/services/user-service')

beforeEach(() => {
    vi.clearAllMocks()
})

test('primary admin can create a sub-admin account', async () => {
    const { createUser } = await servicePromise

    prismaMock.user.findUnique.mockResolvedValueOnce(null)
    prismaMock.user.create.mockResolvedValueOnce({
        id: 'sub-admin-1',
        email: 'backup-admin@example.com',
        name: 'Backup Admin',
        role: 'SUB_ADMIN',
        status: 'ACTIVE',
        createdAt: new Date('2026-03-22T00:00:00.000Z'),
    })
    sendWelcomeEmailMock.mockResolvedValueOnce(undefined)

    const result = await createUser('ADMIN', {
        name: 'Backup Admin',
        email: 'backup-admin@example.com',
        role: 'SUB_ADMIN',
    })

    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(result.user.role).toBe('SUB_ADMIN')
    expect(prismaMock.user.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
            role: 'SUB_ADMIN',
        }),
    }))
})

test('sub-admin cannot create another sub-admin account', async () => {
    const { createUser } = await servicePromise

    const result = await createUser('SUB_ADMIN', {
        name: 'Blocked Promotion',
        email: 'blocked@example.com',
        role: 'SUB_ADMIN',
    })

    expect('error' in result && result.code).toBe('OWNER_ADMIN_REQUIRED')
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.user.create).not.toHaveBeenCalled()
})

test('sub-admin cannot edit another sub-admin account', async () => {
    const { updateUser } = await servicePromise

    prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'sub-admin-1',
        email: 'backup-admin@example.com',
        name: 'Backup Admin',
        role: 'SUB_ADMIN',
        status: 'ACTIVE',
    })

    const result = await updateUser('SUB_ADMIN', 'sub-admin-1', {
        status: 'SUSPENDED',
    })

    expect('error' in result && result.code).toBe('OWNER_ADMIN_REQUIRED')
    expect(prismaMock.user.update).not.toHaveBeenCalled()
})

test('sub-admin cannot edit the owner admin profile details', async () => {
    const { updateUser } = await servicePromise

    prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'owner-admin-1',
        email: 'owner@example.com',
        name: 'Owner Admin',
        role: 'ADMIN',
        status: 'ACTIVE',
    })

    const result = await updateUser('SUB_ADMIN', 'owner-admin-1', {
        name: 'Changed Name',
        email: 'changed-owner@example.com',
    })

    expect('error' in result && result.code).toBe('OWNER_ADMIN_REQUIRED')
    expect(prismaMock.user.update).not.toHaveBeenCalled()
})

test('sub-admin cannot delete another sub-admin account', async () => {
    const { deleteUser } = await servicePromise

    prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'sub-admin-1',
        role: 'SUB_ADMIN',
        status: 'ACTIVE',
    })

    const result = await deleteUser('SUB_ADMIN', 'sub-admin-1')

    expect('error' in result && result.code).toBe('OWNER_ADMIN_REQUIRED')
    expect(prismaMock.user.update).not.toHaveBeenCalled()
    expect(destroyAllSessionsMock).not.toHaveBeenCalled()
})
