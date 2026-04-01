import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchStructuredServices } from "@/lib/google-business-info";

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

  const [savedServices, gbpServices, keywords] = await Promise.all([
    prisma.profileService.findMany({
      where: { profileId },
      orderBy: { createdAt: "asc" },
    }),
    fetchStructuredServices({
      googleAccountId: profile.googleAccountId,
      locationName: profile.locationName,
    }),
    prisma.profileKeyword.findMany({
      where: { profileId },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  // Only use actual GBP structured services — no fake serviceTypeIds
  const availableServices = gbpServices;

  return NextResponse.json({
    services: savedServices,
    availableServices,
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { profileId, services } = body;

  if (!profileId) {
    return NextResponse.json(
      { error: "profileId is required" },
      { status: 400 }
    );
  }

  if (!Array.isArray(services) || services.length === 0) {
    return NextResponse.json(
      { error: "services must be a non-empty array" },
      { status: 400 }
    );
  }

  for (const service of services) {
    if (!service.serviceName) {
      return NextResponse.json(
        { error: "Each service must have a serviceName" },
        { status: 400 }
      );
    }
  }

  await prisma.$transaction(
    services.map(
      (service: {
        serviceName: string;
        description?: string;
        isStructured: boolean;
        isApproved?: boolean;
      }) =>
        prisma.profileService.upsert({
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
        })
    )
  );

  const updatedServices = await prisma.profileService.findMany({
    where: { profileId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ services: updatedServices });
}
