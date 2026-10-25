-- CreateTable
CREATE TABLE "SecurityAlert" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "lga" TEXT NOT NULL DEFAULT 'All',
    "userType" TEXT NOT NULL DEFAULT 'All',
    "group" TEXT NOT NULL DEFAULT 'All',
    "sender" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecurityAlert_publicId_key" ON "SecurityAlert"("publicId");
