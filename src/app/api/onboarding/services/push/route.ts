import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  fetchCurrentServices,
  fetchStructuredServices,
  fetchCategoryId,
  pushServicesToGBP,
} from "@/lib/google-business-info";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { profileId } = body;

  if (!profileId) {
    return NextResponse.json(
      { error: "profileId is required" },
      { status: 400 }
    );
  }

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
    return NextResponse.json(
      { error: "Profile not found" },
      { status: 404 }
    );
  }

  // Step 1: Fetch approved services from DB
  const approvedServices = await prisma.profileService.findMany({
    where: { profileId, isApproved: true },
  });

  if (approvedServices.length === 0) {
    return NextResponse.json(
      { success: false, error: "No approved services to push" },
      { status: 400 }
    );
  }

  // Step 2: Fetch current services, structured service type IDs, and category ID from GBP
  const [currentGBP, structuredServices, categoryId] = await Promise.all([
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

  // Build displayName -> serviceTypeId lookup (case-insensitive)
  const typeIdMap = new Map<string, string>();
  for (const s of structuredServices) {
    typeIdMap.set(s.displayName.toLowerCase(), s.serviceTypeId);
  }

  // Step 3: Store pre-push snapshot
  console.log(
    "[SERVICE_SNAPSHOT]",
    JSON.stringify({
      profileId,
      timestamp: new Date().toISOString(),
      serviceItems: currentGBP.serviceItems,
    })
  );

  // Step 4: Build service items list from approved services only (replace, don't merge)
  const mergedServiceItems: Record<string, unknown>[] = [];
  const seenFreeFormNames = new Set<string>();

  for (const service of approvedServices) {
    // Look up the real serviceTypeId from the GBP structured services (case-insensitive)
    const serviceTypeId = typeIdMap.get(service.serviceName.toLowerCase());

    if (serviceTypeId) {
      // Structured service with a real GBP serviceTypeId
      mergedServiceItems.push({
        structuredServiceItem: {
          serviceTypeId,
          description: service.description || undefined,
        },
      });
    } else {
      // Free-form service — deduplicate by display name
      const nameKey = service.serviceName.toLowerCase();
      if (seenFreeFormNames.has(nameKey)) continue;
      seenFreeFormNames.add(nameKey);

      mergedServiceItems.push({
        freeFormServiceItem: {
          category: categoryId || profile.category || "General",
          label: {
            displayName: service.serviceName,
            description: service.description || undefined,
          },
        },
      });
    }
  }

  // Step 5: Push merged list to GBP
  console.log("[SERVICE_PUSH] Sending to GBP:", JSON.stringify(mergedServiceItems, null, 2));
  const pushResult = await pushServicesToGBP({
    googleAccountId: profile.googleAccountId,
    locationName: profile.locationName,
    serviceItems: mergedServiceItems,
  });

  // Step 6: Update DB records on success
  if (pushResult.success) {
    await prisma.profileService.updateMany({
      where: {
        profileId,
        isApproved: true,
      },
      data: {
        isPushed: true,
        pushedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      pushedCount: approvedServices.length,
    });
  }

  // Push failed but services remain saved locally
  return NextResponse.json({
    success: false,
    error: pushResult.error,
  });
}
