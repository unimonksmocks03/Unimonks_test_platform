import 'dotenv/config'

import { Prisma, PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaPg } from '@prisma/adapter-pg'

import {
    FREE_BATCH_CODE,
    FREE_BATCH_KIND,
    FREE_BATCH_NAME,
    STANDARD_BATCH_KIND,
} from '../lib/config/platform-policy'
import { normalizeOptionalEmail } from '../lib/utils/contact-normalization'

const seedConnectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL

if (!seedConnectionString) {
    throw new Error('DIRECT_URL or DATABASE_URL is required to run prisma/seed.ts')
}

function isNeonConnectionString(connectionString: string) {
    return new URL(connectionString).hostname.includes('neon.tech')
}

const adapter = isNeonConnectionString(seedConnectionString)
    ? new PrismaNeon({ connectionString: seedConnectionString })
    : new PrismaPg({ connectionString: seedConnectionString })

const prisma = new PrismaClient({ adapter })

const adminAccount = {
    email: 'tohin1400@gmail.com',
    name: 'Admin User',
}

const studentNames = [
    'Alice Patel',
    'Bob Kumar',
    'Charlie Singh',
    'Diana Sharma',
    'Ethan Verma',
    'Fiona Gupta',
    'George Reddy',
    'Hannah Nair',
    'Isaac Thomas',
    'Julia Das',
]

type SeedUserInput = {
    email: string
    name: string
    role: 'ADMIN' | 'STUDENT'
    status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'
}

type SeedBatchInput = {
    name: string
    code: string
    kind: 'FREE_SYSTEM' | 'STANDARD'
    status: 'ACTIVE' | 'UPCOMING' | 'COMPLETED'
}

type SeedQuestionInput = Prisma.QuestionCreateWithoutTestInput

type SeedTestInput = {
    title: string
    description: string
    durationMinutes: number
    status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
    source: 'MANUAL' | 'AI_GENERATED'
    createdById: string
    questions: SeedQuestionInput[]
}

async function upsertUser(data: SeedUserInput) {
    return prisma.user.upsert({
        where: { email: data.email },
        update: {
            name: data.name,
            role: data.role,
            status: data.status,
        },
        create: data,
    })
}

async function upsertBatch(data: SeedBatchInput) {
    return prisma.batch.upsert({
        where: { code: data.code },
        update: {
            name: data.name,
            kind: data.kind,
            status: data.status,
        },
        create: data,
    })
}

async function ensureQuestions(testId: string, questions: SeedQuestionInput[]) {
    const existingQuestionCount = await prisma.question.count({ where: { testId } })
    if (existingQuestionCount > 0) {
        return
    }

    await prisma.question.createMany({
        data: questions.map((question) => ({
            testId,
            order: question.order,
            stem: question.stem,
            options: question.options,
            explanation: question.explanation ?? null,
            difficulty: question.difficulty,
            topic: question.topic ?? null,
        })),
    })
}

async function upsertTest(data: SeedTestInput) {
    const existing = await prisma.test.findFirst({
        where: { title: data.title },
        select: { id: true },
    })

    if (existing) {
        await prisma.test.update({
            where: { id: existing.id },
            data: {
                createdById: data.createdById,
                description: data.description,
                durationMinutes: data.durationMinutes,
                status: data.status,
                source: data.source,
            },
        })

        await ensureQuestions(existing.id, data.questions)
        return prisma.test.findUniqueOrThrow({ where: { id: existing.id } })
    }

    return prisma.test.create({
        data: {
            createdById: data.createdById,
            title: data.title,
            description: data.description,
            durationMinutes: data.durationMinutes,
            status: data.status,
            source: data.source,
            questions: {
                create: data.questions,
            },
        },
    })
}

async function ensureBatchAssignment(testId: string, batchId: string) {
    const existing = await prisma.testAssignment.findFirst({
        where: { testId, batchId },
        select: { id: true },
    })

    if (existing) {
        return existing
    }

    return prisma.testAssignment.create({
        data: { testId, batchId },
    })
}

async function upsertAliceSession(testId: string, studentId: string) {
    const startedAt = new Date(Date.now() - 20 * 60 * 1000)
    const submittedAt = new Date(Date.now() - 5 * 60 * 1000)
    const serverDeadline = new Date(startedAt.getTime() + 30 * 60 * 1000)

    const existing = await prisma.testSession.findFirst({
        where: {
            testId,
            studentId,
            attemptNumber: 1,
        },
        select: { id: true },
    })

    if (existing) {
        return prisma.testSession.update({
            where: { id: existing.id },
            data: {
                status: 'SUBMITTED',
                startedAt,
                serverDeadline,
                submittedAt,
                answers: { 1: 'B', 2: 'B', 3: 'A' },
                tabSwitchCount: 1,
                score: 2,
                totalMarks: 3,
                percentage: 66.67,
                attemptNumber: 1,
            },
        })
    }

    return prisma.testSession.create({
        data: {
            testId,
            studentId,
            attemptNumber: 1,
            status: 'SUBMITTED',
            startedAt,
            serverDeadline,
            submittedAt,
            answers: { 1: 'B', 2: 'B', 3: 'A' },
            tabSwitchCount: 1,
            score: 2,
            totalMarks: 3,
            percentage: 66.67,
        },
    })
}

