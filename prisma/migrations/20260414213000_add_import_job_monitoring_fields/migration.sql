-- CreateEnum
CREATE TYPE "DocumentImportLane" AS ENUM ('STABLE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "DocumentImportDecision" AS ENUM ('EXACT_ACCEPTED', 'REVIEW_REQUIRED', 'FAILED_WITH_REASON');

-- AlterTable
ALTER TABLE "DocumentImportJob"
ADD COLUMN "stageStartedAt" TIMESTAMP(3),
ADD COLUMN "lane" "DocumentImportLane",
ADD COLUMN "routingMode" TEXT,
ADD COLUMN "selectedStrategy" TEXT,
ADD COLUMN "resultStrategy" TEXT,
ADD COLUMN "decision" "DocumentImportDecision",
ADD COLUMN "tokenCostUsd" DOUBLE PRECISION,
ADD COLUMN "totalElapsedMs" INTEGER;

-- CreateIndex
CREATE INDEX "DocumentImportJob_lane_status_createdAt_idx" ON "DocumentImportJob"("lane", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentImportJob_stage_status_createdAt_idx" ON "DocumentImportJob"("stage", "status", "createdAt");
