import { prisma } from "@/lib/prisma";
import {
  fetchCurrentServices,
  fetchServiceTypeCatalog,
  fetchCategoryId,
  pushServicesToGBP,
  type ServiceTypeCatalog,
} from "@/lib/google-business-info";
import { MAX_SERVICE_DESCRIPTION_LENGTH } from "@/lib/gbp-limits";
import { isNonEnglishLanguageCode } from "@/lib/copy-language";

export interface ProfileServiceInput {
  serviceName: string;
  description?: string;
  isStructured: boolean;
  isApproved?: boolean;
  /**
   * Google's service type id, when the caller knows it (the row was picked
   * from Google's catalog). Absent leaves whatever id the row already has.
   */
  serviceTypeId?: string | null;
}

interface GBPServiceItem {
  structuredServiceItem?: {
    serviceTypeId?: string;
    description?: string;
  };
  freeFormServiceItem?: {
    category?: string;
    label?: {
      displayName?: string;
      description?: string;
    };
  };
}

/**
 * Upsert a profile's services, persisting descriptions and approval state.
 * Updating a service resets its pushed status so edits get re-pushed.
 *
 * With replace: true the input is treated as the COMPLETE set and rows absent
 * from it are deleted. Callers that send their full current list (the
 * onboarding wizard, the reoptimize editor) must use it: pushApprovedServices
 * pushes ALL approved rows, so a stale approved row left behind would
 * resurrect a deselected service on Google. Callers that save a partial list
 * (the optimization suggestions panel approves one service at a time) must
 * NOT set it.
 *
 * A serviceTypeId in the input is written; a save without one never clears
 * the id an earlier push recorded, since the push matches on it first.
 */
export async function saveProfileServices(
  profileId: string,
  services: ProfileServiceInput[],
  options: { replace?: boolean } = {}
) {
  await prisma.$transaction(async (tx) => {
    if (options.replace) {
      await tx.profileService.deleteMany({
        where: {
          profileId,
          serviceName: { notIn: services.map((s) => s.serviceName) },
        },
      });
    }
    for (const service of services) {
      await tx.profileService.upsert({
        where: {
          profileId_serviceName: {
            profileId,
            serviceName: service.serviceName,
          },
        },
        create: {
          profileId,
          serviceName: service.serviceName,
          description: service.description || null,
          isStructured: service.isStructured,
          isApproved: service.isApproved ?? false,
          serviceTypeId: service.serviceTypeId || null,
        },
        update: {
          description: service.description || null,
          isStructured: service.isStructured,
          isApproved: service.isApproved ?? false,
          isPushed: false,
          pushedAt: null,
          ...(service.serviceTypeId
            ? { serviceTypeId: service.serviceTypeId }
            : {}),
        },
      });
    }
    // Up to 100 sequential upserts — Prisma's default 5s interactive
    // transaction timeout is too tight for the service-rich profiles this
    // flow exists for
  }, { timeout: 30_000, maxWait: 5_000 });

  return prisma.profileService.findMany({
    where: { profileId },
    orderBy: { createdAt: "asc" },
  });
}

export type PushApprovedServicesResult =
  | { success: true; pushedCount: number }
  | { success: false; error: string; status: number };

/**
 * Push all DB-approved services for a profile to GBP.
 *
 * With merge: false the approved services REPLACE the live GBP list
 * (onboarding — the wizard owns the full list). With merge: true they are
 * merged into the live list (re-optimization may only cover a subset).
 *
 * Structured services are resolved to real GBP serviceTypeIds by the id the
 * row stored, then by display name, then (non-English profiles only) by the
 * type id's own English slug — see resolveServiceTypeId. Anything without a
 * match is pushed as a free-form item, deduplicated by display name against
 * the live list and other approved services. After a successful push each
 * row records the id it went out as (null for free-form), so the next push
 * finds the type whatever language Google names it in.
 *
 * Nothing is sent when two approved rows would go out as the same item (one
 * description would be lost), or when a replace would drop a live structured
 * service on a degraded catalog read (see ServiceTypeCatalog).
 */
