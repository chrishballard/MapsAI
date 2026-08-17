-- AlterTable
ALTER TABLE "Profile" ADD COLUMN "reviewsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "reviewInstructions" TEXT;
