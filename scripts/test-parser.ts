import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { parseDocumentToText, extractQuestionsFromDocumentText, extractQuestionsFromDocumentTextPrecisely } from '../lib/services/ai-service'

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
process.env.DIRECT_URL ??= process.env.DATABASE_URL

const REFERENCE_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '../reference_images')

const FILES = [
    'ch 7 pol sc.docx',
    'Mock Test for Chapter 6.docx',
    'Mock Test_ Tertiary and Quaternary Activities (Chapter 6 – Human Geography, CUET).docx',
    'sectional mocktest 1 bio.pdf',
    'UNIT 6 CHEMISTRY MOCKTEST.pdf',
    'REVISED CHEM UNIT 7 MOCK.pdf',
]

async function main() {
    console.log('\n=== Reference Document Parser Test ===\n')
    console.log('File'.padEnd(44) + 'Regex  AI_Repair  Final  Exact   Strategy')
    console.log('-'.repeat(90))

    for (const fileName of FILES) {
        const filePath = path.join(REFERENCE_DIR, fileName)
        if (!fs.existsSync(filePath)) { console.log(`[SKIP] ${fileName}`); continue }
        const buf = fs.readFileSync(filePath)
        const shortName = fileName.length > 42 ? '…' + fileName.slice(-(41)) : fileName
        try {
            const text = await parseDocumentToText(buf, fileName)
            const regex = extractQuestionsFromDocumentText(text)
            const precise = await extractQuestionsFromDocumentTextPrecisely(text, undefined)
            const strategy = precise.aiRepairUsed
                ? (regex.detectedAsMcqDocument ? 'REGEX+AI_REPAIR' : 'AI_EXTRACT')
                : (precise.detectedAsMcqDocument ? 'REGEX' : 'NOT_DETECTED')
            console.log(
                shortName.padEnd(44) +
                String(regex.questions.length).padEnd(7) +
                String(precise.aiRepairUsed ? 'YES' : 'no').padEnd(11) +
                String(precise.questions.length).padEnd(7) +
                String(precise.exactMatchAchieved ? 'YES' : 'NO').padEnd(8) +
                strategy
            )
        } catch (e) { console.log(`${shortName.padEnd(44)} ERROR: ${e}`) }
    }

    console.log('\nQ1 stems:\n')
    for (const fileName of FILES) {
        const fp = path.join(REFERENCE_DIR, fileName)
        if (!fs.existsSync(fp)) continue
        const buf = fs.readFileSync(fp)
        try {
            const text = await parseDocumentToText(buf, fileName)
            const r = extractQuestionsFromDocumentText(text)
            const shortName = fileName.length > 42 ? '…' + fileName.slice(-(41)) : fileName
            console.log(`  [${shortName}]`)
            console.log(`    ${r.questions[0]?.stem?.slice(0, 90) ?? '(none)'}`)
        } catch {}
    }
}

main().catch(e => { console.error(e); process.exit(1) })