export async function pushApprovedServices(
  profileId: string,
  options: { merge?: boolean } = {}
): Promise<PushApprovedServicesResult> {
  const merge = options.merge ?? false;

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: {
      id: true,
      googleAccountId: true,
      locationName: true,
      category: true,
      googleLanguageCode: true,
    },
  });

  if (!profile) {
    return { success: false, error: "Profile not found", status: 404 };
  }

  if (isNonEnglishLanguageCode(profile.googleLanguageCode)) {
    // Google names this location's service types in its own language, and
    // the API cannot change it. Rows with a stored serviceTypeId still match;
    // a row with neither an id nor a localized name goes out as custom.
    console.warn(
      `[SERVICE_PUSH] Profile ${profileId} has GBP language ${profile.googleLanguageCode}, not English: Google's service type names are localized, so services match by stored type id first`
    );
  }

  const approvedServices = await prisma.profileService.findMany({
    where: { profileId, isApproved: true },
  });

  if (approvedServices.length === 0) {
    return {
      success: false,
      error: "No approved services to push",
      status: 400,
    };
  }

  // Google rejects the entire serviceItems patch if any one description
  // exceeds 300 characters — fail early with the offending names instead of
  // surfacing a cryptic GBP error.
  const overlong = approvedServices.filter(
    (s) => (s.description?.length ?? 0) > MAX_SERVICE_DESCRIPTION_LENGTH
  );
  if (overlong.length > 0) {
    return {
      success: false,
      error: `These descriptions are over Google's ${MAX_SERVICE_DESCRIPTION_LENGTH} character limit: ${overlong
        .map((s) => s.serviceName)
        .join(", ")}. Shorten them and try again.`,
      status: 400,
    };
  }

  // Abort on any read failure — the push below replaces or merges the live
  // GBP service list, so proceeding on a falsely-empty read could wipe
  // real services.
  let currentGBP: { serviceItems: unknown[] };
  let catalog: ServiceTypeCatalog;
  let categoryId: string | null;
  try {
    [currentGBP, catalog, categoryId] = await Promise.all([
      fetchCurrentServices({
        googleAccountId: profile.googleAccountId,
        locationName: profile.locationName,
      }),
      fetchServiceTypeCatalog({
        googleAccountId: profile.googleAccountId,
        locationName: profile.locationName,
      }),
      fetchCategoryId({
        googleAccountId: profile.googleAccountId,
        locationName: profile.locationName,
      }),
    ]);
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to read current GBP services";
    console.error("[SERVICE_PUSH] Aborting — GBP read failed:", message);
    return {
      success: false,
      error: "Could not read current GBP services (push aborted)",
      status: 502,
    };
  }

  const structuredServices = catalog.serviceTypes;
  // Every id the catalog read found, named or not
  const catalogTypeIds = [
    ...structuredServices.map((s) => s.serviceTypeId),
    ...catalog.unresolvedTypeIds,
  ];

  // Build displayName -> serviceTypeId lookup (case-insensitive)
  const typeIdMap = new Map<string, string>();
  for (const s of structuredServices) {
    typeIdMap.set(s.displayName.toLowerCase(), s.serviceTypeId);
  }
  // Stored ids the push will send: the ids the catalog read found, plus in
  // merge mode any structured item the location already carries (a type from
  // an additional category). Replace mode does not re-send the live list, so
  // a live-only id would be new traffic Google might reject.
  const validTypeIds = new Set(catalogTypeIds);
  if (merge) {
    for (const item of currentGBP.serviceItems as GBPServiceItem[]) {
      const id = item.structuredServiceItem?.serviceTypeId;
      if (id) validTypeIds.add(id);
    }
  }
  const typeIdBySlug = typeIdSlugMap(profile.googleLanguageCode, catalogTypeIds);

  // Row id -> the structured type it is pushed as (null = free-form)
  const matches = new Map<string, ReturnType<typeof resolveServiceTypeId>>();
  for (const service of approvedServices) {
    matches.set(
      service.id,
      resolveServiceTypeId(service, typeIdMap, validTypeIds, typeIdBySlug)
    );
  }

  // Two approved rows that go out as the same item collapse into one: Google
  // keeps one description and the other is lost, while both rows would be
  // stamped pushed. Refuse before anything is sent.
  const collision = describeCollisions(approvedServices, matches);
  if (collision) {
    return { success: false, error: collision, status: 400 };
  }

  // Pre-push snapshot for manual recovery
  console.log(
    "[SERVICE_SNAPSHOT]",
    JSON.stringify({
      profileId,
      timestamp: new Date().toISOString(),
      serviceItems: currentGBP.serviceItems,
    })
  );

  const serviceItems: GBPServiceItem[] = merge
    ? [...(currentGBP.serviceItems as GBPServiceItem[])]
    : [];

  const seenFreeFormNames = new Set<string>();
  for (const item of serviceItems) {
    const name = item.freeFormServiceItem?.label?.displayName;
    if (name) seenFreeFormNames.add(name.toLowerCase());
  }

  for (const service of approvedServices) {
    const nameKey = service.serviceName.toLowerCase();
    const match = matches.get(service.id) ?? null;
    const serviceTypeId = match?.serviceTypeId ?? null;

    if (serviceTypeId) {
      const newItem: GBPServiceItem = {
        structuredServiceItem: {
          serviceTypeId,
          description: service.description || undefined,
        },
      };
      // On a non-English profile a title can match late: by the slug, or by
      // display name when the read fell back to Google's English catalog
      // (categories:batchGet). Either way it went out as a custom service on
      // the pushes before this one, so drop that copy rather than leave both.
      // Other matches (a Spanish title against the location's own Spanish
      // names, and English profiles) leave custom items alone, as pushes
      // always have: there a same-named custom item is the client's own.
      const matchedLate =
        match?.via === "typeIdSlug" ||
        (match?.via === "displayName" && !!typeIdBySlug && catalog.source === "batchGet");
      if (matchedLate) {
        for (let i = serviceItems.length - 1; i >= 0; i--) {
          const label = serviceItems[i].freeFormServiceItem?.label?.displayName;
          if (label?.toLowerCase() === nameKey) serviceItems.splice(i, 1);
        }
        seenFreeFormNames.delete(nameKey);
      }
      const existingIndex = serviceItems.findIndex(
        (item) => item.structuredServiceItem?.serviceTypeId === serviceTypeId
      );
      if (existingIndex >= 0) {
        serviceItems[existingIndex] = newItem;
      } else {
        serviceItems.push(newItem);
      }
    } else {
      const newItem: GBPServiceItem = {
        freeFormServiceItem: {
          category: categoryId || profile.category || "General",
          label: {
            displayName: service.serviceName,
            description: service.description || undefined,
          },
        },
      };
      if (seenFreeFormNames.has(nameKey)) {
        // Name already in the list — replace it rather than append a duplicate
        const existingIndex = serviceItems.findIndex(
          (item) =>
            item.freeFormServiceItem?.label?.displayName?.toLowerCase() ===
            nameKey
        );
        if (existingIndex >= 0) {
          serviceItems[existingIndex] = newItem;
        }
      } else {
        seenFreeFormNames.add(nameKey);
        serviceItems.push(newItem);
      }
    }
  }

  if (!merge && catalog.degraded) {
    // Replace drops every live item it does not send. On a degraded read a
    // live structured service missing from the list may be one the push
    // failed to match rather than one the user deselected, and dropping it
    // would swap a structured service for a custom one. Refuse instead.
    const outgoing = new Set(
      serviceItems
        .map((item) => item.structuredServiceItem?.serviceTypeId)
        .filter((id): id is string => !!id)
    );
    const dropped = [
      ...new Set(
        (currentGBP.serviceItems as GBPServiceItem[])
          .map((item) => item.structuredServiceItem?.serviceTypeId)
          .filter((id): id is string => !!id && !outgoing.has(id))
      ),
    ];
    if (dropped.length > 0) {
      console.error(
        `[SERVICE_PUSH] Refused replace on a degraded catalog read for ${profileId}; would drop:`,
        dropped
      );
      return {
        success: false,
        error: `Google did not return this category's full service list, so replacing the live services could drop ${dropped.length} structured service${dropped.length === 1 ? "" : "s"} already on the profile (${dropped.join(", ")}). Nothing was pushed. Push from re-optimization instead: it keeps the live services.`,
        status: 502,
      };
    }
  }

  console.log(
    "[SERVICE_PUSH] Sending to GBP:",
    JSON.stringify(serviceItems, null, 2)
  );
  const pushResult = await pushServicesToGBP({
    googleAccountId: profile.googleAccountId,
    locationName: profile.locationName,
    serviceItems,
  });

  if (!pushResult.success) {
    // Push failed but services remain saved locally
    console.error("[SERVICE_PUSH] GBP push failed:", pushResult.error);
    return {
      success: false,
      error: "Failed to push services to Google Business Profile",
      status: 502,
    };
  }

  // Record what went out in one transaction: the pushed stamp on exactly the
  // rows that were sent (a row approved while the push ran was not), and the
  // id each row went out as (null for free-form), written where it changed.
  // updateMany throughout, so a row deleted mid-push cannot fail the rest.
  const pushedAt = new Date();
  await prisma.$transaction([
    prisma.profileService.updateMany({
      where: { id: { in: approvedServices.map((s) => s.id) } },
      data: { isPushed: true, pushedAt },
    }),
    ...approvedServices.flatMap((service) => {
      const serviceTypeId = matches.get(service.id)?.serviceTypeId ?? null;
      if (serviceTypeId === (service.serviceTypeId ?? null)) return [];
      return [
        prisma.profileService.updateMany({
          where: { id: service.id },
          data: { serviceTypeId },
        }),
      ];
    }),
  ]);

  return { success: true, pushedCount: approvedServices.length };
}

