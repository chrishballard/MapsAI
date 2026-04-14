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
  websiteText?: string | null;
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
- Write in a professional, informative tone that builds trust
- If website content is provided, use it to understand the business's unique selling points, tone, and specific offerings`;

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
    profile.websiteText
      ? `\nWebsite content (extracted from their site):\n${profile.websiteText}`
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

  const messages: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: userMessage },
  ];

  let description = await callClaude(messages);

  // Retry up to 2 times with exact character count feedback
  for (let attempt = 0; attempt < 2; attempt++) {
    if (description.length >= 700 && description.length <= 750) break;

    const feedback = description.length < 700
      ? `That description is only ${description.length} characters. I need 720-745 characters. Please expand it with more detail about services, expertise, or service areas.`
      : `That description is ${description.length} characters, exceeding the 750 limit. Please shorten it to exactly 720-745 characters while keeping the most important content.`;

    messages.push(
      { role: "assistant", content: JSON.stringify({ description }) },
      { role: "user", content: feedback },
    );
    description = await callClaude(messages);
  }

  // Deterministic fallback: if still over 750, truncate at last sentence boundary
  if (description.length > 750) {
    description = truncateToSentence(description, 750);
  }

  return description;
}

function truncateToSentence(text: string, maxLength: number): string {
  const truncated = text.slice(0, maxLength);
  // Find the last sentence-ending punctuation
  const lastPeriod = truncated.lastIndexOf(".");
  const lastExclaim = truncated.lastIndexOf("!");
  const lastEnd = Math.max(lastPeriod, lastExclaim);
  if (lastEnd > maxLength * 0.6) {
    return truncated.slice(0, lastEnd + 1);
  }
  // Fallback: just hard-truncate at 750
  return truncated;
}
