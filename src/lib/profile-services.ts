import { prisma } from "@/lib/prisma";
import {
  fetchCurrentServices,
  fetchStructuredServices,
  fetchCategoryId,
  pushServicesToGBP,
} from "@/lib/google-business-info";
import { MAX_SERVICE_DESCRIPTION_LENGTH } from "@/lib/gbp-limits";

export interface ProfileServiceInput {
  serviceName: string;
  description?: string;
  isStructured: boolean;
  isApproved?: boolean;
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
        },
        update: {
          description: service.description || null,
          isStructured: service.isStructured,
          isApproved: service.isApproved ?? false,
          isPushed: false,
          pushedAt: null,
        },
      });
    }
  });

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
 * Structured services are resolved to real GBP serviceTypeIds by display
 * name; anything without a match is pushed as a free-form item, deduplicated
 * by display name against the live list and other approved services.
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
    },
  });

  if (!profile) {
    return { success: false, error: "Profile not found", status: 404 };
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
  let structuredServices: Awaited<ReturnType<typeof fetchStructuredServices>>;
  let categoryId: string | null;
  try {
    [currentGBP, structuredServices, categoryId] = await Promise.all([
      fetchCurrentServices({
        googleAccountId: profile.googleAccountId,
        locationName: profile.locationName,
      }),
      fetchStructuredServices({
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

  // Build displayName -> serviceTypeId lookup (case-insensitive)
  const typeIdMap = new Map<string, string>();
  for (const s of structuredServices) {
    typeIdMap.set(s.displayName.toLowerCase(), s.serviceTypeId);
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
    const serviceTypeId = typeIdMap.get(nameKey);

    if (serviceTypeId) {
      const newItem: GBPServiceItem = {
        structuredServiceItem: {
          serviceTypeId,
          description: service.description || undefined,
        },
      };
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

  await prisma.profileService.updateMany({
    where: { profileId, isApproved: true },
    data: { isPushed: true, pushedAt: new Date() },
  });

  return { success: true, pushedCount: approvedServices.length };
}