async function upsertDemoLead(freeTestId: string) {
    const email = 'public.demo@unimonk.com'
    const emailNormalized = normalizeOptionalEmail(email)

    const existingLead = await prisma.lead.findFirst({
        where: { emailNormalized: emailNormalized ?? undefined },
        select: { id: true },
    })

    const lead = existingLead
        ? await prisma.lead.update({
            where: { id: existingLead.id },
            data: {
                name: 'Public Demo Lead',
                email,
                emailNormalized,
            },
        })
        : await prisma.lead.create({
            data: {
                name: 'Public Demo Lead',
                email,
                emailNormalized,
            },
        })

    const existingSession = await prisma.leadTestSession.findUnique({
        where: {
            testId_leadId: {
                testId: freeTestId,
                leadId: lead.id,
            },
        },
        select: { id: true },
    })

    if (existingSession) {
        return lead
    }

    await prisma.leadTestSession.create({
        data: {
            testId: freeTestId,
            leadId: lead.id,
            status: 'SUBMITTED',
            startedAt: new Date(Date.now() - 15 * 60 * 1000),
            serverDeadline: new Date(Date.now() - 5 * 60 * 1000),
            submittedAt: new Date(Date.now() - 6 * 60 * 1000),
            answers: { 1: 'C', 2: 'B', 3: 'A' },
            score: 2,
            totalMarks: 3,
            percentage: 66.67,
        },
    })

    return lead
}

