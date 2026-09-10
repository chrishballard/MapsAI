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

  const accountsRes = await mybusinessaccountmanagement.accounts.list();
  const accounts = accountsRes.data.accounts || [];

  const syncedProfiles = [];

  for (const account of accounts) {
    if (!account.name) continue;

    let nextPageToken: string | undefined;

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
  }

  // Mark profiles not in this sync as disconnected
  await prisma.profile.updateMany({
    where: {
      googleAccountId,
      id: { notIn: syncedProfiles.map((p) => p.id) },
    },
    data: { isConnected: false },
  });

  return syncedProfiles;
}
