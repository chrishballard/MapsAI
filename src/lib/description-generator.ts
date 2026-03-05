import { z } from "zod";
import { anthropic } from "./claude";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const DescriptionSchema = z.object({
  description: z.string(),
});

export async function generateDescription(profile: {
  name: string;
  category: string | null;
  address: string | null;
  keywords: string[];
  cities: string[];
}): Promise<string> {
  const systemPrompt = `You are an expert local SEO copywriter specializing in Google Business Profile descriptions. Write an SEO-optimized business description following these rules:

- TARGET: 720-745 characters. Use as much of the 750 character limit as possible without exceeding it.
- The first 250 characters are the most important — they appear in Google Search results, so lead with the strongest value proposition
- Naturally weave in the provided keywords throughout the description — do NOT keyword stuff or list them
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

  const callClaude = async (messages: { role: "user" | "assistant"; content: string }[]) => {
    const message = await anthropic.messages.parse({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1024,
      system: systemPrompt,
      messages,
      output_config: {
        format: zodOutputFormat(DescriptionSchema),
      },
    });
    const parsed = message.parsed_output;
    if (!parsed) {
      throw new Error("Failed to parse description from Claude");
    }
    return parsed.description;
  };

  let description = await callClaude([{ role: "user", content: userMessage }]);

  // If under 700 or over 750, retry once with feedback on the actual count
  if (description.length < 700 || description.length > 750) {
    const feedback = description.length < 700
      ? `That description is only ${description.length} characters. Please expand it to be between 720-745 characters. Add more detail about services, expertise, or service areas. Do not exceed 750 characters.`
      : `That description is ${description.length} characters which exceeds the 750 limit. Please shorten it to 720-745 characters while keeping the most important content.`;

    description = await callClaude([
      { role: "user", content: userMessage },
      { role: "assistant", content: JSON.stringify({ description }) },
      { role: "user", content: feedback },
    ]);
  }

  return description;
}
