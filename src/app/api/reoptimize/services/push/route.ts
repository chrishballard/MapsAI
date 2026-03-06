import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  fetchCurrentServices,
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

  // Step 2: Fetch current services from GBP (full list for merge)
  const currentGBP = await fetchCurrentServices({
    googleAccountId: profile.googleAccountId,
    locationName: profile.locationName,
  });

  // Step 3: Store pre-push snapshot
  console.log(
    "[SERVICE_SNAPSHOT]",
    JSON.stringify({
      profileId,
      timestamp: new Date().toISOString(),
      serviceItems: currentGBP.serviceItems,
    })
  );

  // Step 4: Merge logic
  const mergedServiceItems = [...(currentGBP.serviceItems as Record<string, unknown>[])];

  for (const service of approvedServices) {
    if (service.isStructured) {
      // Find existing structured service with matching serviceTypeId
      const existingIndex = mergedServiceItems.findIndex((item) => {
        const structured = (item as Record<string, unknown>)
          .structuredServiceItem as Record<string, unknown> | undefined;
        return structured?.serviceTypeId === service.serviceName;
      });

      const newItem = {
        structuredServiceItem: {
          serviceTypeId: service.serviceName,
          description: service.description || undefined,
        },
      };

      if (existingIndex >= 0) {
        mergedServiceItems[existingIndex] = newItem;
      } else {
        mergedServiceItems.push(newItem);
      }
    } else {
      // Free-form / custom service
      mergedServiceItems.push({
        freeFormServiceItem: {
          category: profile.category || "General",
          label: {
            displayName: service.serviceName,
            description: service.description || undefined,
          },
        },
      });
    }
  }

  // Step 5: Push merged list to GBP
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
