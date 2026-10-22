import { google } from "googleapis";
import { createGoogleClient } from "./google";
import { fetchGoogleProfileState } from "./google-business-info";
import { prisma } from "./prisma";
import { isPrismaError } from "./prisma-errors";

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

/**
 * Which stored row a listed location belongs to, for this login.
 *
 * A location's resource name is Google's and global, but a Profile row was
 * unique per (login, location). When two agency logins can both manage a
 * location, each login's sync made its own row: ten locations were stored
 * twice by 2026-10-22, and Blokk's two copies each published a post on the
 * same four days in April 2026. So a location keeps one row. A login that
 * finds it stored under another login leaves it there while that login
 * still serves it (the row is connected and the login's grant still works),
 * and takes the row over (history and all) once that login has lost it or
 * been revoked: a revoked login never syncs again, so its rows would stay
 * "connected" forever with nobody able to post. The pairs made before this
 * were merged on 2026-10-22, and locationName is now unique, so two logins
 * syncing a new location at once can't store it twice either: the second
 * write fails and that login leaves the row to the first.
 */
async function storedRowFor(
  googleAccountId: string,
  locationName: string
): Promise<{ action: "upsert" } | { action: "skip" } | { action: "adopt"; id: string }> {
  const rows = await prisma.profile.findMany({
    where: { locationName },
    select: {
      id: true,
      googleAccountId: true,
      isConnected: true,
      googleAccount: { select: { needsReauth: true } },
    },
    orderBy: [{ isOnboarded: "desc" }, { updatedAt: "desc" }],
  });
  if (rows.length === 0 || rows.some((r) => r.googleAccountId === googleAccountId)) {
    return { action: "upsert" };
  }
  if (rows.some((r) => r.isConnected && !r.googleAccount.needsReauth)) {
    return { action: "skip" };
  }
  return { action: "adopt", id: rows[0].id };
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
  // Every location Google listed, including ones stored under another login.
  let listedTotal = 0;
  let servedElsewhere = 0;

  for (const account of accounts) {
    if (!account.name) continue;

    let nextPageToken: string | undefined;
    const listedBefore = listedTotal;

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
        listedTotal++;

        const stored = await storedRowFor(googleAccountId, location.name);
        if (stored.action === "skip") {
          servedElsewhere++;
          continue;
        }

        const fields = {
          accountResourceName: account.name,
          name: location.title || "Unnamed Location",
          address: formatAddress(location.storefrontAddress),
          phone: location.phoneNumbers?.primaryPhone || null,
          category: location.categories?.primaryCategory?.displayName || null,
          websiteUrl: location.websiteUri || null,
          placeId: location.metadata?.placeId || null,
          isConnected: true,
        };
        let profile;
        try {
          profile =
            stored.action === "adopt"
              ? await prisma.profile.update({
                  where: { id: stored.id },
                  data: { googleAccountId, ...fields },
                })
              : await prisma.profile.upsert({
                  where: {
                    googleAccountId_locationName: {
                      googleAccountId,
                      locationName: location.name,
                    },
                  },
                  create: { googleAccountId, locationName: location.name, ...fields },
                  update: fields,
                });
        } catch (err) {
          // Another sync stored this location after storedRowFor looked. If
          // it was this login's own (two of its syncs overlapping), the row
          // is ours: skipping it would let the sweep below disconnect it.
          if (!isPrismaError(err, "P2002")) throw err;
          const winner = await prisma.profile.findUnique({
            where: { locationName: location.name },
          });
          if (!winner || winner.googleAccountId !== googleAccountId) {
            servedElsewhere++;
            continue;
          }
          profile = winner;
        }
        if (stored.action === "adopt") {
          console.log(
            `[location-sync] ${location.name} was stored under a login that lost it; now synced through ${googleAccountId}`
          );
        }

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

    if (listedTotal === listedBefore) emptyAccounts.add(account.name);
  }

  if (servedElsewhere > 0) {
    console.log(
      `[location-sync] ${servedElsewhere} location(s) listed for ${googleAccountId} are already connected through another login; left there`
    );
  }

  // Mark profiles not in this sync as disconnected. The publish worker then
  // demotes their due posts to DRAFT, so only a listing that actually came
  // back may disconnect anything. A failed page already threw above, before
  // this point. Google answering with nothing is not proof either: an empty
  // listing for the whole login, or for the group a profile sits under, or
  // accounts.list leaving that group out altogether, doesn't by itself
  // disconnect the profiles it would have listed.
  const missing = await prisma.profile.findMany({
    where: {
      googleAccountId,
      isConnected: true,
      id: { notIn: syncedProfiles.map((p) => p.id) },
    },
    select: { id: true, accountResourceName: true, locationName: true },
  });

  const emptyListing = listedTotal === 0;
  const listedAccounts = new Set(accounts.map((a) => a.name));
  const unproven = missing.filter(
    (p) =>
      emptyListing ||
      !p.accountResourceName ||
      !listedAccounts.has(p.accountResourceName) ||
      emptyAccounts.has(p.accountResourceName)
  );
  const gone = missing.filter((p) => !unproven.includes(p)).map((p) => p.id);

  // Kept forever, though, a client who took their only location out of the
  // agency's group stayed "connected" and kept getting AI posts that could
  // never publish. So each one is read directly: Google answering 404 (gone)
  // or 403 (not this login's to read any more) disconnects it; any other
  // answer keeps it as it was.
  for (const profile of unproven) {
    try {
      await mybusinessbusinessinformation.locations.get({
        name: profile.locationName,
        readMask: "name",
      });
      console.warn(
        `[location-sync] ${profile.locationName} wasn't listed for ${googleAccountId} but still reads; keeping it connected`
      );
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404 || status === 403) {
        gone.push(profile.id);
      } else {
        console.warn(
          `[location-sync] ${profile.locationName} wasn't listed and couldn't be checked (${status ?? "no status"}); keeping it connected`
        );
      }
    }
  }

  if (gone.length > 0) {
    await prisma.profile.updateMany({
      where: { googleAccountId, id: { in: gone } },
      data: { isConnected: false },
    });
  }

  return syncedProfiles;
}
