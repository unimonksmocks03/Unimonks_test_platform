import assert from 'node:assert/strict'
import test from 'node:test'

import { BatchKind, TestStatus } from '@prisma/client'

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test'
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test'
process.env.DIRECT_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL
delete process.env.REDIS_URL
process.env.UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL ?? 'https://example.upstash.io'
process.env.UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? 'test-token'

const servicePromise = import('../../../lib/services/test-service')

test('validateDraftEditableStatus allows draft edits only', async () => {
    const {
        validateDraftEditableStatus,
    } = await servicePromise

    assert.equal(validateDraftEditableStatus(TestStatus.DRAFT), null)

    const publishedResult = validateDraftEditableStatus(TestStatus.PUBLISHED)
    assert.equal(publishedResult?.code, 'NOT_EDITABLE')

    const archivedResult = validateDraftEditableStatus(TestStatus.ARCHIVED)
    assert.equal(archivedResult?.code, 'NOT_EDITABLE')
})

test('validatePublishDraftState enforces questions and assignments before publish', async () => {
    const {
        validatePublishDraftState,
    } = await servicePromise

    assert.equal(validatePublishDraftState({
        currentStatus: TestStatus.DRAFT,
        questionCount: 1,
        batchKinds: [BatchKind.STANDARD],
    }), null)

    const noQuestions = validatePublishDraftState({
        currentStatus: TestStatus.DRAFT,
        questionCount: 0,
        batchKinds: [BatchKind.STANDARD],
    })
    assert.equal(noQuestions?.code, 'NO_QUESTIONS')

    const noAssignments = validatePublishDraftState({
        currentStatus: TestStatus.DRAFT,
        questionCount: 4,
        batchKinds: [],
    })
    assert.equal(noAssignments?.code, 'NO_ASSIGNMENTS')

    const publishedAlready = validatePublishDraftState({
        currentStatus: TestStatus.PUBLISHED,
        questionCount: 4,
        batchKinds: [BatchKind.STANDARD],
    })
    assert.equal(publishedAlready?.code, 'INVALID_TRANSITION')
})

test('batch audience helpers keep free and paid assignments separate', async () => {
    const {
        classifyBatchAudience,
        validateBatchAudienceConsistency,
    } = await servicePromise

    assert.equal(classifyBatchAudience([BatchKind.FREE_SYSTEM]), 'FREE')
    assert.equal(classifyBatchAudience([BatchKind.STANDARD]), 'PAID')
    assert.equal(classifyBatchAudience([]), 'UNASSIGNED')

    const mixedResult = validateBatchAudienceConsistency([BatchKind.FREE_SYSTEM, BatchKind.STANDARD])
    assert.equal(mixedResult?.code, 'INVALID_ASSIGNMENT_MIX')
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

    assert.equal('error' in validUpload, false)
    if ('error' in validUpload) return

    assert.equal(validUpload.sanitizedFileName, 'biology-notes.pdf')
    assert.equal(validUpload.generationTarget, 30)

    const unsupportedFile = validateAdminDocumentUpload({
        fileName: 'biology-notes.txt',
        fileSize: 1024,
    })
    assert.equal('error' in unsupportedFile && unsupportedFile.code, 'BAD_REQUEST')

    const oversizedFile = validateAdminDocumentUpload({
        fileName: 'biology-notes.pdf',
        fileSize: 6 * 1024 * 1024,
    })
    assert.equal('error' in oversizedFile && oversizedFile.code, 'BAD_REQUEST')
})
