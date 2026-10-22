-- One Profile row per Google location. The ten locations stored twice were
-- merged on 2026-10-22; if a location is stored twice again this fails, and
-- the deploy with it, instead of indexing over the duplicate.
-- CreateIndex
CREATE UNIQUE INDEX "Profile_locationName_key" ON "Profile"("locationName");
