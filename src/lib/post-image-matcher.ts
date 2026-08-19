import { z } from "zod";
import { generate } from "./claude";
import { prisma } from "./prisma";
import { ensureApprovedPool, type ApprovedPoolImage } from "./post-images";
import { enqueueCaptionsForProfile } from "./queue/image-caption-queue";

export interface PostForMatching {
  content: string;
  type?: string;
}

/**
 * Cap on subject-specific photos sent to one matcher call. LRU-first, so
 * specifics omitted this batch naturally cycle into future ones. Generic
 * photos are NEVER sent — they're interchangeable by definition, so their
 * rotation stays mechanical (and Claude can't invent or favor one).
 */
export const MAX_SPECIFIC_IMAGES_SENT = 40;

export const GENERIC_CHOICE = "GENERIC";
export const NONE_CHOICE = "NONE";

export const MATCHER_SYSTEM_PROMPT = `You match a local business's Google Business Profile posts to photos from its library. The bar is coherence, not description: a photo must never look nonsensical next to its post. A subject-specific photo may only accompany a post it clearly fits; generic photos (storefront, team, logo, equipment, generic work) can accompany any post.`;

/** One line per specific photo for the matcher prompt: id, description, tags. */
export function formatSpecificImageLines(
  images: { id: string; description: string | null; tags: string[] }[]
): string[] {
  return images.map(
    (img) =>
      `- ${img.id}: ${img.description ?? "(no description)"}${
        img.tags.length > 0 ? ` (tags: ${img.tags.join(", ")})` : ""
      }`
  );
}

/** One numbered line per post for the matcher prompt. */
export function formatPostLines(posts: PostForMatching[]): string[] {
  return posts.map(
    (post, i) => `${i + 1}. [${post.type ?? "WHATS_NEW"}] ${post.content}`
  );
}

/**
 * Ask Claude which specific photo (if any) fits each post. Returns one
 * choice per post: a specific image id, GENERIC, or NONE. Throws on any
 * Claude failure — callers own their fallback. The structured-output enum
 * is built from the actual ids, so an out-of-pool id is structurally
 * impossible in the common case (and validated again in code regardless).
 */
export async function matchPostsToSpecificImages(args: {
  businessName: string | null;
  category: string | null;
  posts: PostForMatching[];
  specificImages: { id: string; description: string | null; tags: string[] }[];
  hasGenerics: boolean;
}): Promise<string[]> {
  const { businessName, category, posts, specificImages, hasGenerics } = args;

  const choiceSchema = z.enum([
    GENERIC_CHOICE,
    NONE_CHOICE,
    ...specificImages.map((img) => img.id),
  ] as [string, ...string[]]);
  const schema = z.object({
    choices: z.array(choiceSchema).length(posts.length),
  });

  const prompt = [
    businessName ? `Business: ${businessName}` : null,
    category ? `Category: ${category}` : null,
    "",
    "Posts to illustrate:",
    ...formatPostLines(posts),
    "",
    "Available subject-specific photos (least-recently-used first):",
    ...formatSpecificImageLines(specificImages),
    "",
    hasGenerics
      ? "Generic photos (storefront/team/logo) are also available; choose GENERIC to use one."
      : "No generic photos are available.",
    "",
    `Return one choice per post, in order (${posts.length} total):`,
    "- a specific photo's id ONLY when that photo clearly fits the post's subject (copy the id exactly from the list)",
    hasGenerics
      ? "- GENERIC when no specific photo fits"
      : "- GENERIC when no specific photo fits (none will be attached)",
    "- NONE when even a generic photo would look odd next to the post",
    "Never pick the same specific photo for two posts in this batch.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const result = await generate({
    system: MATCHER_SYSTEM_PROMPT,
    prompt,
    schema,
    maxTokens: 1024,
    errorMessage: "Failed to parse image choices from Claude",
  });

  return result.choices;
}

