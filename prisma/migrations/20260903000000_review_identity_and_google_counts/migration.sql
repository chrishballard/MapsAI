-- Google's own review totals for the location (what Maps and Search show).
ALTER TABLE "Profile"
  ADD COLUMN "googleReviewCount" INTEGER,
  ADD COLUMN "googleAverageRating" DOUBLE PRECISION,
  ADD COLUMN "reviewStatsSyncedAt" TIMESTAMP(3);

-- Stable review identity + soft-removal marker.
ALTER TABLE "Review"
  ADD COLUMN "googleReviewKey" TEXT,
  ADD COLUMN "removedAt" TIMESTAMP(3);

-- The account segment of googleReviewId is mutable (a real account id vs the
-- `accounts/-` wildcard), which is how the same review came to be stored
-- twice. Identity is the locations/.../reviews/... suffix.
UPDATE "Review"
SET "googleReviewKey" = regexp_replace("googleReviewId", '^accounts/[^/]+/', '');

-- Merge duplicate rows: one survivor per (profile, key). Prefer the row whose
-- reply is furthest along (a PUBLISHED reply is live on Google and must be the
-- one we keep); when both twins published, the later publish is the one
-- actually live (a reply PUT replaces the previous), so newest publishedAt
-- wins; then the oldest row. Everything else is deleted; their
-- ReviewResponse rows cascade.
CREATE TEMP TABLE review_dupes AS
SELECT id, "profileId", "googleReviewKey", rn
FROM (
  SELECT r.id, r."profileId", r."googleReviewKey",
    ROW_NUMBER() OVER (
      PARTITION BY r."profileId", r."googleReviewKey"
      ORDER BY
        CASE rr.status
          WHEN 'PUBLISHED' THEN 0
          WHEN 'APPROVED'  THEN 1
          WHEN 'DRAFTED'   THEN 2
          WHEN 'PENDING'   THEN 3
          WHEN 'FAILED'    THEN 4
          WHEN 'SKIPPED'   THEN 5
          ELSE 6
        END,
        rr."publishedAt" DESC NULLS LAST,
        r."createdAt" ASC,
        r.id ASC
    ) AS rn
  FROM "Review" r
  LEFT JOIN "ReviewResponse" rr ON rr."reviewId" = r.id
) ranked
WHERE "profileId" IN (
  SELECT "profileId" FROM "Review"
  GROUP BY "profileId", "googleReviewKey" HAVING COUNT(*) > 1
);

-- If a twin recorded that the review was already answered outside
-- RankMaps, the survivor must carry that flag too — unless the survivor
-- holds our own PUBLISHED reply. In that case the twin was created by a
-- later sync that saw *our* reply on the review and mis-flagged it; the
-- PUBLISHED response is the record of what's live and must not be masked.
UPDATE "Review" s
SET "repliedExternally" = true
FROM review_dupes keep
JOIN "Review" twin ON twin."profileId" = keep."profileId"
  AND twin."googleReviewKey" = keep."googleReviewKey"
  AND twin.id <> keep.id
WHERE keep.rn = 1
  AND s.id = keep.id
  AND twin."repliedExternally" = true
  AND NOT EXISTS (
    SELECT 1 FROM "ReviewResponse" x
    WHERE x."reviewId" = keep.id AND x.status = 'PUBLISHED'
  );

DELETE FROM "Review"
WHERE id IN (SELECT id FROM review_dupes WHERE rn > 1);

DROP TABLE review_dupes;

ALTER TABLE "Review" ALTER COLUMN "googleReviewKey" SET NOT NULL;

CREATE UNIQUE INDEX "Review_profileId_googleReviewKey_key"
  ON "Review"("profileId", "googleReviewKey");

CREATE INDEX "Review_profileId_removedAt_idx"
  ON "Review"("profileId", "removedAt");
