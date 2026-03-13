import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

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

async function main() {
    console.log('🌱 Seeding database...')

    // ── Admin ──
    await prisma.user.upsert({
        where: { email: 'tohin1400@gmail.com' },
        update: {},
        create: {
            email: 'tohin1400@gmail.com',
            name: 'Admin User',
            role: 'ADMIN',
            status: 'ACTIVE',
        },
    })

    // ── Teachers ──
    const teacher1 = await prisma.user.upsert({
        where: { email: 'tohin14000@gmail.com' },
        update: {},
        create: {
            email: 'tohin14000@gmail.com',
            name: 'Sarah Johnson',
            role: 'TEACHER',
            status: 'ACTIVE',
        },
    })

    const teacher2 = await prisma.user.upsert({
        where: { email: 'michael@unimonk.com' },
        update: {},
        create: {
            email: 'michael@unimonk.com',
            name: 'Michael Chen',
            role: 'TEACHER',
            status: 'ACTIVE',
        },
    })

    // ── Students ──
    type Student = { id: string;[key: string]: unknown }
    const students = new Map<string, Student>()
    for (let i = 0; i < studentNames.length; i++) {
        const baseEmail = `${studentNames[i].split(' ')[0].toLowerCase()}@student.com`
        // Use real Gmail for Alice (first student) for dev testing
        const email = i === 0 ? 'tohin14001@gmail.com' : baseEmail
        const student = await prisma.user.upsert({
            where: { email },
            update: {},
            create: {
                email,
                name: studentNames[i],
                role: 'STUDENT',
                status: 'ACTIVE',
            },
        })
        students.set(studentNames[i], student)
    }

    // ── Batches ──
    const batch1 = await prisma.batch.upsert({
        where: { code: 'BATCH-2025-A' },
        update: {},
        create: {
            name: 'NEET Batch A',
            code: 'BATCH-2025-A',
            teacherId: teacher1.id,
            status: 'ACTIVE',
        },
    })

    const batch2 = await prisma.batch.upsert({
        where: { code: 'BATCH-2025-B' },
        update: {},
        create: {
            name: 'NEET Batch B',
            code: 'BATCH-2025-B',
            teacherId: teacher2.id,
            status: 'ACTIVE',
        },
    })

    await prisma.batch.upsert({
        where: { code: 'BATCH-2025-C' },
        update: {},
        create: {
            name: 'JEE Batch C',
            code: 'BATCH-2025-C',
            teacherId: teacher1.id,
            status: 'UPCOMING',
        },
    })

    // ── Enroll students ──
    const batchAStudents = ['Alice Patel', 'Bob Kumar', 'Charlie Singh', 'Diana Sharma', 'Ethan Verma']
    const batchBStudents = ['Fiona Gupta', 'George Reddy', 'Hannah Nair', 'Isaac Thomas', 'Julia Das']

    for (const name of batchAStudents) {
        const student = students.get(name)
        if (student) {
            await prisma.batchStudent.upsert({
                where: { batchId_studentId: { batchId: batch1.id, studentId: student.id } },
                update: {},
                create: { batchId: batch1.id, studentId: student.id },
            })
        }
    }

    for (const name of batchBStudents) {
        const student = students.get(name)
        if (student) {
            await prisma.batchStudent.upsert({
                where: { batchId_studentId: { batchId: batch2.id, studentId: student.id } },
                update: {},
                create: { batchId: batch2.id, studentId: student.id },
            })
        }
    }

    // ── Tests ──
    const test1 = await prisma.test.create({
        data: {
            teacherId: teacher1.id,
            title: 'Biology: Cell Structure',
            description: 'A comprehensive test covering cell organelles, membrane transport, and cell division.',
            durationMinutes: 30,
            status: 'PUBLISHED',
            source: 'MANUAL',
            questions: {
                create: [
                    {
                        order: 1,
                        stem: 'Which organelle is known as the "powerhouse" of the cell?',
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
                        stem: 'What is the primary function of the Rough Endoplasmic Reticulum?',
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
            },
        },
    })

    const test2 = await prisma.test.create({
        data: {
            teacherId: teacher2.id,
            title: 'Physics: Kinematics Basics',
            description: 'Test on motion, velocity, acceleration and equations of motion.',
            durationMinutes: 45,
            status: 'PUBLISHED',
            source: 'AI_GENERATED',
            questions: {
                create: [
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
                ],
            },
        },
    })

    // ── Assignments ──
    await prisma.testAssignment.create({
        data: { testId: test1.id, batchId: batch1.id },
    })
    await prisma.testAssignment.create({
        data: { testId: test2.id, batchId: batch2.id },
    })

    // ── Sample test session with AI feedback ──
    const alice = students.get('Alice Patel')
    if (alice) {
        const session = await prisma.testSession.create({
            data: {
                testId: test1.id,
                studentId: alice.id,
                status: 'SUBMITTED',
                serverDeadline: new Date(Date.now() + 30 * 60 * 1000),
                submittedAt: new Date(),
                answers: { 1: 'B', 2: 'B', 3: 'A' },
                tabSwitchCount: 1,
                score: 2,
                totalMarks: 3,
                percentage: 66.67,
            },
        })

        await prisma.aIFeedback.create({
            data: {
                testSessionId: session.id,
                strengths: ['Good understanding of cell organelles', 'Correct identification of mitochondria function'],
                weaknesses: ['Confusion in mitosis phases'],
                actionPlan: ['Review cell division phases', 'Practice mitosis vs meiosis comparison'],
                questionExplanations: {
                    3: 'Chromosomes align at the metaphase plate during Metaphase, not Prophase.',
                },
                overallTag: 'Intermediate',
            },
        })
    }

    console.log('✅ Seeding complete!')
    console.log('   Admin:    tohin1400@gmail.com')
    console.log('   Teacher:  tohin14000@gmail.com')
    console.log('   Teacher:  michael@unimonk.com')
    console.log('   Student:  tohin14001@gmail.com')
    console.log('   (All users login via email OTP — no passwords)')
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
