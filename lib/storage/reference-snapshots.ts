import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

import { put } from '@vercel/blob'

import type { GeneratedQuestion } from '@/lib/services/ai-service.types'

type RenderPageAsImageFn = typeof import('unpdf')['renderPageAsImage']
type RenderPageAsImageOptions = NonNullable<Parameters<RenderPageAsImageFn>[2]>
type CanvasImport = NonNullable<RenderPageAsImageOptions['canvasImport']>
type CanvasModule = Awaited<ReturnType<CanvasImport>>

type ReferenceSnapshotAsset = {
    assetUrl: string
    bbox: null
}

const SUPPORTED_REFERENCE_IMAGE_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
])
const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024

const requireCanvasModule = createRequire(import.meta.url)
const OPTIONAL_CANVAS_MODULE = ['@napi-rs', 'canvas'].join('/')
const PAGE_IMAGE_SCALE = 1.65
const INLINE_REFERENCE_DATA_URL_LIMIT_BYTES = 5 * 1024 * 1024

function sanitizeSegment(value: string) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'reference'
}

function dataUrlToBuffer(dataUrl: string) {
    const match = dataUrl.match(/^data:(.+?);base64,(.+)$/)
    if (!match) {
        throw new Error('Invalid page image data URL returned by PDF renderer.')
    }

    return {
        mimeType: match[1],
        buffer: Buffer.from(match[2], 'base64'),
    }
}

function bufferToDataUrl(buffer: Buffer, mimeType: string) {
    return `data:${mimeType};base64,${buffer.toString('base64')}`
}

async function loadCanvasModule(): Promise<CanvasModule | null> {
    try {
        return requireCanvasModule(OPTIONAL_CANVAS_MODULE) as CanvasModule
    } catch (error) {
        console.warn('[IMPORT][REF] Canvas-backed PDF rendering unavailable for snapshot capture:', error)
        return null
    }
}

function getRelevantSnapshotPages(
    questions: Array<Pick<GeneratedQuestion, 'sourcePage' | 'referenceMode'>>,
) {
    const pages = new Set<number>()
    for (const question of questions) {
        if (
            (question.referenceMode === 'SNAPSHOT' || question.referenceMode === 'HYBRID')
            && Number.isInteger(question.sourcePage)
            && Number(question.sourcePage) > 0
        ) {
            pages.add(Number(question.sourcePage))
        }
    }

    return [...pages].sort((left, right) => left - right)
}

export function isReferenceSnapshotStorageConfigured() {
    return Boolean(process.env.BLOB_READ_WRITE_TOKEN)
}

export async function uploadPdfReferenceSnapshots(input: {
    buffer: Buffer
    fileName: string
    testId: string
    questions: Array<Pick<GeneratedQuestion, 'sourcePage' | 'referenceMode'>>
}) {
    const relevantPages = getRelevantSnapshotPages(input.questions)
    if (relevantPages.length === 0 || !isReferenceSnapshotStorageConfigured()) {
        return new Map<number, ReferenceSnapshotAsset>()
    }

    const canvasModule = await loadCanvasModule()
    if (!canvasModule) {
        return new Map<number, ReferenceSnapshotAsset>()
    }

    const { getDocumentProxy, renderPageAsImage } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(input.buffer))
    const fileSlug = sanitizeSegment(input.fileName.replace(/\.(pdf)$/i, ''))
    const uploadedByPage = new Map<number, ReferenceSnapshotAsset>()

    for (const pageNumber of relevantPages) {
        try {
            const imageUrl = await renderPageAsImage(pdf, pageNumber, {
                canvasImport: async () => canvasModule,
                scale: PAGE_IMAGE_SCALE,
                toDataURL: true,
            })
            const { mimeType, buffer } = dataUrlToBuffer(imageUrl)
            const extension = mimeType === 'image/jpeg' ? 'jpg' : 'png'
            const blob = await put(
                `question-references/${sanitizeSegment(input.testId)}/${fileSlug}-p${pageNumber}-${randomUUID()}.${extension}`,
                buffer,
                {
                    access: 'public',
                    contentType: mimeType,
                    token: process.env.BLOB_READ_WRITE_TOKEN,
                },
            )

            uploadedByPage.set(pageNumber, {
                assetUrl: blob.url,
                bbox: null,
            })
        } catch (error) {
            console.warn(`[IMPORT][REF] Failed to upload snapshot for page ${pageNumber}:`, error)
        }
    }

    return uploadedByPage
}

export async function uploadManualReferenceSnapshot(input: {
    testId: string
    questionId: string
    file: File
}) {
    if (!SUPPORTED_REFERENCE_IMAGE_TYPES.has(input.file.type)) {
        throw new Error('Only PNG, JPEG, and WEBP reference images are supported.')
    }

    if (input.file.size > MAX_REFERENCE_IMAGE_BYTES) {
        throw new Error('Reference images must be 5MB or smaller.')
    }

    const extension = input.file.type === 'image/jpeg'
        ? 'jpg'
        : input.file.type === 'image/webp'
            ? 'webp'
            : 'png'

    const buffer = Buffer.from(await input.file.arrayBuffer())

    if (!isReferenceSnapshotStorageConfigured()) {
        if (buffer.byteLength > INLINE_REFERENCE_DATA_URL_LIMIT_BYTES) {
            throw new Error('Reference images must be 5MB or smaller.')
        }

        return {
            assetUrl: bufferToDataUrl(buffer, input.file.type),
            bbox: null,
        } satisfies ReferenceSnapshotAsset
    }

    const blob = await put(
        `question-references/${sanitizeSegment(input.testId)}/manual-${sanitizeSegment(input.questionId)}-${randomUUID()}.${extension}`,
        buffer,
        {
            access: 'public',
            contentType: input.file.type,
            token: process.env.BLOB_READ_WRITE_TOKEN,
        },
    )

    return {
        assetUrl: blob.url,
        bbox: null,
    } satisfies ReferenceSnapshotAsset
}
