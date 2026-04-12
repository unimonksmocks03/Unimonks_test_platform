import { beforeEach, expect, test, vi } from 'vitest'

const prismaMock = {
    user: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
    },
    batch: {
        findMany: vi.fn(),
    },
    batchStudent: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
        findMany: vi.fn(),
    },
    $transaction: vi.fn(),
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
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock))
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

test('updating a student can replace batch memberships directly from user management', async () => {
    const { updateUser } = await servicePromise

    prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'student-1',
        email: 'student@example.com',
        name: 'Student One',
        role: 'STUDENT',
        status: 'ACTIVE',
    })
    prismaMock.batch.findMany.mockResolvedValueOnce([
        { id: 'batch-1', kind: 'STANDARD' },
        { id: 'batch-2', kind: 'STANDARD' },
    ])
    prismaMock.user.update.mockResolvedValueOnce({
        id: 'student-1',
        email: 'student@example.com',
        name: 'Student One',
        role: 'STUDENT',
        status: 'ACTIVE',
        createdAt: new Date('2026-03-22T00:00:00.000Z'),
        updatedAt: new Date('2026-03-23T00:00:00.000Z'),
    })
    prismaMock.batchStudent.findMany.mockResolvedValueOnce([
        {
            batch: {
                id: 'batch-1',
                name: 'Humanities',
                code: 'HUM-XII',
                status: 'ACTIVE',
                kind: 'STANDARD',
            },
        },
        {
            batch: {
                id: 'batch-2',
                name: 'Reasoning',
                code: 'REASON-XII',
                status: 'ACTIVE',
                kind: 'STANDARD',
            },
        },
    ])

    const result = await updateUser('ADMIN', 'student-1', {
        batchIds: ['batch-1', 'batch-2'],
    })

    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(prismaMock.batchStudent.deleteMany).toHaveBeenCalledWith({
        where: { studentId: 'student-1' },
    })
    expect(prismaMock.batchStudent.createMany).toHaveBeenCalledWith({
        data: [
            { batchId: 'batch-1', studentId: 'student-1' },
            { batchId: 'batch-2', studentId: 'student-1' },
        ],
        skipDuplicates: true,
    })
    expect(result.user.batches).toHaveLength(2)
})

test('user management rejects assigning the protected free batch to a student', async () => {
    const { updateUser } = await servicePromise

    prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'student-1',
        email: 'student@example.com',
        name: 'Student One',
        role: 'STUDENT',
        status: 'ACTIVE',
    })
    prismaMock.batch.findMany.mockResolvedValueOnce([
        { id: 'free-batch', kind: 'FREE_SYSTEM' },
    ])

    const result = await updateUser('ADMIN', 'student-1', {
        batchIds: ['free-batch'],
    })

    expect('error' in result && result.code).toBe('SYSTEM_BATCH_PROTECTED')
    expect(prismaMock.batchStudent.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.user.update).not.toHaveBeenCalled()
})
