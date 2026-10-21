import { z } from "zod";
import { generate } from "./claude";
import { pastedContent, PASTED_CONTENT_SYSTEM_NOTE } from "./pasted-content";
import { US_ENGLISH_RULE } from "./copy-language";

const DescriptionSchema = z.object({
  description: z.string(),
});

// The two rules from the prompt below that a draft can be checked against
// mechanically, and Google's own rules for the field: no links, no phone
// numbers. Promotional words and ALL CAPS stay prompt-only, because "best
// practices" and "HVAC" are fine and a check would refuse good drafts.
const URL_PATTERN =
  /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|biz|info|us|co|io)\b/i;
// North American numbers: ten digits with an optional +1, or seven with a
// separator. Needs the separators in the right places, so a year range
// ("1998-2024") or a ZIP code doesn't read as one.
const PHONE_PATTERN =
  /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|\b\d{3}[\s.-]\d{4}\b/;

const RULE_CHECKS = [
  { what: "a URL or web address", pattern: URL_PATTERN },
  { what: "a phone number", pattern: PHONE_PATTERN },
];

/**
 * The prompt rules a draft breaks, with the text that broke each. The
 * business name is blanked out first: a name like "Gutters.com Pros" is the
 * one domain-looking text the description is meant to carry.
 */
function ruleBreaks(
  description: string,
  businessName: string
): { what: string; match: string }[] {
  let checked = description;
  const name = businessName.trim();
  if (name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    checked = checked.replace(new RegExp(escaped, "gi"), " ");
  }

  const found: { what: string; match: string }[] = [];
  for (const { what, pattern } of RULE_CHECKS) {
    const match = checked.match(pattern);
    if (match) found.push({ what, match: match[0].trim() });
  }
  return found;
}

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
- If website content is provided, use it to understand the business's unique selling points, tone, and specific offerings

${US_ENGLISH_RULE}

${PASTED_CONTENT_SYSTEM_NOTE}`;

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
      ? `\nWebsite content (extracted from their site):\n${pastedContent(profile.websiteText)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const callClaude = async (messages: { role: "user" | "assistant"; content: string }[]) => {
    const parsed = await generate({
      system: systemPrompt,
      prompt: messages,
      schema: DescriptionSchema,
      // Was 1024 before thinking was always on; the description is ~750 chars.
      maxTokens: 8_192,
      effort: "medium",
      errorMessage: "Failed to parse description from Claude",
      label: "description",
    });
    return parsed.description;
  };

  const messages: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: userMessage },
  ];

  let description = await callClaude(messages);

  // Retry up to 2 times with exact character count feedback, and with what
  // was wrong when the draft breaks a rule it was given
  for (let attempt = 0; attempt < 2; attempt++) {
    const lengthOk = description.length >= 700 && description.length <= 750;
    const breaks = ruleBreaks(description, profile.name);
    if (lengthOk && breaks.length === 0) break;

    const lengthFeedback = lengthOk
      ? null
      : description.length < 700
        ? `That description is only ${description.length} characters. I need 720-745 characters. Please expand it with more detail about services, expertise, or service areas.`
        : `That description is ${description.length} characters, exceeding the 750 limit. Please shorten it to exactly 720-745 characters while keeping the most important content.`;
    const feedback = [
      lengthFeedback,
      ...breaks.map(
        (b) =>
          `The description includes ${b.what} ("${b.match}"), which the rules forbid. Remove it.`
      ),
    ]
      .filter(Boolean)
      .join(" ");

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

  // A rule break has no safe deterministic fix (cutting a phone number out
  // leaves a broken sentence), so refuse rather than hand the operator a
  // draft that Google's rules forbid. Generating again is one click.
  const remaining = ruleBreaks(description, profile.name);
  if (remaining.length > 0) {
    throw new Error(
      `Generated description still includes ${remaining
        .map((b) => b.what)
        .join(" and ")} after retries`
    );
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
