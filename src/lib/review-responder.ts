import { z } from "zod";
import { anthropic } from "./claude";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

export const ReviewResponseSchema = z.object({
  response: z.string(),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  tone: z.string(),
});

export type ReviewResponseOutput = z.infer<typeof ReviewResponseSchema>;

interface GenerateReviewResponseInput {
  businessName: string;
  businessCategory: string | null;
  reviewerName: string | null;
  starRating: number;
  reviewComment: string | null;
}

const SYSTEM_PROMPT = `You are a professional business owner responding to Google Business Profile reviews. Write authentic, personalized responses that reflect genuine care for customers.

Guidelines by rating:
- 5 stars: Thank them warmly, reference specific details they mentioned, invite them back. Keep it genuine, not overly effusive.
- 4 stars: Express gratitude, acknowledge their positive experience, gently ask if there's anything you could improve.
- 3 stars: Thank them for the feedback, acknowledge both positives and concerns, offer to make things right.
- 2 stars: Express sincere concern, apologize for the disappointing experience, take responsibility, offer to discuss privately.
- 1 star: Lead with empathy and a genuine apology, take ownership, provide a way to reach out directly to resolve the issue.

Rules:
- Keep responses under 4096 bytes
- Do not use excessive emojis
- Use an authentic, professional tone — not corporate or robotic
- If the reviewer's name is provided, address them by name
- If there is no comment (rating only), still write a brief, appropriate response based on the star rating
- Never be defensive or argumentative, even for negative reviews`;

export async function generateReviewResponse(
  input: GenerateReviewResponseInput
): Promise<ReviewResponseOutput> {
  const { businessName, businessCategory, reviewerName, starRating, reviewComment } = input;

  const userMessage = [
    `Business: ${businessName}`,
    businessCategory ? `Category: ${businessCategory}` : null,
    `Reviewer: ${reviewerName || "Anonymous"}`,
    `Rating: ${starRating} out of 5 stars`,
    "",
    reviewComment
      ? `Review comment: "${reviewComment}"`
      : "No comment provided (rating only)",
    "",
    "Generate an appropriate response to this review.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const message = await anthropic.messages.parse({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    output_config: {
      format: zodOutputFormat(ReviewResponseSchema),
    },
  });

  const parsed = message.parsed_output;
  if (!parsed) {
    throw new Error("Failed to parse structured output from Claude");
  }

  return parsed;
}
