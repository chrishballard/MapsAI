import { z } from "zod";
import { generate } from "./claude";
import { pastedContent, PASTED_CONTENT_SYSTEM_NOTE } from "./pasted-content";

const CitySuggestionsSchema = z.object({
  cities: z
    .array(
      z.object({
        city: z.string(),
        // A one-line answer shown beside the suggestion in onboarding, not a
        // write-up of the model's thinking.
        reasoning: z
          .string()
          .describe("One short sentence on why this business likely serves this city."),
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
- If you can identify the business location from the address, suggest surrounding cities

${PASTED_CONTENT_SYSTEM_NOTE}`;

  const userMessage = [
    `Business name: ${profile.name}`,
    profile.category ? `Category: ${profile.category}` : null,
    profile.address ? `Address: ${profile.address}` : null,
    profile.websiteText
      ? `\nWebsite content (extracted from their site):\n${pastedContent(profile.websiteText)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const parsed = await generate({
    system: systemPrompt,
    prompt: userMessage,
    schema: CitySuggestionsSchema,
    // Was 1024 before thinking was always on; the list itself is small.
    maxTokens: 8_192,
    effort: "medium",
    errorMessage: "Failed to parse city suggestions from Claude",
  });

  return parsed.cities;
}
