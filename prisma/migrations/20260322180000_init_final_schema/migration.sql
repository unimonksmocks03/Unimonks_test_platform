-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'SUB_ADMIN', 'STUDENT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('ACTIVE', 'UPCOMING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "BatchKind" AS ENUM ('FREE_SYSTEM', 'STANDARD');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TestSource" AS ENUM ('MANUAL', 'AI_GENERATED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'TIMED_OUT', 'FORCE_SUBMITTED');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "phoneNormalized" TEXT,
    "role" "Role" NOT NULL DEFAULT 'STUDENT',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "otp" TEXT,
    "otpExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "BatchKind" NOT NULL DEFAULT 'STANDARD',
    "status" "BatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchStudent" (
    "batchId" UUID NOT NULL,
    "studentId" UUID NOT NULL,

    CONSTRAINT "BatchStudent_pkey" PRIMARY KEY ("batchId","studentId")
);

-- CreateTable
CREATE TABLE "Test" (
    "id" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "status" "TestStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "TestSource" NOT NULL DEFAULT 'MANUAL',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "stem" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "explanation" TEXT,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'MEDIUM',
    "topic" TEXT,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestAssignment" (
    "id" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "batchId" UUID,
    "studentId" UUID,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestSession" (
    "id" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "SessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serverDeadline" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "answers" JSONB,
    "tabSwitchCount" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER,
    "totalMarks" INTEGER NOT NULL,
    "percentage" DOUBLE PRECISION,

    CONSTRAINT "TestSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "emailNormalized" TEXT,
    "phone" TEXT,
    "phoneNormalized" TEXT,
    "isReviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadTestSession" (
    "id" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serverDeadline" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "answers" JSONB,
    "score" INTEGER,
    "totalMarks" INTEGER NOT NULL,
    "percentage" DOUBLE PRECISION,

    CONSTRAINT "LeadTestSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIFeedback" (
    "id" UUID NOT NULL,
    "testSessionId" UUID NOT NULL,
    "strengths" JSONB NOT NULL,
    "weaknesses" JSONB NOT NULL,
    "actionPlan" JSONB NOT NULL,
    "questionExplanations" JSONB NOT NULL,
    "overallTag" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_phoneNormalized_idx" ON "User"("phoneNormalized");
CREATE UNIQUE INDEX "User_single_active_admin_key"
    ON "User"("role")
    WHERE "role" = 'ADMIN' AND "status" = 'ACTIVE';

CREATE UNIQUE INDEX "Batch_code_key" ON "Batch"("code");
CREATE INDEX "Batch_kind_idx" ON "Batch"("kind");
CREATE UNIQUE INDEX "Batch_single_free_system_kind_key"
    ON "Batch"("kind")
    WHERE "kind" = 'FREE_SYSTEM';

CREATE INDEX "BatchStudent_studentId_idx" ON "BatchStudent"("studentId");

CREATE INDEX "Test_createdById_idx" ON "Test"("createdById");

CREATE INDEX "Question_testId_order_idx" ON "Question"("testId", "order");

CREATE INDEX "TestAssignment_testId_batchId_idx" ON "TestAssignment"("testId", "batchId");
CREATE INDEX "TestAssignment_studentId_idx" ON "TestAssignment"("studentId");
CREATE UNIQUE INDEX "TestAssignment_testId_batchId_unique_active"
    ON "TestAssignment"("testId", "batchId")
    WHERE "batchId" IS NOT NULL;
CREATE UNIQUE INDEX "TestAssignment_testId_studentId_unique_active"
    ON "TestAssignment"("testId", "studentId")
    WHERE "studentId" IS NOT NULL;

CREATE INDEX "TestSession_testId_studentId_idx" ON "TestSession"("testId", "studentId");
CREATE INDEX "TestSession_studentId_status_idx" ON "TestSession"("studentId", "status");
CREATE UNIQUE INDEX "TestSession_testId_studentId_attemptNumber_key" ON "TestSession"("testId", "studentId", "attemptNumber");
CREATE UNIQUE INDEX "TestSession_active_in_progress_key"
    ON "TestSession"("testId", "studentId")
    WHERE "status" = 'IN_PROGRESS';

CREATE INDEX "Lead_emailNormalized_idx" ON "Lead"("emailNormalized");
CREATE INDEX "Lead_phoneNormalized_idx" ON "Lead"("phoneNormalized");
CREATE INDEX "Lead_isReviewed_createdAt_idx" ON "Lead"("isReviewed", "createdAt");

CREATE INDEX "LeadTestSession_leadId_status_idx" ON "LeadTestSession"("leadId", "status");
CREATE UNIQUE INDEX "LeadTestSession_testId_leadId_key" ON "LeadTestSession"("testId", "leadId");
CREATE UNIQUE INDEX "LeadTestSession_active_in_progress_key"
    ON "LeadTestSession"("testId", "leadId")
    WHERE "status" = 'IN_PROGRESS';

CREATE UNIQUE INDEX "AIFeedback_testSessionId_key" ON "AIFeedback"("testSessionId");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- Create checks
ALTER TABLE "Lead"
    ADD CONSTRAINT "Lead_has_contact_check"
    CHECK ("emailNormalized" IS NOT NULL OR "phoneNormalized" IS NOT NULL);

ALTER TABLE "TestAssignment"
    ADD CONSTRAINT "TestAssignment_target_check"
    CHECK (
        ("batchId" IS NOT NULL AND "studentId" IS NULL)
        OR ("batchId" IS NULL AND "studentId" IS NOT NULL)
    );

-- AddForeignKey
ALTER TABLE "BatchStudent" ADD CONSTRAINT "BatchStudent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BatchStudent" ADD CONSTRAINT "BatchStudent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Test" ADD CONSTRAINT "Test_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Question" ADD CONSTRAINT "Question_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestAssignment" ADD CONSTRAINT "TestAssignment_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestAssignment" ADD CONSTRAINT "TestAssignment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestAssignment" ADD CONSTRAINT "TestAssignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestSession" ADD CONSTRAINT "TestSession_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestSession" ADD CONSTRAINT "TestSession_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadTestSession" ADD CONSTRAINT "LeadTestSession_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadTestSession" ADD CONSTRAINT "LeadTestSession_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIFeedback" ADD CONSTRAINT "AIFeedback_testSessionId_fkey" FOREIGN KEY ("testSessionId") REFERENCES "TestSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
