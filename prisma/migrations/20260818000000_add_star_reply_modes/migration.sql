-- CreateEnum
CREATE TYPE "ReviewReplyMode" AS ENUM ('IGNORE', 'DRAFT', 'AUTO');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN "reviewReplyMode1" "ReviewReplyMode" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "reviewReplyMode2" "ReviewReplyMode" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "reviewReplyMode3" "ReviewReplyMode" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "reviewReplyMode4" "ReviewReplyMode" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "reviewReplyMode5" "ReviewReplyMode" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "ReviewResponse" ADD COLUMN "autoApproved" BOOLEAN NOT NULL DEFAULT false;

-- Carry the legacy auto-approve behavior forward exactly: profiles that
-- auto-approved 3-5 star replies keep doing that, and 1-2 star replies keep
-- waiting for approval. Profiles without auto-approve keep drafting
-- everything (the DRAFT column default).
UPDATE "Profile"
SET "reviewReplyMode3" = 'AUTO',
    "reviewReplyMode4" = 'AUTO',
    "reviewReplyMode5" = 'AUTO'
WHERE "autoApproveReviews" = true;
