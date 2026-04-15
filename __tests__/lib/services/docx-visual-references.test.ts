import { beforeEach, expect, test, vi } from 'vitest'

vi.stubEnv('NODE_ENV', process.env.NODE_ENV ?? 'test')
vi.stubEnv('DATABASE_URL', process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
vi.stubEnv('DIRECT_URL', process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
vi.stubEnv('OPENAI_API_KEY', process.env.OPENAI_API_KEY ?? 'test-openai-key')

const {
    mockConvertToHtml,
    mockExtractRawText,
    mockResponsesParse,
} = vi.hoisted(() => ({
    mockConvertToHtml: vi.fn(),
    mockExtractRawText: vi.fn(),
    mockResponsesParse: vi.fn(),
}))

vi.mock('mammoth', () => ({
    convertToHtml: mockConvertToHtml,
    extractRawText: mockExtractRawText,
}))

vi.mock('openai', () => ({
    default: class {
        responses = { parse: mockResponsesParse }
    },
}))

const aiServicePromise = import('../../../lib/services/ai-service')

beforeEach(() => {
    vi.clearAllMocks()
})

test('extractVisualReferencesFromDocxImages uses embedded DOCX images for multimodal visual-reference recovery', async () => {
    const { extractVisualReferencesFromDocxImages } = await aiServicePromise

    mockConvertToHtml.mockResolvedValueOnce({
        value: `
            <p>[Question 1]</p>
            <p>Study the following cash flow diagram and answer.</p>
            <img src="data:image/png;base64,abc123" alt="Cash flow arrows between operating and investing activities" />
            <p>(A) Option A</p>
            <p>(B) Option B</p>
        `,
    })
    mockResponsesParse.mockResolvedValueOnce({
        output_parsed: {
            references: [
                {
                    questionNumber: 1,
                    sharedContext: 'Cash flow arrows between operating and investing activities',
                    sourcePage: 1,
                    sourceSnippet: 'Study the following cash flow diagram and answer.',
                    sharedContextEvidence: 'Embedded image near question 1',
                    confidence: 0.91,
                    referenceKind: 'DIAGRAM',
                    referenceMode: 'SNAPSHOT',
                    referenceTitle: 'Cash flow diagram',
                },
            ],
        },
        usage: {
            input_tokens: 220,
            output_tokens: 40,
        },
    })

    const result = await extractVisualReferencesFromDocxImages(
        Buffer.from('fake-docx'),
        undefined,
        'accounts.docx',
    )

    expect(result.error).toBeUndefined()
    expect(result.references).toEqual([
        expect.objectContaining({
            questionNumber: 1,
            sharedContext: 'Cash flow arrows between operating and investing activities',
            sourceSnippet: 'Study the following cash flow diagram and answer.',
        }),
    ])
    expect(mockResponsesParse).toHaveBeenCalledOnce()
})
