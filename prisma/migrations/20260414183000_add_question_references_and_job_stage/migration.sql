-- CreateEnum
CREATE TYPE "DocumentImportJobStage" AS ENUM (
    'QUEUED',
    'PROCESSING_CLASSIFICATION',
    'PROCESSING_EXACT',
    'CREATING_DRAFT',
    'ENRICHING_REFERENCES',
    'VERIFYING',
    'SUCCEEDED',
    'FAILED'
);

-- CreateEnum
CREATE TYPE "QuestionReferenceKind" AS ENUM (
    'NONE',
    'PASSAGE',
    'TABLE',
    'LIST_MATCH',
    'DIAGRAM',
    'GRAPH',
    'MAP',
    'OTHER'
);

-- CreateEnum
CREATE TYPE "QuestionReferenceMode" AS ENUM (
    'TEXT',
    'SNAPSHOT',
    'HYBRID'
);

-- AlterTable
ALTER TABLE "DocumentImportJob"
    ADD COLUMN "stage" "DocumentImportJobStage" NOT NULL DEFAULT 'QUEUED',
    ADD COLUMN "progressMessage" TEXT,
    ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "QuestionReference" (
    "id" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "kind" "QuestionReferenceKind" NOT NULL,
    "mode" "QuestionReferenceMode" NOT NULL,
    "title" TEXT,
    "textContent" TEXT,
    "assetUrl" TEXT,
    "sourcePage" INTEGER,
    "bbox" JSONB,
    "confidence" DOUBLE PRECISION,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionReferenceLink" (
    "referenceId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "QuestionReferenceLink_pkey" PRIMARY KEY ("referenceId","questionId")
);

-- CreateIndex
CREATE INDEX "QuestionReference_testId_kind_idx" ON "QuestionReference"("testId", "kind");

-- CreateIndex
CREATE INDEX "QuestionReference_testId_sourcePage_idx" ON "QuestionReference"("testId", "sourcePage");

-- CreateIndex
CREATE INDEX "QuestionReferenceLink_questionId_order_idx" ON "QuestionReferenceLink"("questionId", "order");

-- AddForeignKey
ALTER TABLE "QuestionReference"
    ADD CONSTRAINT "QuestionReference_testId_fkey"
    FOREIGN KEY ("testId") REFERENCES "Test"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionReferenceLink"
    ADD CONSTRAINT "QuestionReferenceLink_referenceId_fkey"
    FOREIGN KEY ("referenceId") REFERENCES "QuestionReference"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionReferenceLink"
    ADD CONSTRAINT "QuestionReferenceLink_questionId_fkey"
    FOREIGN KEY ("questionId") REFERENCES "Question"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
