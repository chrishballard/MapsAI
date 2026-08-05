import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchCurrentDescription } from "@/lib/google-business-info";
import { generateDescription } from "@/lib/description-generator";
import { parseBody, profileIdBodySchema } from "@/lib/api-validation";

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
    // GBP read failure shouldn't hide the saved description — degrade to null
    // but tell the client the live value is unknown rather than empty.
    const [savedDescription, keywordRecords, gbpResult] = await Promise.all([
      prisma.profileDescription.findFirst({
        where: { profileId },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          content: true,
          isApproved: true,
          isPushed: true,
          pushedAt: true,
        },
      }),
      prisma.profileKeyword.findMany({
        where: { profileId },
        orderBy: { sortOrder: "asc" },
      }),
      fetchCurrentDescription({
        googleAccountId: profile.googleAccountId,
        locationName: profile.locationName,
      }).then(
        (value) => ({ value, error: null as string | null }),
        (error: unknown) => {
          console.error("Failed to fetch current GBP description:", error);
          return {
            value: null,
            error: "Failed to fetch current GBP description",
          };
        }
      ),
    ]);

    return NextResponse.json({
      currentGBPDescription: gbpResult.value,
      savedDescription,
      keywords: keywordRecords.map((k) => k.keyword),
      gbpError: gbpResult.error,
    });
  } catch (error: unknown) {
    console.error("Failed to fetch description data:", error);
    return NextResponse.json(
      { error: "Failed to fetch description data" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(request, profileIdBodySchema);
  if (parsed.error) return parsed.error;
  const { profileId } = parsed.data;

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: {
      id: true,
      name: true,
      category: true,
      address: true,
    },
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

    const description = await generateDescription({
      name: profile.name,
      category: profile.category,
      address: profile.address,
      keywords: keywordRecords.map((k) => k.keyword),
      cities: cityRecords.map((c) => c.city),
    });

    return NextResponse.json({ description });
  } catch (error: unknown) {
    console.error("Description generation failed:", error);
    return NextResponse.json(
      { error: "Failed to generate description" },
      { status: 500 }
    );
  }
}
