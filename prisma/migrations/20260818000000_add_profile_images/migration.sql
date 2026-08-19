-- CreateEnum
CREATE TYPE "ProfileImageSource" AS ENUM ('GBP', 'TEAM', 'CLIENT');

-- CreateEnum
CREATE TYPE "ProfileImageStatus" AS ENUM ('PENDING', 'APPROVED', 'HIDDEN');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "mediaSyncedAt" TIMESTAMP(3),
ADD COLUMN     "uploadToken" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "imageId" TEXT;

-- CreateTable
CREATE TABLE "ProfileImage" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "source" "ProfileImageSource" NOT NULL,
    "status" "ProfileImageStatus" NOT NULL DEFAULT 'APPROVED',
    "publicToken" TEXT NOT NULL,
    "data" BYTEA,
    "contentType" TEXT,
    "byteSize" INTEGER,
    "googleMediaName" TEXT,
    "googleUrl" TEXT,
    "thumbnailUrl" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "category" TEXT,
    "uploadedBy" TEXT,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfileImage_publicToken_key" ON "ProfileImage"("publicToken");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileImage_googleMediaName_key" ON "ProfileImage"("googleMediaName");

-- CreateIndex
CREATE INDEX "ProfileImage_profileId_status_idx" ON "ProfileImage"("profileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_uploadToken_key" ON "Profile"("uploadToken");

-- CreateIndex
CREATE INDEX "Post_imageId_idx" ON "Post"("imageId");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "ProfileImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileImage" ADD CONSTRAINT "ProfileImage_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
