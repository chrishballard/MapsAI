import { z } from "zod";
import { anthropic } from "./claude";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const DescriptionSchema = z.object({
  description: z.string().max(750),
});

export async function generateDescription(profile: {
  name: string;
  category: string | null;
  address: string | null;
  keywords: string[];
  cities: string[];
}): Promise<string> {
  const systemPrompt = `You are an expert local SEO copywriter specializing in Google Business Profile descriptions. Write an SEO-optimized business description following these rules:

- HARD LIMIT: 750 characters maximum
- The first 250 characters are the most important — they appear in Google Search results
- Naturally weave in the provided keywords throughout the description — do NOT keyword stuff
- Reference cities and service areas naturally where appropriate
- Write in third person (use the business name or "the business", never "we" or "our")
- Do NOT include phone numbers, URLs, or promotional language (e.g. "best", "#1", "call now")
- Do NOT use ALL CAPS for emphasis
- Focus on: what the business does, what makes it unique, and the areas it serves
- Write in a professional, informative tone that builds trust`;

  const userMessage = [
    `Business name: ${profile.name}`,
    profile.category ? `Category: ${profile.category}` : null,
    profile.address ? `Address: ${profile.address}` : null,
    profile.keywords.length > 0
      ? `Target keywords: ${profile.keywords.join(", ")}`
      : null,
    profile.cities.length > 0
      ? `Service areas/cities: ${profile.cities.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const message = await anthropic.messages.parse({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    output_config: {
      format: zodOutputFormat(DescriptionSchema),
    },
  });

  const parsed = message.parsed_output;
  if (!parsed) {
    throw new Error("Failed to parse description from Claude");
  }

  return parsed.description;
}
