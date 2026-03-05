import { z } from "zod";

export const GeneratedPostSchema = z.object({
  content: z
    .string()
    .max(300, "Post content must be 300 characters or fewer"),
  callToAction: z.string().optional(),
  callToActionUrl: z.string().url().optional(),
  suggestedType: z.enum(["WHATS_NEW", "EVENT", "OFFER"]),
});

export const BatchPostsSchema = z.object({
  posts: z.array(GeneratedPostSchema).length(4),
});

export type GeneratedPost = z.infer<typeof GeneratedPostSchema>;
export type BatchPosts = z.infer<typeof BatchPostsSchema>;