async function main() {
    console.log('🌱 Seeding database...')

    const admin = await upsertUser({
        email: adminAccount.email,
        name: adminAccount.name,
        role: 'ADMIN',
        status: 'ACTIVE',
    })

    const students = new Map<string, { id: string }>()

    for (let index = 0; index < studentNames.length; index += 1) {
        const firstName = studentNames[index].split(' ')[0].toLowerCase()
        const email = index === 0 ? 'tohin14001@gmail.com' : `${firstName}@student.com`

        const student = await upsertUser({
            email,
            name: studentNames[index],
            role: 'STUDENT',
            status: 'ACTIVE',
        })

        students.set(studentNames[index], { id: student.id })
    }

    const freeBatch = await upsertBatch({
        name: FREE_BATCH_NAME,
        code: FREE_BATCH_CODE,
        kind: FREE_BATCH_KIND,
        status: 'ACTIVE',
    })

    const batchA = await upsertBatch({
        name: 'CUET Batch A',
        code: 'CUET-2026-A',
        kind: STANDARD_BATCH_KIND,
        status: 'ACTIVE',
    })

    const batchB = await upsertBatch({
        name: 'CUET Batch B',
        code: 'CUET-2026-B',
        kind: STANDARD_BATCH_KIND,
        status: 'ACTIVE',
    })

    await upsertBatch({
        name: 'CUET Batch C',
        code: 'CUET-2026-C',
        kind: STANDARD_BATCH_KIND,
        status: 'UPCOMING',
    })

    const batchAStudents = ['Alice Patel', 'Bob Kumar', 'Charlie Singh', 'Diana Sharma', 'Ethan Verma']
    const batchBStudents = ['Fiona Gupta', 'George Reddy', 'Hannah Nair', 'Isaac Thomas', 'Julia Das']

    await prisma.batchStudent.createMany({
        data: batchAStudents
            .map((name) => students.get(name)?.id)
            .filter((studentId): studentId is string => Boolean(studentId))
            .map((studentId) => ({ batchId: batchA.id, studentId })),
        skipDuplicates: true,
    })

    await prisma.batchStudent.createMany({
        data: batchBStudents
            .map((name) => students.get(name)?.id)
            .filter((studentId): studentId is string => Boolean(studentId))
            .map((studentId) => ({ batchId: batchB.id, studentId })),
        skipDuplicates: true,
    })

    const paidBiologyTest = await upsertTest({
        title: 'CUET Biology Mock 1',
        description: 'Paid batch mock covering cell organelles, membrane transport, and cell division.',
        durationMinutes: 30,
        status: 'PUBLISHED',
        source: 'MANUAL',
        createdById: admin.id,
        questions: [
            {
                order: 1,
                stem: 'Which organelle is known as the powerhouse of the cell?',
                options: {
                    A: 'Ribosome',
                    B: 'Mitochondria',
                    C: 'Golgi apparatus',
                    D: 'Lysosome',
                    correct: 'B',
                },
                difficulty: 'EASY',
                topic: 'Cell Organelles',
            },
            {
                order: 2,
                stem: 'What is the primary function of the rough endoplasmic reticulum?',
                options: {
                    A: 'Lipid synthesis',
                    B: 'Protein synthesis',
                    C: 'Energy production',
                    D: 'Waste disposal',
                    correct: 'B',
                },
                difficulty: 'MEDIUM',
                topic: 'Cell Organelles',
            },
            {
                order: 3,
                stem: 'During which phase of mitosis do chromosomes align at the metaphase plate?',
                options: {
                    A: 'Prophase',
                    B: 'Metaphase',
                    C: 'Anaphase',
                    D: 'Telophase',
                    correct: 'B',
                },
                difficulty: 'MEDIUM',
                topic: 'Cell Division',
            },
        ],
    })

    const paidPhysicsTest = await upsertTest({
        title: 'CUET Physics Mock 2',
        description: 'Paid batch mock covering motion, acceleration, and equations of motion.',
        durationMinutes: 45,
        status: 'PUBLISHED',
        source: 'AI_GENERATED',
        createdById: admin.id,
        questions: [
            {
                order: 1,
                stem: 'A body moving with uniform acceleration has a velocity of 12 m/s at t=0. After 5 s, its velocity is 20 m/s. The displacement during this interval is:',
                options: {
                    A: '60 m',
                    B: '80 m',
                    C: '100 m',
                    D: '120 m',
                    correct: 'B',
                },
                difficulty: 'HARD',
                topic: 'Equations of Motion',
            },
            {
                order: 2,
                stem: 'Which graph represents uniform velocity motion?',
                options: {
                    A: 'A curved displacement-time graph',
                    B: 'A straight displacement-time graph with constant slope',
                    C: 'A parabola on a velocity-time graph',
                    D: 'A random zig-zag velocity-time graph',
                    correct: 'B',
                },
                difficulty: 'EASY',
                topic: 'Graphs of Motion',
            },
        ],
    })

    const freeMockTest = await upsertTest({
        title: 'CUET Free Mock Demo',
        description: 'Public free mock for lead capture and the single-attempt trial flow.',
        durationMinutes: 20,
        status: 'PUBLISHED',
        source: 'MANUAL',
        createdById: admin.id,
        questions: [
            {
                order: 1,
                stem: 'Which gas do plants absorb during photosynthesis?',
                options: {
                    A: 'Oxygen',
                    B: 'Nitrogen',
                    C: 'Carbon dioxide',
                    D: 'Hydrogen',
                    correct: 'C',
                },
                difficulty: 'EASY',
                topic: 'Photosynthesis',
            },
            {
                order: 2,
                stem: 'The SI unit of force is:',
                options: {
                    A: 'Joule',
                    B: 'Newton',
                    C: 'Pascal',
                    D: 'Watt',
                    correct: 'B',
                },
                difficulty: 'EASY',
                topic: 'Units and Dimensions',
            },
            {
                order: 3,
                stem: 'Which part of the cell contains genetic material?',
                options: {
                    A: 'Cell membrane',
                    B: 'Nucleus',
                    C: 'Cytoplasm',
                    D: 'Golgi body',
                    correct: 'B',
                },
                difficulty: 'EASY',
                topic: 'Cell Basics',
            },
        ],
    })

    await upsertTest({
        title: 'Admin Draft Chemistry Set',
        description: 'Draft test for the admin test builder workflow.',
        durationMinutes: 35,
        status: 'DRAFT',
        source: 'MANUAL',
        createdById: admin.id,
        questions: [
            {
                order: 1,
                stem: 'What is the valency of oxygen in water?',
                options: {
                    A: '1',
                    B: '2',
                    C: '3',
                    D: '4',
                    correct: 'B',
                },
                difficulty: 'EASY',
                topic: 'Chemical Bonding',
            },
        ],
    })

    await ensureBatchAssignment(paidBiologyTest.id, batchA.id)
    await ensureBatchAssignment(paidPhysicsTest.id, batchB.id)
    await ensureBatchAssignment(freeMockTest.id, freeBatch.id)

    const alice = students.get('Alice Patel')
    if (alice) {
        const session = await upsertAliceSession(paidBiologyTest.id, alice.id)

        await prisma.aIFeedback.upsert({
            where: { testSessionId: session.id },
            update: {
                strengths: ['Good understanding of cell organelles', 'Correct identification of mitochondria function'],
                weaknesses: ['Needs a clearer grasp of mitosis phases'],
                actionPlan: ['Review cell division phases', 'Practice cell biology revision sets'],
                questionExplanations: {
                    3: 'Chromosomes align at the metaphase plate during metaphase.',
                },
                overallTag: 'Building Momentum',
            },
            create: {
                testSessionId: session.id,
                strengths: ['Good understanding of cell organelles', 'Correct identification of mitochondria function'],
                weaknesses: ['Needs a clearer grasp of mitosis phases'],
                actionPlan: ['Review cell division phases', 'Practice cell biology revision sets'],
                questionExplanations: {
                    3: 'Chromosomes align at the metaphase plate during metaphase.',
                },
                overallTag: 'Building Momentum',
            },
        })
    }

    await upsertDemoLead(freeMockTest.id)

    console.log('✅ Seeding complete!')
    console.log(`   Admin:    ${adminAccount.email}`)
    console.log('   Student:  tohin14001@gmail.com')
    console.log(`   Free:     ${FREE_BATCH_CODE} (${FREE_BATCH_NAME})`)
    console.log('   Public free mock: CUET Free Mock Demo')
    console.log('   (Admin and students login via email OTP. Public leads do not log in.)')
}

main()
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
