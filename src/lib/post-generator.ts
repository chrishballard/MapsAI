import { generate } from "./claude";
import {
  BatchPostsSchema,
  MAX_POSTS_PER_CALL,
  type BatchPosts,
  type GeneratedPost,
} from "./prompts/types";
import { getDefaultPrompt } from "./prompts/defaults";
import { US_ENGLISH_RULE } from "./copy-language";

interface ProfileInput {
  name: string;
  category: string | null;
  address: string | null;
  keywords?: string[];
  cities?: string[];
}

/** Google's hard limit for a post's text. */
export const GBP_POST_MAX_LENGTH = 1500;

/**
 * Cut a post that runs past Google's limit at its last sentence end (or,
 * failing that, its last word) inside the limit, so it still publishes.
 */
function trimToGbpLimit(content: string): string {
  if (content.length <= GBP_POST_MAX_LENGTH) return content;
  const head = content.slice(0, GBP_POST_MAX_LENGTH);
  const sentenceEnd = Math.max(
    head.lastIndexOf(". "),
    head.lastIndexOf("! "),
    head.lastIndexOf("? ")
  );
  if (sentenceEnd > GBP_POST_MAX_LENGTH / 2) return head.slice(0, sentenceEnd + 1);
  if (/[.!?]$/.test(head)) return head;
  const wordEnd = head.lastIndexOf(" ");
  return (wordEnd > 0 ? head.slice(0, wordEnd) : head).trimEnd();
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * The per-post checks the schema no longer makes (see prompts/types.ts): a
 * post over Google's limit is trimmed and a CTA that isn't a URL is dropped,
 * so one bad post never costs the rest of the batch.
 */
function cleanPost(post: GeneratedPost): GeneratedPost {
  const content = trimToGbpLimit(post.content.trim());
  if (content.length !== post.content.trim().length) {
    console.warn(
      `[post-generator] Trimmed a ${post.content.length}-char post to ${content.length} chars (GBP limit ${GBP_POST_MAX_LENGTH})`
    );
  }
  const { callToActionUrl, ...rest } = post;
  return {
    ...rest,
    content,
    ...(callToActionUrl && isHttpUrl(callToActionUrl) ? { callToActionUrl } : {}),
  };
}

function buildUserMessage(
  profile: ProfileInput,
  count: number,
  alreadyWritten: GeneratedPost[]
): string {
  return [
    `Business name: ${profile.name}`,
    profile.category ? `Category: ${profile.category}` : null,
    profile.address ? `Address: ${profile.address}` : null,
    profile.keywords?.length
      ? `\nTarget keywords (naturally incorporate 1-3 per post): ${profile.keywords.join(", ")}`
      : null,
    profile.cities?.length
      ? `Target cities/service areas: ${profile.cities.join(", ")}`
      : null,
    "",
    `Generate ${count} varied monthly Google Business Profile posts for this business.`,
    profile.keywords?.length
      ? "Naturally weave the target keywords into the posts — do not force them or list them."
      : null,
    alreadyWritten.length
      ? `\nThese posts are already written for this month. Do not repeat their topics or angles:\n${alreadyWritten
          .map((p) => `- ${p.content.slice(0, 160)}`)
          .join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Generate `postCount` posts. Requests above MAX_POSTS_PER_CALL go out as
 * several calls, each told what the earlier ones wrote so the month doesn't
 * repeat itself. If a later call fails, the posts already paid for are
 * returned rather than thrown away; only a failure with nothing to show
 * throws.
 */
export async function generateMonthlyPosts(
  profile: ProfileInput,
  customPrompt?: string,
  postCount: number = 4
): Promise<BatchPosts> {
  // A custom template replaces the default outright, so the language rule is
  // appended to whichever one is used rather than written into the defaults.
  const systemPrompt = `${customPrompt || getDefaultPrompt(profile.category)}

${US_ENGLISH_RULE}`;

  const posts: GeneratedPost[] = [];
  while (posts.length < postCount) {
    const count = Math.min(MAX_POSTS_PER_CALL, postCount - posts.length);
    let parsed: BatchPosts;
    try {
      parsed = await generate({
        system: systemPrompt,
        prompt: buildUserMessage(profile, count, posts),
        schema: BatchPostsSchema,
        // Was 2048 before thinking was always on.
        maxTokens: 8_192,
        effort: "medium",
        // Profiles sharing a template run back to back in the daily job.
        cacheSystem: true,
        label: "monthly-posts",
      });
    } catch (err) {
      if (posts.length === 0) throw err;
      console.warn(
        `[post-generator] Stopped at ${posts.length}/${postCount} posts for ${profile.name}:`,
        err
      );
      break;
    }

    posts.push(
      ...parsed.posts
        .slice(0, count)
        .map(cleanPost)
        .filter((p) => p.content.length > 0)
    );
    // Fewer than asked for: take what came back rather than loop on it.
    if (parsed.posts.length < count) break;
  }

  return { posts };
}
