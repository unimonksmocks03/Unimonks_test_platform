import { expect, test, vi } from 'vitest'

import { BatchKind, TestStatus } from '@prisma/client'

vi.stubEnv('NODE_ENV', process.env.NODE_ENV ?? 'test')
vi.stubEnv('DATABASE_URL', process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
vi.stubEnv('DIRECT_URL', process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
vi.stubEnv('REDIS_URL', process.env.REDIS_URL ?? 'redis://localhost:6379')
vi.stubEnv('UPSTASH_REDIS_REST_URL', process.env.UPSTASH_REDIS_REST_URL ?? 'https://example.upstash.io')
vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', process.env.UPSTASH_REDIS_REST_TOKEN ?? 'test-token')

const servicePromise = import('../../../lib/services/test-service')

test('validateDraftEditableStatus allows draft edits only', async () => {
    const {
        validateDraftEditableStatus,
    } = await servicePromise

    expect(validateDraftEditableStatus(TestStatus.DRAFT)).toBeNull()

    const publishedResult = validateDraftEditableStatus(TestStatus.PUBLISHED)
    expect(publishedResult?.code).toBe('NOT_EDITABLE')

    const archivedResult = validateDraftEditableStatus(TestStatus.ARCHIVED)
    expect(archivedResult?.code).toBe('NOT_EDITABLE')
})

test('validateAssignmentEditableStatus allows published batch changes but keeps archived tests read-only', async () => {
    const {
        validateAssignmentEditableStatus,
    } = await servicePromise

    expect(validateAssignmentEditableStatus(TestStatus.DRAFT)).toBeNull()
    expect(validateAssignmentEditableStatus(TestStatus.PUBLISHED)).toBeNull()

    const archivedResult = validateAssignmentEditableStatus(TestStatus.ARCHIVED)
    expect(archivedResult?.code).toBe('NOT_EDITABLE')
})

test('validatePublishedDurationRepublish allows only duration updates for published tests', async () => {
    const {
        validatePublishedDurationRepublish,
    } = await servicePromise

    expect(validatePublishedDurationRepublish(TestStatus.PUBLISHED, {
        durationMinutes: 90,
    })).toBe(true)

    expect(validatePublishedDurationRepublish(TestStatus.PUBLISHED, {
        durationMinutes: 90,
        status: TestStatus.PUBLISHED,
    })).toBe(true)

    expect(validatePublishedDurationRepublish(TestStatus.PUBLISHED, {
        durationMinutes: 90,
        title: 'Changed title',
    })).toBe(false)

    expect(validatePublishedDurationRepublish(TestStatus.DRAFT, {
        durationMinutes: 90,
    })).toBe(false)
})

test('validatePublishedTitleUpdate allows only title updates for published tests', async () => {
    const {
        validatePublishedTitleUpdate,
    } = await servicePromise

    expect(validatePublishedTitleUpdate(TestStatus.PUBLISHED, {
        title: 'Updated published title',
    })).toBe(true)

    expect(validatePublishedTitleUpdate(TestStatus.PUBLISHED, {
        title: 'Updated published title',
        durationMinutes: 90,
    })).toBe(false)

    expect(validatePublishedTitleUpdate(TestStatus.PUBLISHED, {
        title: 'Updated published title',
        description: 'Should remain locked',
    })).toBe(false)

    expect(validatePublishedTitleUpdate(TestStatus.DRAFT, {
        title: 'Draft title',
    })).toBe(false)
})

test('validatePublishDraftState enforces questions and assignments before publish', async () => {
    const {
        validatePublishDraftState,
    } = await servicePromise

    expect(validatePublishDraftState({
        currentStatus: TestStatus.DRAFT,
        questionCount: 1,
        batchKinds: [BatchKind.STANDARD],
    })).toBeNull()

    const noQuestions = validatePublishDraftState({
        currentStatus: TestStatus.DRAFT,
        questionCount: 0,
        batchKinds: [BatchKind.STANDARD],
    })
    expect(noQuestions?.code).toBe('NO_QUESTIONS')

    const noAssignments = validatePublishDraftState({
        currentStatus: TestStatus.DRAFT,
        questionCount: 4,
        batchKinds: [],
    })
    expect(noAssignments?.code).toBe('NO_ASSIGNMENTS')

    const publishedAlready = validatePublishDraftState({
        currentStatus: TestStatus.PUBLISHED,
        questionCount: 4,
        batchKinds: [BatchKind.STANDARD],
    })
    expect(publishedAlready?.code).toBe('INVALID_TRANSITION')
})

test('batch audience helpers keep free and paid assignments separate', async () => {
    const {
        classifyBatchAudience,
        validateBatchAudienceConsistency,
    } = await servicePromise

    expect(classifyBatchAudience([BatchKind.FREE_SYSTEM])).toBe('FREE')
    expect(classifyBatchAudience([BatchKind.STANDARD])).toBe('PAID')
    expect(classifyBatchAudience([BatchKind.FREE_SYSTEM, BatchKind.STANDARD])).toBe('HYBRID')
    expect(classifyBatchAudience([])).toBe('UNASSIGNED')

    const mixedResult = validateBatchAudienceConsistency([BatchKind.FREE_SYSTEM, BatchKind.STANDARD])
    expect(mixedResult).toBeNull()
})

test('validateAdminDocumentUpload enforces AI import file rules and generation floor', async () => {
    const {
        validateAdminDocumentUpload,
    } = await servicePromise

    const validUpload = validateAdminDocumentUpload({
        fileName: 'biology-notes.pdf',
        fileSize: 1024,
        requestedCount: 12,
    })

    expect('error' in validUpload).toBe(false)
    if ('error' in validUpload) return

    expect(validUpload.sanitizedFileName).toBe('biology-notes.pdf')
    expect(validUpload.generationTarget).toBe(30)

    const unsupportedFile = validateAdminDocumentUpload({
        fileName: 'biology-notes.txt',
        fileSize: 1024,
    })
    expect('error' in unsupportedFile && unsupportedFile.code).toBe('BAD_REQUEST')

    const oversizedFile = validateAdminDocumentUpload({
        fileName: 'biology-notes.pdf',
        fileSize: 26 * 1024 * 1024,
    })
    expect('error' in oversizedFile && oversizedFile.code).toBe('BAD_REQUEST')
})
