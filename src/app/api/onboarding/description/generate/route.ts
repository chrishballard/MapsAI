import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateDescription } from "@/lib/description-generator";
import { scrapeWebsiteText } from "@/lib/website-scraper";

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
      name: true,
      category: true,
      address: true,
      websiteUrl: true,
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

    let websiteText: string | null = null;
    if (profile.websiteUrl) {
      websiteText = await scrapeWebsiteText(profile.websiteUrl);
    }

    const description = await generateDescription({
      name: profile.name,
      category: profile.category,
      address: profile.address,
      keywords: keywordRecords.map((k) => k.keyword),
      cities: cityRecords.map((c) => c.city),
      websiteText,
    });

    return NextResponse.json({ description });
  } catch (error: unknown) {
    console.error("Description generation failed:", error);
    const message =
      error instanceof Error ? error.message : "Failed to generate description";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
