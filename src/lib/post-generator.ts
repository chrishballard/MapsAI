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
 * Cut a post that runs past Google's limit at its last sentence end inside
 * the limit, so it still publishes. null when there's no sentence end in the
 * back half to cut at: cutting at a word would publish an unfinished
 * sentence, so the post is dropped instead.
 */
function trimToGbpLimit(content: string): string | null {
  if (content.length <= GBP_POST_MAX_LENGTH) return content;
  const head = content.slice(0, GBP_POST_MAX_LENGTH);
  if (/[.!?]$/.test(head) && /\s/.test(content[GBP_POST_MAX_LENGTH])) return head;
  const sentenceEnd = Math.max(
    head.lastIndexOf(". "),
    head.lastIndexOf("! "),
    head.lastIndexOf("? ")
  );
  return sentenceEnd > GBP_POST_MAX_LENGTH / 2 ? head.slice(0, sentenceEnd + 1) : null;
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
 * post over Google's limit is trimmed (or dropped, see trimToGbpLimit) and a
 * CTA that isn't a URL is dropped, so one bad post never costs the rest of
 * the batch. null = drop the post.
 */
function cleanPost(post: GeneratedPost): GeneratedPost | null {
  const original = post.content.trim();
  if (!original) return null;
  const content = trimToGbpLimit(original);
  if (content === null) {
    console.warn(
      `[post-generator] Dropped a ${original.length}-char post with no sentence end to trim at (GBP limit ${GBP_POST_MAX_LENGTH})`
    );
    return null;
  }
  if (content.length !== original.length) {
    console.warn(
      `[post-generator] Trimmed a ${original.length}-char post to ${content.length} chars (GBP limit ${GBP_POST_MAX_LENGTH})`
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

  // One spare call past the chunks needed, for an answer that came back
  // short after cleaning; never an open-ended loop of paid calls.
  const maxCalls = Math.ceil(postCount / MAX_POSTS_PER_CALL) + 1;
  const posts: GeneratedPost[] = [];
  for (let call = 0; call < maxCalls && posts.length < postCount; call++) {
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
        .filter((p): p is GeneratedPost => p !== null)
    );
    // Fewer than asked for: take what came back rather than loop on it.
    if (parsed.posts.length < count) break;
  }

  if (posts.length < postCount) {
    console.warn(
      `[post-generator] Generated ${posts.length} of ${postCount} requested posts for ${profile.name}`
    );
  }

  return { posts };
}
