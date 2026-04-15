import { beforeEach, expect, test, vi } from 'vitest'

vi.stubEnv('NODE_ENV', process.env.NODE_ENV ?? 'test')
vi.stubEnv('DATABASE_URL', process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')
vi.stubEnv('DIRECT_URL', process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://tester:tester@localhost:5432/unimonk_test')

const {
    mockConvertToHtml,
    mockExtractRawText,
} = vi.hoisted(() => ({
    mockConvertToHtml: vi.fn(),
    mockExtractRawText: vi.fn(),
}))

vi.mock('mammoth', () => ({
    convertToHtml: mockConvertToHtml,
    extractRawText: mockExtractRawText,
}))

const aiServicePromise = import('../../../lib/services/ai-service')

beforeEach(() => {
    vi.clearAllMocks()
})

test('parseDocxToText prefers HTML conversion to preserve table and list boundaries', async () => {
    const { parseDocxToText } = await aiServicePromise

    mockConvertToHtml.mockResolvedValueOnce({
        value: `
            <h1>Reasoning Mock</h1>
            <p>Match the following:</p>
            <img src="data:image/png;base64,abc" alt="Figure series with three arrows" />
            <table>
                <tr><th>List I</th><th>List II</th></tr>
                <tr><td>A. Analogy</td><td>1. Relationship</td></tr>
                <tr><td>B. Coding</td><td>2. Pattern</td></tr>
            </table>
        `,
    })
    const result = await parseDocxToText(Buffer.from('fake-docx'))

    expect(result).toContain('Reasoning Mock')
    expect(result).toContain('Match the following:')
    expect(result).toContain('[Image: Figure series with three arrows]')
    expect(result).toContain('List I')
    expect(result).toContain('A. Analogy')
    expect(result).toContain('1. Relationship')
    expect(mockExtractRawText).not.toHaveBeenCalled()
})

test('parseDocxToText falls back to raw text when HTML conversion fails', async () => {
    const { parseDocxToText } = await aiServicePromise

    mockConvertToHtml.mockRejectedValueOnce(new Error('html conversion failed'))
    mockExtractRawText.mockResolvedValueOnce({
        value: 'Raw DOCX text fallback',
    })

    const result = await parseDocxToText(Buffer.from('fake-docx'))

    expect(result).toBe('Raw DOCX text fallback')
    expect(mockExtractRawText).toHaveBeenCalledOnce()
})