/**
 * The structured service type a saved service pushes as, or null for a
 * free-form item, with how it was found.
 *
 * The stored id wins when Google will take it: display names are localized
 * into the location's language (an es-419 profile calls mattress cleaning
 * "Limpieza de colchones"), so a title that no longer matches the catalog
 * still finds its type. Without a usable stored id, the display name decides,
 * case-insensitively, exactly as before ids were stored. Last, when the
 * caller passes typeIdBySlug (non-English profiles only), the title is
 * compared with the English words of the type id itself, which is how an
 * English title typed in the UI finds its type on a Spanish profile.
 */
export function resolveServiceTypeId(
  service: { serviceName: string; serviceTypeId?: string | null },
  typeIdByDisplayName: Map<string, string>,
  validTypeIds: Set<string>,
  typeIdBySlug?: Map<string, string>
): { serviceTypeId: string; via: "storedId" | "displayName" | "typeIdSlug" } | null {
  if (service.serviceTypeId && validTypeIds.has(service.serviceTypeId)) {
    return { serviceTypeId: service.serviceTypeId, via: "storedId" };
  }
  const byName = typeIdByDisplayName.get(service.serviceName.toLowerCase());
  if (byName) return { serviceTypeId: byName, via: "displayName" };
  const bySlug = typeIdBySlug?.get(slugKey(service.serviceName));
  if (bySlug) return { serviceTypeId: bySlug, via: "typeIdSlug" };
  return null;
}

