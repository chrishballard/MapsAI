import { anthropic } from "./claude";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { BatchPostsSchema, type BatchPosts } from "./prompts/types";
import { getDefaultPrompt } from "./prompts/defaults";

interface ProfileInput {
  name: string;
  category: string | null;
  address: string | null;
}

export async function generateMonthlyPosts(
  profile: ProfileInput,
  customPrompt?: string
): Promise<BatchPosts> {
  const systemPrompt = customPrompt || getDefaultPrompt(profile.category);

  const userMessage = [
    `Business name: ${profile.name}`,
    profile.category ? `Category: ${profile.category}` : null,
    profile.address ? `Address: ${profile.address}` : null,
    "",
    "Generate 4 varied monthly Google Business Profile posts for this business.",
  ]
    .filter(Boolean)
    .join("\n");

  const message = await anthropic.messages.parse({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    output_config: {
      format: zodOutputFormat(BatchPostsSchema),
    },
  });

  const parsed = message.parsed_output;
  if (!parsed) {
    throw new Error("Failed to parse structured output from Claude");
  }

  // Validate GBP hard limit of 1500 chars per post
  for (const post of parsed.posts) {
    if (post.content.length > 1500) {
      throw new Error(
        `Generated post exceeds GBP 1500-char limit: ${post.content.length} chars`
      );
    }
  }

  return parsed;
}
