import { createGoogleClient } from "./google";
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

interface AccountsListResponse {
  accounts?: Array<{ name: string; accountName?: string }>;
  nextPageToken?: string;
}

interface LocationsListResponse {
  locations?: GoogleLocation[];
  nextPageToken?: string;
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

export async function syncLocationsForAccount(googleAccountId: string) {
  const oauth2Client = await createGoogleClient(googleAccountId);

  // Use the v4 umbrella API endpoint (has quota via Google My Business API allowlist)
  // instead of the individual sub-API clients (which may have 0 quota)
  const accountsRes = await oauth2Client.request<AccountsListResponse>({
    url: "https://mybusiness.googleapis.com/v4/accounts",
    method: "GET",
  });

  const accounts = accountsRes.data.accounts || [];
  const syncedProfiles = [];

  for (const account of accounts) {
    if (!account.name) continue;

    let nextPageToken: string | undefined;

    do {
      let url = `https://mybusiness.googleapis.com/v4/${account.name}/locations?readMask=name,title,storefrontAddress,phoneNumbers,categories,websiteUri,metadata&pageSize=100`;
      if (nextPageToken) {
        url += `&pageToken=${encodeURIComponent(nextPageToken)}`;
      }

      const locationsRes = await oauth2Client.request<LocationsListResponse>({
        url,
        method: "GET",
      });

      const locations = locationsRes.data.locations || [];
      nextPageToken = locationsRes.data.nextPageToken;

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
