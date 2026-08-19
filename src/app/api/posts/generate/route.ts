import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateMonthlyPosts } from "@/lib/post-generator";
import { markImagesUsed, isImageFkViolation } from "@/lib/post-images";
import { pickImagesForPostContents } from "@/lib/post-image-matcher";
import { PostType } from "@/generated/prisma/client";
import { z } from "zod";
import { idSchema, parseBody } from "@/lib/api-validation";

// Each profileId triggers Claude API calls — cap batch size.
const generatePostsSchema = z.object({
  profileIds: z.array(idSchema).min(1).max(100),
});

export async function POST(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(request, generatePostsSchema);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  const results: Array<{
    profileId: string;
    count: number;
    status: "success" | "error";
    error?: string;
  }> = [];

  // Process sequentially to avoid rate limits
  for (const profileId of body.profileIds) {
    try {
      const profile = await prisma.profile.findUnique({
        where: { id: profileId },
        include: { promptTemplate: true },
      });

      if (!profile) {
        results.push({
          profileId,
          count: 0,
          status: "error",
          error: "Profile not found",
        });
        continue;
      }

      const [keywordRecords, cityRecords] = await Promise.all([
        prisma.profileKeyword.findMany({
          where: { profileId: profile.id },
          orderBy: { sortOrder: "asc" },
        }),
        prisma.profileCity.findMany({
          where: { profileId: profile.id },
          orderBy: { sortOrder: "asc" },
        }),
      ]);

      const customPrompt = profile.promptTemplate?.prompt;
      const generated = await generateMonthlyPosts(
        {
          name: profile.name,
          category: profile.category,
          address: profile.address,
          keywords: keywordRecords.map((k) => k.keyword),
          cities: cityRecords.map((c) => c.city),
        },
        customPrompt ?? undefined,
        profile.postFrequency ?? 4
      );

      // Match a library image to each draft's content; an empty library
      // just means text-only posts (the picker never throws).
      const images = await pickImagesForPostContents(
        profile.id,
        generated.posts.map((post) => ({
          content: post.content,
          type: post.suggestedType,
        }))
      );

      // Save generated posts as DRAFT — atomically, so a mid-batch failure
      // can't leave a partial batch behind (which the future-scheduled-count
      // guard in the daily generation worker would never top up).
      const buildCreates = (withImages: boolean) =>
        generated.posts.map((post, i) =>
          prisma.post.create({
            data: {
              profileId: profile.id,
              type: post.suggestedType as PostType,
              content: post.content,
              callToAction: post.callToActionUrl ?? null,
              imageId: withImages ? (images[i] ?? null) : null,
              status: "DRAFT",
            },
          })
        );

      let createdPosts;
      try {
        createdPosts = await prisma.$transaction(buildCreates(true));
      } catch (err) {
        // A picked image can be deleted between selection and insert —
        // retry the batch text-only rather than discard the generation.
        if (!isImageFkViolation(err)) throw err;
        console.warn(
          `Picked image vanished mid-batch for ${profileId}, creating posts without images`
        );
        createdPosts = await prisma.$transaction(buildCreates(false));
      }

      await markImagesUsed(
        createdPosts.flatMap((p) => (p.imageId ? [p.imageId] : []))
      ).catch((err) =>
        console.warn(`Failed to record image usage for ${profileId}:`, err)
      );

      results.push({
        profileId,
        count: createdPosts.length,
        status: "success",
      });
    } catch (error) {
      console.error(`Generation failed for profile ${profileId}:`, error);
      results.push({
        profileId,
        count: 0,
        status: "error",
        error: "Generation failed",
      });
    }
  }

  return NextResponse.json({ results });
}
