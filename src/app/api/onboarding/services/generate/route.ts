import { requireProfile } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  generateServiceDescriptions,
  ServiceGenerationIncompleteError,
} from "@/lib/service-generator";
import { scrapeWebsiteText } from "@/lib/website-scraper";
import { z } from "zod";
import { idSchema, parseBody, serviceNamesSchema } from "@/lib/api-validation";

export async function POST(request: NextRequest) {
  const parsed = await parseBody(
    request,
    z.object({
      profileId: idSchema,
      serviceNames: serviceNamesSchema,
    })
  );
  if (parsed.error) return parsed.error;
  const { profileId, serviceNames } = parsed.data;

  const profile = await requireProfile(profileId);
  if (profile instanceof NextResponse) return profile;

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

    const result = await generateServiceDescriptions({
      businessName: profile.name,
      category: profile.category,
      address: profile.address,
      keywords: keywordRecords.map((k) => k.keyword),
      cities: cityRecords.map((c) => c.city),
      serviceNames,
      websiteText,
    });

    return NextResponse.json({ services: result });
  } catch (error: unknown) {
    console.error("Service description generation failed:", error);
    if (error instanceof ServiceGenerationIncompleteError) {
      // Actionable and safe to surface: names the services that need a retry
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Failed to generate service descriptions" },
      { status: 500 }
    );
  }
}
