import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchStructuredServices } from "@/lib/google-business-info";
import { generateServiceDescriptions } from "@/lib/service-generator";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profileId = request.nextUrl.searchParams.get("profileId");
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
    },
  });

  if (!profile) {
    return NextResponse.json(
      { error: "Profile not found" },
      { status: 404 }
    );
  }

  try {
    const [currentGBPServices, savedServices] = await Promise.all([
      fetchStructuredServices({
        googleAccountId: profile.googleAccountId,
        locationName: profile.locationName,
      }),
      prisma.profileService.findMany({
        where: { profileId },
        select: {
          id: true,
          serviceName: true,
          description: true,
          isStructured: true,
          isApproved: true,
          isPushed: true,
          pushedAt: true,
        },
      }),
    ]);

    return NextResponse.json({
      currentGBPServices,
      savedServices,
      availableServices: currentGBPServices,
    });
  } catch (error: unknown) {
    console.error("Failed to fetch services data:", error);
    const message =
      error instanceof Error ? error.message : "Failed to fetch services data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { profileId, serviceNames } = body;

  if (!profileId) {
    return NextResponse.json(
      { error: "profileId is required" },
      { status: 400 }
    );
  }

  if (
    !Array.isArray(serviceNames) ||
    serviceNames.length === 0 ||
    serviceNames.length > 20
  ) {
    return NextResponse.json(
      { error: "serviceNames must be a non-empty array with max 20 items" },
      { status: 400 }
    );
  }

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
  });

  if (!profile) {
    return NextResponse.json(
      { error: "Profile not found" },
      { status: 404 }
    );
  }

  try {
    const [keywordRecords, cityRecords] = await Promise.all([
      prisma.profileKeyword.findMany({
        where: { profileId },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.profileCity.findMany({
        where: { profileId },
        orderBy: { sortOrder: "asc" },
      }),
    ]);

    const result = await generateServiceDescriptions({
      businessName: profile.name,
      category: profile.category,
      address: profile.address,
      keywords: keywordRecords.map((k) => k.keyword),
      cities: cityRecords.map((c) => c.city),
      serviceNames,
    });

    // Save generated services to DB (replace full set, matching onboarding pattern)
    await prisma.$transaction(async (tx) => {
      await tx.profileService.deleteMany({ where: { profileId } });
      await tx.profileService.createMany({
        data: result.map((s) => ({
          profileId,
          serviceName: s.serviceName,
          description: s.description,
          isStructured: true,
          isApproved: false,
          isPushed: false,
        })),
      });
    });

    return NextResponse.json({ services: result });
  } catch (error: unknown) {
    console.error("Service description generation failed:", error);
    return NextResponse.json(
      { error: "Failed to generate service descriptions" },
      { status: 500 }
    );
  }
}
