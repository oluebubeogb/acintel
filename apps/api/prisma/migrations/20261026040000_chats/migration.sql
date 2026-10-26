-- Agent <-> control-room direct messages
CREATE TABLE "ChatThread" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPreview" TEXT,
    "lastSender" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatThread_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "adminId" TEXT,
    "adminName" TEXT,
    "body" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "file" TEXT,
    "mime" TEXT,
    "size" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChatThread_publicId_key" ON "ChatThread"("publicId");
CREATE UNIQUE INDEX "ChatThread_agentId_key" ON "ChatThread"("agentId");
CREATE INDEX "ChatThread_lastMessageAt_idx" ON "ChatThread"("lastMessageAt");
CREATE UNIQUE INDEX "ChatMessage_publicId_key" ON "ChatMessage"("publicId");
CREATE INDEX "ChatMessage_threadId_createdAt_idx" ON "ChatMessage"("threadId", "createdAt");
CREATE INDEX "ChatMessage_sender_readAt_idx" ON "ChatMessage"("sender", "readAt");
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
