import { requireProfile } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { generateCitySuggestions } from "@/lib/city-generator";
import { scrapeWebsiteText } from "@/lib/website-scraper";
import { parseBody, profileIdBodySchema } from "@/lib/api-validation";

export async function POST(request: Request) {
  const parsed = await parseBody(request, profileIdBodySchema);
  if (parsed.error) return parsed.error;
  const { profileId } = parsed.data;

  const profile = await requireProfile(profileId);
  if (profile instanceof NextResponse) return profile;

  try {
    let websiteText: string | null = null;
    if (profile.websiteUrl) {
      websiteText = await scrapeWebsiteText(profile.websiteUrl);
    }

    const cities = await generateCitySuggestions({
      name: profile.name,
      category: profile.category,
      address: profile.address,
      websiteText,
    });
    return NextResponse.json({ cities });
  } catch (error) {
    console.error("City generation failed:", error);
    return NextResponse.json(
      { error: "Failed to generate city suggestions" },
      { status: 500 }
    );
  }
}