/**
 * Pick one library image id (or null) per generated post so text and photo
 * never clash. Same contract as pickImagesForPosts: same-length array,
 * never throws, degrades gracefully:
 *
 * 1. Empty library (after the throttled GBP auto-sync) -> all text-only.
 * 2. Zero captioned images -> legacy blind LRU rotation (status quo).
 * 3. Captioned but all generic -> mechanical generic LRU, no Claude call.
 * 4. Specifics exist -> one matcher call; Claude only decides fit, code
 *    resolves GENERIC picks round-robin (LRU fairness) and validates ids.
 * 5. Matcher failure -> generics-only rotation; no generics -> text-only.
 *    Once captions exist, an uncaptioned or specific image is never
 *    attached blind — a wrong photo is worse than no photo.
 */
export async function pickImagesForPostContents(
  profileId: string,
  posts: PostForMatching[]
): Promise<(string | null)[]> {
  if (posts.length === 0) return [];
  const none: (string | null)[] = new Array(posts.length).fill(null);

  try {
    const pool = await ensureApprovedPool(profileId);
    if (pool.length === 0) return none;

    // Self-heal: anything approved but uncaptioned gets queued so the next
    // batch can match it. Queue problems never affect this batch.
    if (pool.some((img) => !img.captionedAt)) {
      await enqueueCaptionsForProfile(profileId).catch(() => {});
    }

    const captioned = pool.filter((img) => img.captionedAt);
    if (captioned.length === 0) {
      // No captions yet (fresh library, backfill not run): exactly the
      // pre-matching behavior — blind LRU over the full pool.
      return posts.map((_, i) => pool[i % pool.length].id);
    }

    const generics = captioned.filter((img) => img.aiGeneric === true);
    const specifics = captioned.filter((img) => img.aiGeneric === false);

    if (specifics.length === 0) {
      if (generics.length === 0) return none;
      return posts.map((_, i) => generics[i % generics.length].id);
    }

    const sentSpecifics = specifics.slice(0, MAX_SPECIFIC_IMAGES_SENT);

    let choices: string[];
    try {
      const profile = await prisma.profile.findUnique({
        where: { id: profileId },
        select: { name: true, category: true },
      });
      choices = await matchPostsToSpecificImages({
        businessName: profile?.name ?? null,
        category: profile?.category ?? null,
        posts,
        specificImages: sentSpecifics.map((img) => ({
          id: img.id,
          description: img.aiDescription,
          tags: img.aiTags,
        })),
        hasGenerics: generics.length > 0,
      });
      if (choices.length !== posts.length) {
        throw new Error(
          `matcher returned ${choices.length} choices for ${posts.length} posts`
        );
      }
    } catch (err) {
      console.warn(
        `[post-image-matcher] Matching failed for profile ${profileId}, using generic rotation:`,
        err
      );
      if (generics.length === 0) return none;
      return posts.map((_, i) => generics[i % generics.length].id);
    }

    return resolveChoices(choices, sentSpecifics, generics);
  } catch (err) {
    console.warn(
      `[post-image-matcher] Image selection failed for profile ${profileId}:`,
      err
    );
    return none;
  }
}

/**
 * Turn Claude's per-post choices into image ids. Never trusts the wire:
 * unknown ids and batch-reused specifics demote to GENERIC (the model
 * wanted *an* image, and a generic can't clash); GENERIC resolves
 * round-robin over the LRU-ordered generic list; no generics means
 * text-only rather than risking a mismatched specific.
 */
function resolveChoices(
  choices: string[],
  sentSpecifics: ApprovedPoolImage[],
  generics: ApprovedPoolImage[]
): (string | null)[] {
  const validIds = new Set(sentSpecifics.map((img) => img.id));
  const usedSpecifics = new Set<string>();
  let genericCursor = 0;

  return choices.map((choice) => {
    if (choice === NONE_CHOICE) return null;

    let resolved = choice;
    if (
      resolved !== GENERIC_CHOICE &&
      (!validIds.has(resolved) || usedSpecifics.has(resolved))
    ) {
      resolved = GENERIC_CHOICE;
    }

    if (resolved === GENERIC_CHOICE) {
      if (generics.length === 0) return null;
      return generics[genericCursor++ % generics.length].id;
    }

    usedSpecifics.add(resolved);
    return resolved;
  });
}
