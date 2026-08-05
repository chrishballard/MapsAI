import { requireSession, requireProfile } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchStructuredServices } from "@/lib/google-business-info";
import { generateServiceDescriptions } from "@/lib/service-generator";
import { saveProfileServices } from "@/lib/profile-services";
import { z } from "zod";
import { idSchema, parseBody } from "@/lib/api-validation";

export async function GET(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

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
    return NextResponse.json(
      { error: "Failed to fetch services data" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const parsed = await parseBody(
    request,
    z.object({
      profileId: idSchema,
      serviceNames: z.array(z.string().min(1).max(200)).min(1).max(20),
    })
  );
  if (parsed.error) return parsed.error;
  const { profileId, serviceNames } = parsed.data;

  const profile = await requireProfile(profileId);
  if (profile instanceof NextResponse) return profile;

  try {
    const [keywordRecords, cityRecords, structuredServices] =
      await Promise.all([
        prisma.profileKeyword.findMany({
          where: { profileId },
          orderBy: { sortOrder: "asc" },
        }),
        prisma.profileCity.findMany({
          where: { profileId },
          orderBy: { sortOrder: "asc" },
        }),
        fetchStructuredServices({
          googleAccountId: profile.googleAccountId,
          locationName: profile.locationName,
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

    // A service is structured only if GBP has a matching serviceTypeId;
    // everything else must be pushed as a free-form item
    const structuredNames = new Set(
      structuredServices.map((s) => s.displayName.toLowerCase())
    );

    // Save generated services to DB (replace full set, matching onboarding pattern)
    const savedServices = await prisma.$transaction(async (tx) => {
      await tx.profileService.deleteMany({ where: { profileId } });
      await tx.profileService.createMany({
        data: result.map((s) => ({
          profileId,
          serviceName: s.serviceName,
          description: s.description,
          isStructured: structuredNames.has(s.serviceName.toLowerCase()),
          isApproved: false,
          isPushed: false,
        })),
      });
      return tx.profileService.findMany({
        where: { profileId },
        orderBy: { createdAt: "asc" },
      });
    });

    return NextResponse.json({ services: savedServices });
  } catch (error: unknown) {
    console.error("Service description generation failed:", error);
    return NextResponse.json(
      { error: "Failed to generate service descriptions" },
      { status: 500 }
    );
  }
}

// Persist edits and approval state for saved services (called before push)
export async function PUT(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(
    request,
    z.object({
      profileId: idSchema,
      services: z
        .array(
          z.object({
            serviceName: z.string().min(1).max(200),
            description: z.string().max(1000).optional(),
            isStructured: z.boolean(),
            isApproved: z.boolean().optional(),
          })
        )
        .min(1)
        .max(100),
    })
  );
  if (parsed.error) return parsed.error;
  const { profileId, services } = parsed.data;

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { id: true },
  });

  if (!profile) {
    return NextResponse.json(
      { error: "Profile not found" },
      { status: 404 }
    );
  }

  const updatedServices = await saveProfileServices(profileId, services);

  return NextResponse.json({ services: updatedServices });
}
