import { z } from "zod";

/**
 * Most posts Claude is asked for in one call. A profile can want up to 30 a
 * month, so post-generator.ts splits bigger requests into calls of at most
 * this many; the schema's own cap sits above it so an answer that runs one or
 * two long never fails the parse.
 */
export const MAX_POSTS_PER_CALL = 12;

/**
 * Lengths and URLs are checked per post after the parse (post-generator.ts),
 * not here: a constraint in this schema fails the whole batch, so one post a
 * little over the 300-character style target, or one CTA that isn't a URL,
 * used to throw away every post in it. The prompt still asks for 150-300.
 */
export const GeneratedPostSchema = z.object({
  content: z.string().min(1),
  callToAction: z.string().optional(),
  callToActionUrl: z.string().optional(),
  suggestedType: z.enum(["WHATS_NEW", "EVENT", "OFFER"]),
});

export const BatchPostsSchema = z.object({
  posts: z.array(GeneratedPostSchema).min(1).max(MAX_POSTS_PER_CALL + 4),
});

export type GeneratedPost = z.infer<typeof GeneratedPostSchema>;
export type BatchPosts = z.infer<typeof BatchPostsSchema>;
