CREATE TYPE "DocumentImportJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "DocumentImportJob" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "testId" UUID,
    "status" "DocumentImportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileData" BYTEA,
    "requestedTitle" TEXT,
    "requestedCount" INTEGER,
    "message" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentImportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DocumentImportJob_adminId_createdAt_idx" ON "DocumentImportJob"("adminId", "createdAt");
CREATE INDEX "DocumentImportJob_adminId_status_createdAt_idx" ON "DocumentImportJob"("adminId", "status", "createdAt");
CREATE INDEX "DocumentImportJob_status_createdAt_idx" ON "DocumentImportJob"("status", "createdAt");

ALTER TABLE "DocumentImportJob"
ADD CONSTRAINT "DocumentImportJob_adminId_fkey"
FOREIGN KEY ("adminId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentImportJob"
ADD CONSTRAINT "DocumentImportJob_testId_fkey"
FOREIGN KEY ("testId") REFERENCES "Test"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
