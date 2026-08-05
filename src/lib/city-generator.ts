import { z } from "zod";
import { generate } from "./claude";

const CitySuggestionsSchema = z.object({
  cities: z
    .array(
      z.object({
        city: z.string(),
        reasoning: z.string(),
      })
    )
    .min(3)
    .max(5),
});

export async function generateCitySuggestions(profile: {
  name: string;
  category: string | null;
  address: string | null;
  websiteText?: string | null;
}): Promise<{ city: string; reasoning: string }[]> {
  const systemPrompt = `You are an expert local SEO strategist. Based on the business information provided, suggest 3-5 target cities or service areas this business likely serves.

Rules:
- The first suggestion should be the city where the business is physically located
- Additional suggestions should be nearby cities/areas the business likely serves
- Format each city as "City, State" (e.g., "Austin, TX")
- Focus on cities within a realistic service radius for this type of business
- If website content mentions specific service areas, use those
- If you can identify the business location from the address, suggest surrounding cities`;

  const userMessage = [
    `Business name: ${profile.name}`,
    profile.category ? `Category: ${profile.category}` : null,
    profile.address ? `Address: ${profile.address}` : null,
    profile.websiteText
      ? `\nWebsite content (extracted from their site):\n${profile.websiteText}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const parsed = await generate({
    system: systemPrompt,
    prompt: userMessage,
    schema: CitySuggestionsSchema,
    maxTokens: 1024,
    errorMessage: "Failed to parse city suggestions from Claude",
  });

  return parsed.cities;
}
