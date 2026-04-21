ALTER TABLE "TestSession"
ADD COLUMN "testSnapshot" JSONB;

ALTER TABLE "LeadTestSession"
ADD COLUMN "testSnapshot" JSONB;
