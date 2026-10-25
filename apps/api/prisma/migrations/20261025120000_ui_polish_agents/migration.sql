-- Agents: NIN → Government Tag, split name into first/last (name kept as "First Last").
ALTER TABLE "Agent" RENAME COLUMN "nin" TO "tag";
ALTER TABLE "Agent" ADD COLUMN "firstName" TEXT, ADD COLUMN "lastName" TEXT;
UPDATE "Agent" SET "firstName" = split_part(btrim("name"), ' ', 1),
  "lastName" = NULLIF(btrim(substr(btrim("name"), length(split_part(btrim("name"), ' ', 1)) + 1)), '')
  WHERE "firstName" IS NULL;
CREATE INDEX "Agent_tag_idx" ON "Agent"("tag");

-- Incident ↔ agent assignments.
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "assignedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentTask_agentId_incidentId_key" ON "AgentTask"("agentId", "incidentId");
CREATE INDEX "AgentTask_incidentId_idx" ON "AgentTask"("incidentId");
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- New alarms now badge "Alarms → New" (Duress/Panic lists only show handled alarms).
UPDATE "Notification" SET "target" = 'alarms.new' WHERE "target" IN ('alarms.panic', 'alarms.duress');
