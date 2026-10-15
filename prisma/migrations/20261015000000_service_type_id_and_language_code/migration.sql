-- Google localizes structured service type names into the location's own
-- languageCode, which the API cannot change. Matching a saved service to its
-- type by that display name broke on es-419 profiles, so each row now keeps
-- the type id it pushes as, and each profile keeps its language.
--
-- Both columns are nullable and start empty: ProfileService.serviceTypeId is
-- filled in by the next successful push (or a regenerate on the
-- re-optimization page), Profile.googleLanguageCode by the next location sync.
ALTER TABLE "ProfileService" ADD COLUMN "serviceTypeId" TEXT;

ALTER TABLE "Profile" ADD COLUMN "googleLanguageCode" TEXT;
