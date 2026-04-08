/**
 * Manual parser test — runs regex + AI extraction on real reference documents
 * and prints a comparison table.
 *
 * Usage:
 *   npx tsx scripts/test-parser.ts
 */
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { parseDocumentToText, extractQuestionsFromDocumentText, extractQuestionsFromDocumentTextPrecisely } from '../lib/services/ai-service'

// Stub DATABASE_URL so prisma doesn't crash at import time
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
process.env.DIRECT_URL ??= process.env.DATABASE_URL

const REFERENCE_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '../reference_images')

const FILES = [
    'ch 7 pol sc.docx',
    'Mock Test for Chapter 6.docx',
    'Mock Test_ Tertiary and Quaternary Activities (Chapter 6 – Human Geography, CUET).docx',
    'sectional mocktest 1 bio.pdf',
    'UNIT 6 CHEMISTRY MOCKTEST.pdf',
]

const COL = {
    file:      30,
    text:       8,
    regex:      7,
    detected:   9,
    ai:         7,
    final:      7,
    exact:      6,
    strategy:  20,
}

function pad(s: string | number, w: number) {
    return String(s).slice(0, w).padEnd(w)
}
function hr(char = '─') {
    const total = Object.values(COL).reduce((a, b) => a + b, 0) + Object.keys(COL).length * 3
    return char.repeat(total)
}

console.log('\n' + hr('═'))
console.log('  Reference Document Parser Test')
console.log(hr('═'))
console.log(
    '  ' +
    pad('File', COL.file) + ' | ' +
    pad('TextKB', COL.text) + ' | ' +
    pad('Regex', COL.regex) + ' | ' +
    pad('Detected', COL.detected) + ' | ' +
    pad('AI', COL.ai) + ' | ' +
    pad('Final', COL.final) + ' | ' +
    pad('Exact', COL.exact) + ' | ' +
    pad('Strategy', COL.strategy)
)
console.log('  ' + hr())

async function main() {

const results: Array<{
    file: string
    textKB: number
    regexQ: number
    detected: boolean
    aiRepair: boolean
    finalQ: number
    exact: boolean
    strategy: string
    firstStem?: string
    error?: string
}> = []

for (const fileName of FILES) {
    const filePath = path.join(REFERENCE_DIR, fileName)
    if (!fs.existsSync(filePath)) {
        console.log(`  [SKIP] ${fileName} — file not found`)
        continue
    }

    const buffer = fs.readFileSync(filePath)
    const shortName = fileName.length > COL.file ? '…' + fileName.slice(-(COL.file - 1)) : fileName

    try {
        // Step 1: parse to text
        const text = await parseDocumentToText(buffer, fileName)
        const textKB = Math.round(text.length / 1024)

        // Step 2: regex-only extraction (sync, no AI)
        const regexResult = extractQuestionsFromDocumentText(text)

        // Step 3: full pipeline (regex + AI fallback/repair)
        const precise = await extractQuestionsFromDocumentTextPrecisely(text, undefined)

        const strategy = precise.aiRepairUsed
            ? (regexResult.detectedAsMcqDocument ? 'REGEX+AI_REPAIR' : 'AI_EXTRACT')
            : (precise.detectedAsMcqDocument ? 'REGEX' : 'NOT_DETECTED')

        const firstStem = precise.questions[0]?.stem?.slice(0, 80)

        results.push({
            file: shortName,
            textKB,
            regexQ: regexResult.questions.length,
            detected: precise.detectedAsMcqDocument,
            aiRepair: precise.aiRepairUsed,
            finalQ: precise.questions.length,
            exact: precise.exactMatchAchieved,
            strategy,
            firstStem,
            error: precise.message,
        })

        console.log(
            '  ' +
            pad(shortName, COL.file) + ' | ' +
            pad(`${textKB}k`, COL.text) + ' | ' +
            pad(regexResult.questions.length, COL.regex) + ' | ' +
            pad(precise.detectedAsMcqDocument ? 'YES' : 'no', COL.detected) + ' | ' +
            pad(precise.aiRepairUsed ? 'YES' : 'no', COL.ai) + ' | ' +
            pad(precise.questions.length, COL.final) + ' | ' +
            pad(precise.exactMatchAchieved ? 'YES' : 'no', COL.exact) + ' | ' +
            pad(strategy, COL.strategy)
        )
    } catch (err) {
        console.log(`  ${pad(shortName, COL.file)} | ERROR: ${err}`)
    }
}

console.log('  ' + hr('═'))
console.log('\nFirst question stems (to verify extraction quality):\n')
for (const r of results) {
    console.log(`  [${r.file}]`)
    if (r.firstStem) {
        console.log(`    Q1: ${r.firstStem}`)
    } else {
        console.log(`    (no questions extracted)`)
    }
    if (r.error) {
        console.log(`    ⚠  ${r.error}`)
    }
    console.log()
}

} // end main

main().catch(err => { console.error(err); process.exit(1) })