/**
 * typeId slug -> typeId, for resolveServiceTypeId's last step. Undefined on
 * an English profile, which keeps matching by display name alone, as it
 * always has.
 */
export function typeIdSlugMap(
  googleLanguageCode: string | null | undefined,
  serviceTypeIds: Iterable<string | null | undefined>
): Map<string, string> | undefined {
  if (!isNonEnglishLanguageCode(googleLanguageCode)) return undefined;
  const bySlug = new Map<string, string>();
  for (const id of serviceTypeIds) {
    if (typeof id === "string" && id) bySlug.set(typeIdSlug(id), id);
  }
  return bySlug;
}

/**
 * Names the approved rows that would go out as one item (the same service
 * type, or custom names equal but for case), or null when there are none.
 */
function describeCollisions(
  services: Array<{ id: string; serviceName: string }>,
  matches: Map<string, { serviceTypeId: string } | null>
): string | null {
  const rowsByItem = new Map<string, { label: string; names: string[] }>();
  for (const service of services) {
    const typeId = matches.get(service.id)?.serviceTypeId;
    const key = typeId
      ? `type:${typeId}`
      : `custom:${service.serviceName.toLowerCase()}`;
    const label = typeId ? `service type ${typeId}` : "the same custom service";
    const entry = rowsByItem.get(key) ?? { label, names: [] };
    entry.names.push(`"${service.serviceName}"`);
    rowsByItem.set(key, entry);
  }
  const collisions = [...rowsByItem.values()].filter((e) => e.names.length > 1);
  if (collisions.length === 0) return null;
  return `These approved services would go out to Google as one service, so only one description would be published: ${collisions
    .map((e) => `${e.names.join(" and ")} (${e.label})`)
    .join("; ")}. Unapprove or remove all but one of each and push again.`;
}

/** "job_type_id:move_out_cleaning" -> "move out cleaning" */
function typeIdSlug(serviceTypeId: string): string {
  const last = serviceTypeId.split(/[:/]/).pop() ?? serviceTypeId;
  return slugKey(last);
}

/** Lowercase words only, so "Move-out Cleaning" meets "move_out_cleaning". */
function slugKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
