-- Incident sources (user | agent | call_centre | ecc), agent reporters, AI title/summary
ALTER TABLE "Incident" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "Incident" ADD COLUMN "agentReporterId" TEXT;
ALTER TABLE "Incident" ADD COLUMN "aiTitle" TEXT;
ALTER TABLE "Incident" ADD COLUMN "aiSummary" TEXT;
ALTER TABLE "Incident" ADD COLUMN "aiAt" TIMESTAMP(3);
CREATE INDEX "Incident_source_idx" ON "Incident"("source");
CREATE INDEX "Incident_agentReporterId_idx" ON "Incident"("agentReporterId");
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_agentReporterId_fkey" FOREIGN KEY ("agentReporterId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- "Send to Vigilante": why the agent was sent + optional note
ALTER TABLE "AgentTask" ADD COLUMN "purpose" TEXT;
ALTER TABLE "AgentTask" ADD COLUMN "note" TEXT;
