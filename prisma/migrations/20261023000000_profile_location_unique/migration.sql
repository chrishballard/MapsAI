-- One Profile row per Google location. The ten locations stored twice were
-- merged on 2026-10-22; if a location is stored twice again this fails, and
-- the deploy with it, instead of indexing over the duplicate. Prisma then
-- records it as failed and refuses later deploys (P3009) until the duplicate
-- is removed and it is marked rolled back:
--   npx prisma migrate resolve --rolled-back 20261023000000_profile_location_unique
-- CreateIndex
CREATE UNIQUE INDEX "Profile_locationName_key" ON "Profile"("locationName");
