-- Caller details for Call Centre / ECC reports + anonymous flag (any source)
ALTER TABLE "Incident" ADD COLUMN "reporterName" TEXT;
ALTER TABLE "Incident" ADD COLUMN "reporterPhone" TEXT;
ALTER TABLE "Incident" ADD COLUMN "reporterEmail" TEXT;
ALTER TABLE "Incident" ADD COLUMN "reporterLga" TEXT;
ALTER TABLE "Incident" ADD COLUMN "anonymous" BOOLEAN NOT NULL DEFAULT false;
