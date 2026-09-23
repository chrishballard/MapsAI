import { z } from "zod";
import { generate } from "./claude";
import { pastedContent, PASTED_CONTENT_SYSTEM_NOTE } from "./pasted-content";

const KeywordSuggestionsSchema = z.object({
  keywords: z
    .array(
      z.object({
        keyword: z.string(),
        // A one-line answer shown beside the suggestion in onboarding, not a
        // write-up of the model's thinking (Opus 5.5 can decline prompts that
        // ask it to reproduce its reasoning in the reply).
        reasoning: z
          .string()
          .describe("One short sentence on why this keyword fits this business."),
      })
    )
    .min(5)
    .max(10),
});

export async function generateKeywordSuggestions(profile: {
  name: string;
  category: string | null;
  address: string | null;
  websiteText?: string | null;
}): Promise<{ keyword: string; reasoning: string }[]> {
  const systemPrompt = `You are an expert local SEO strategist specializing in Google Business Profile optimization. Generate 8-10 service-focused target keywords for the business described below.

Rules:
- Keywords should describe services, specialties, and what customers search for
- Do NOT include city names, locations, or "near me" in keywords — locations are handled separately
- Examples of good keywords: "emergency brake repair", "oil change", "transmission diagnostic", "check engine light repair"
- Examples of bad keywords: "auto repair Austin", "mechanic near me", "best quality service"
- Mix broad service keywords with specific specialty keywords
- Do NOT include the business name as a keyword
- Each keyword should be something real customers would search on Google
- Focus on the specific services and specialties this type of business offers
- If website content is provided, use it to identify specific services, specialties, and unique offerings the business promotes

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
    schema: KeywordSuggestionsSchema,
    // Was 1024 before thinking was always on; the list itself is small.
    maxTokens: 8_192,
    effort: "medium",
    errorMessage: "Failed to parse keyword suggestions from Claude",
  });

  return parsed.keywords;
}
