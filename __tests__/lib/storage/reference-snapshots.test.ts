import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'

const putMock = vi.fn()

vi.mock('@vercel/blob', () => ({
    put: putMock,
}))

describe('uploadManualReferenceSnapshot', () => {
    beforeEach(() => {
        vi.resetModules()
        vi.unstubAllEnvs()
        putMock.mockReset()
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    test('falls back to an inline data url when blob storage is not configured', async () => {
        const { uploadManualReferenceSnapshot } = await import('@/lib/storage/reference-snapshots')

        const result = await uploadManualReferenceSnapshot({
            testId: 'test-1',
            questionId: 'question-1',
            file: new File(['png-data'], 'figure.png', { type: 'image/png' }),
        })

        expect(putMock).not.toHaveBeenCalled()
        expect(result).toEqual({
            assetUrl: expect.stringMatching(/^data:image\/png;base64,/),
            bbox: null,
        })
    })

    test('uploads to blob storage when the token is configured', async () => {
        vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'blob-token')
        putMock.mockResolvedValueOnce({
            url: 'https://blob.vercel-storage.com/manual-reference.png',
        })

        const { uploadManualReferenceSnapshot } = await import('@/lib/storage/reference-snapshots')

        const result = await uploadManualReferenceSnapshot({
            testId: 'test-1',
            questionId: 'question-1',
            file: new File(['png-data'], 'figure.png', { type: 'image/png' }),
        })

        expect(putMock).toHaveBeenCalledTimes(1)
        expect(result).toEqual({
            assetUrl: 'https://blob.vercel-storage.com/manual-reference.png',
            bbox: null,
        })
    })
})
