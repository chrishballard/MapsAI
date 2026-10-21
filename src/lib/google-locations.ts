import { google } from "googleapis";
import { createGoogleClient } from "./google";
import { fetchGoogleProfileState } from "./google-business-info";
import { prisma } from "./prisma";

interface GoogleLocation {
  name: string; // Resource name like "locations/123"
  title: string;
  storefrontAddress?: {
    addressLines?: string[];
    locality?: string;
    administrativeArea?: string;
    postalCode?: string;
  };
  phoneNumbers?: { primaryPhone?: string };
  categories?: { primaryCategory?: { displayName?: string } };
  websiteUri?: string;
  metadata?: { placeId?: string };
}

function formatAddress(address: GoogleLocation["storefrontAddress"]): string | null {
  if (!address) return null;
  const parts = [
    address.addressLines?.join(", "),
    address.locality,
    address.administrativeArea,
    address.postalCode,
  ].filter(Boolean);
  return parts.join(", ") || null;
}

/**
 * Read back Google's own description and service items for a location and
 * store them on the profile.
 *
 * `locations.list` will not return `profile` or `serviceItems`, so this is a
 * separate `locations.get` per location. It is best-effort: a location we
 * cannot read (permissions, a transient 5xx) leaves the stored values alone
 * rather than overwriting them with a false blank, and never fails the sync
 * that was really about the location list.
 */
async function syncGoogleProfileState(params: {
  googleAccountId: string;
  profileId: string;
  locationName: string;
}): Promise<boolean> {
  try {
    const state = await fetchGoogleProfileState({
      googleAccountId: params.googleAccountId,
      locationName: params.locationName,
    });
    await prisma.profile.update({
      where: { id: params.profileId },
      data: {
        googleDescription: state.description,
        googleServiceItems: state.serviceItems as never,
        // A read without languageCode says nothing about the language, so it
        // must not erase a stored "es-419" (that value is what warns before
        // a service push on a non-English profile).
        ...(state.languageCode ? { googleLanguageCode: state.languageCode } : {}),
        googleProfileSyncedAt: new Date(),
      },
    });
    return true;
  } catch (err) {
    console.warn(
      `[location-sync] Could not read Google profile state for ${params.locationName}:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

export async function syncLocationsForAccount(googleAccountId: string) {
  const oauth2Client = await createGoogleClient(googleAccountId);

  // Use the My Business sub-API clients (these have quota on the MapsAI project)
  const mybusinessbusinessinformation = google.mybusinessbusinessinformation({
    version: "v1",
    auth: oauth2Client,
  });

  const mybusinessaccountmanagement = google.mybusinessaccountmanagement({
    version: "v1",
    auth: oauth2Client,
  });

  // accounts.list returns at most 20 accounts a page (the personal account
  // plus every location group the login belongs to). Reading only the first
  // page silently dropped every location under account 21 onwards, and the
  // disconnect sweep below then marked them disconnected.
  const accounts = [];
  let accountsPageToken: string | undefined;
  do {
    const accountsRes = await mybusinessaccountmanagement.accounts.list({
      pageSize: 20,
      pageToken: accountsPageToken,
    });
    accounts.push(...(accountsRes.data.accounts || []));
    accountsPageToken = accountsRes.data.nextPageToken || undefined;
  } while (accountsPageToken);

  const syncedProfiles = [];
  // Location groups that answered with no locations at all. An empty answer
  // proves nothing about the profiles stored under that group, so the sweep
  // below leaves them alone.
  const emptyAccounts = new Set<string>();

  for (const account of accounts) {
    if (!account.name) continue;

    let nextPageToken: string | undefined;
    const syncedBefore = syncedProfiles.length;

    do {
      const locationsRes = await mybusinessbusinessinformation.accounts.locations.list({
        parent: account.name,
        readMask: "name,title,storefrontAddress,phoneNumbers,categories,websiteUri,metadata",
        pageSize: 100,
        pageToken: nextPageToken,
      });

      const locations = (locationsRes.data.locations || []) as GoogleLocation[];
      nextPageToken = locationsRes.data.nextPageToken || undefined;

      for (const location of locations) {
        if (!location.name) continue;

        const profile = await prisma.profile.upsert({
          where: {
            googleAccountId_locationName: {
              googleAccountId,
              locationName: location.name,
            },
          },
          create: {
            googleAccountId,
            locationName: location.name,
            accountResourceName: account.name,
            name: location.title || "Unnamed Location",
            address: formatAddress(location.storefrontAddress),
            phone: location.phoneNumbers?.primaryPhone || null,
            category: location.categories?.primaryCategory?.displayName || null,
            websiteUrl: location.websiteUri || null,
            placeId: location.metadata?.placeId || null,
            isConnected: true,
          },
          update: {
            accountResourceName: account.name,
            name: location.title || "Unnamed Location",
            address: formatAddress(location.storefrontAddress),
            phone: location.phoneNumbers?.primaryPhone || null,
            category: location.categories?.primaryCategory?.displayName || null,
            websiteUrl: location.websiteUri || null,
            placeId: location.metadata?.placeId || null,
            isConnected: true,
          },
        });

        // What Google itself shows for this location. Kept apart from the
        // RankMaps drafts in ProfileDescription / ProfileService so the vault
        // export can say which of the two it is quoting.
        await syncGoogleProfileState({
          googleAccountId,
          profileId: profile.id,
          locationName: location.name,
        });

        syncedProfiles.push(profile);
      }
    } while (nextPageToken);

    if (syncedProfiles.length === syncedBefore) emptyAccounts.add(account.name);
  }

  // Mark profiles not in this sync as disconnected. The publish worker then
  // demotes their due posts to DRAFT, so only a listing that actually came
  // back may disconnect anything. A failed page already threw above, before
  // this point. Google answering with nothing is not proof either: an empty
  // listing for the whole login, or for the group a profile sits under,
  // keeps those profiles as they were until a sync that does list.
  const missing = await prisma.profile.findMany({
    where: {
      googleAccountId,
      isConnected: true,
      id: { notIn: syncedProfiles.map((p) => p.id) },
    },
    select: { id: true, accountResourceName: true },
  });

  if (missing.length > 0 && syncedProfiles.length === 0) {
    console.warn(
      `[location-sync] Google listed no locations for ${googleAccountId}; keeping its ${missing.length} connected profile(s) as they are`
    );
    return syncedProfiles;
  }

  const kept = missing.filter(
    (p) => p.accountResourceName && emptyAccounts.has(p.accountResourceName)
  );
  if (kept.length > 0) {
    console.warn(
      `[location-sync] ${[...new Set(kept.map((p) => p.accountResourceName))].join(", ")} listed no locations; keeping ${kept.length} connected profile(s) under them as they are`
    );
  }

  const keptIds = new Set(kept.map((p) => p.id));
  const gone = missing.filter((p) => !keptIds.has(p.id)).map((p) => p.id);
  if (gone.length > 0) {
    await prisma.profile.updateMany({
      where: { googleAccountId, id: { in: gone } },
      data: { isConnected: false },
    });
  }

  return syncedProfiles;
}
