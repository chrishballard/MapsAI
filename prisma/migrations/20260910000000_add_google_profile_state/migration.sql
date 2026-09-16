-- Google's own description and service items for the location, refreshed by
-- the location sync (locations.get with readMask=profile,serviceItems).
--
-- ProfileDescription / ProfileService only ever held what RankMaps drafted
-- and pushed, so a location the client wrote themselves in GBP read as blank
-- everywhere downstream. These columns hold what Google actually returns.
--   NULL  = never synced
--   ''    = Google returned no description
--   '[]'  = Google returned no service items
ALTER TABLE "Profile"
  ADD COLUMN "googleDescription" TEXT,
  ADD COLUMN "googleServiceItems" JSONB,
  ADD COLUMN "googleProfileSyncedAt" TIMESTAMP(3);
