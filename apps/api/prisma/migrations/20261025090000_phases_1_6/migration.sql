-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "approvedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "device" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION,
ADD COLUMN     "nin" TEXT;

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "actedAt" TIMESTAMP(3),
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedBy" TEXT;

-- AlterTable
ALTER TABLE "Dispatch" ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "Alarm" ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lga" TEXT,
ADD COLUMN     "lng" DOUBLE PRECISION,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedBy" TEXT,
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "AiMessage" ADD COLUMN     "meta" JSONB,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'done';

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "os" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomelandGroup" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "lga" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomelandGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportCategory" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "sendAgentCount" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentMedia" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storage" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT,
    "mime" TEXT,
    "size" INTEGER,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiExport" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "csv" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_publicId_key" ON "Device"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_label_key" ON "Device"("label");

-- CreateIndex
CREATE UNIQUE INDEX "HomelandGroup_publicId_key" ON "HomelandGroup"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "HomelandGroup_name_key" ON "HomelandGroup"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCategory_publicId_key" ON "ReportCategory"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCategory_name_key" ON "ReportCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentMedia_publicId_key" ON "IncidentMedia"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "AiExport_publicId_key" ON "AiExport"("publicId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityId_idx" ON "AuditLog"("entityId");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_lga_idx" ON "User"("lga");

-- CreateIndex
CREATE INDEX "Agent_status_idx" ON "Agent"("status");

-- CreateIndex
CREATE INDEX "Agent_lga_idx" ON "Agent"("lga");

-- CreateIndex
CREATE INDEX "Incident_status_idx" ON "Incident"("status");

-- CreateIndex
CREATE INDEX "Incident_createdAt_idx" ON "Incident"("createdAt");

-- CreateIndex
CREATE INDEX "Alarm_status_type_idx" ON "Alarm"("status", "type");

-- AddForeignKey
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "HomelandGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "HomelandGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ReportCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentMedia" ADD CONSTRAINT "IncidentMedia_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alarm" ADD CONSTRAINT "Alarm_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Data backfill: Phase 0 stored agent group + incident category as free text.
-- Promote them to real tables, link, then drop the old Agent.group column.
-- ---------------------------------------------------------------------------
INSERT INTO "HomelandGroup" ("id", "publicId", "name", "updatedAt")
SELECT 'grp_' || md5(g), substr(md5('pub' || g), 1, 20), g, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "group" AS g FROM "Agent" WHERE "group" IS NOT NULL) s;
UPDATE "Agent" a SET "groupId" = h."id" FROM "HomelandGroup" h WHERE a."group" = h."name";
ALTER TABLE "Agent" DROP COLUMN "group";

INSERT INTO "ReportCategory" ("id", "publicId", "name", "updatedAt")
SELECT 'cat_' || md5(c), substr(md5('pub' || c), 1, 20), c, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "category" AS c FROM "Incident") s;
UPDATE "Incident" i SET "categoryId" = c."id" FROM "ReportCategory" c WHERE i."category" = c."name";

INSERT INTO "Device" ("id", "publicId", "label")
SELECT 'dev_' || md5(d), substr(md5('pub' || d), 1, 20), d
FROM (SELECT DISTINCT "device" AS d FROM "User" WHERE "device" IS NOT NULL) s;

-- ---------------------------------------------------------------------------
-- Authoritative search: pg_trgm GIN indexes over each entity's search text.
-- Expressions MUST match apps/api/src/search.ts (SEARCH_EXPR).
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "User_search_trgm" ON "User" USING gin ((lower(coalesce("name",'') || ' ' || coalesce("phone",'') || ' ' || coalesce("email",'') || ' ' || coalesce("lga",'') || ' ' || coalesce("device",''))) gin_trgm_ops);
CREATE INDEX "Agent_search_trgm" ON "Agent" USING gin ((lower(coalesce("name",'') || ' ' || coalesce("phone",'') || ' ' || coalesce("email",'') || ' ' || coalesce("lga",''))) gin_trgm_ops);
CREATE INDEX "Incident_search_trgm" ON "Incident" USING gin ((lower(coalesce("category",'') || ' ' || coalesce("details",'') || ' ' || coalesce("location",'') || ' ' || coalesce("lga",''))) gin_trgm_ops);
CREATE INDEX "Alarm_search_trgm" ON "Alarm" USING gin ((lower(coalesce("sender",'') || ' ' || coalesce("phone",'') || ' ' || coalesce("location",'') || ' ' || coalesce("type",''))) gin_trgm_ops);
CREATE INDEX "SecurityAlert_search_trgm" ON "SecurityAlert" USING gin ((lower(coalesce("title",'') || ' ' || coalesce("body",'') || ' ' || coalesce("lga",''))) gin_trgm_ops);
