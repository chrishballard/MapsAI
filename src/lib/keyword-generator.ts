import { z } from "zod";
import { anthropic } from "./claude";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const KeywordSuggestionsSchema = z.object({
  keywords: z
    .array(
      z.object({
        keyword: z.string(),
        reasoning: z.string(),
      })
    )
    .min(5)
    .max(10),
});

export async function generateKeywordSuggestions(profile: {
  name: string;
  category: string | null;
  address: string | null;
}): Promise<{ keyword: string; reasoning: string }[]> {
  const systemPrompt = `You are an expert local SEO strategist specializing in Google Business Profile optimization. Generate 8-10 highly specific, localized target keywords for the business described below.

Rules:
- Keywords must be specific to this business type and location
- Include location-qualified keywords (e.g., "emergency dentist in Springfield" not just "dentist")
- Mix service-specific keywords with location-based keywords
- Include "near me" variants for key services
- Avoid generic phrases like "great service" or "best quality"
- Do NOT include the business name as a keyword
- Each keyword should be something real customers would search on Google
- Focus on keywords with local search intent`;

  const userMessage = [
    `Business name: ${profile.name}`,
    profile.category ? `Category: ${profile.category}` : null,
    profile.address ? `Address: ${profile.address}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const message = await anthropic.messages.parse({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    output_config: {
      format: zodOutputFormat(KeywordSuggestionsSchema),
    },
  });

  const parsed = message.parsed_output;
  if (!parsed) {
    throw new Error("Failed to parse keyword suggestions from Claude");
  }

  return parsed.keywords;
}
