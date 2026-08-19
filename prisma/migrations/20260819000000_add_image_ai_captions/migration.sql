-- AlterTable
ALTER TABLE "ProfileImage" ADD COLUMN     "aiDescription" TEXT,
ADD COLUMN     "aiTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "aiGeneric" BOOLEAN,
ADD COLUMN     "captionedAt" TIMESTAMP(3);
