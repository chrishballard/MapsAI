import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateMonthlyPosts } from "@/lib/post-generator";
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

      // Save generated posts as DRAFT — atomically, so a mid-batch failure
      // can't leave a partial batch behind (which the future-scheduled-count
      // guard in the daily generation worker would never top up).
      const createdPosts = await prisma.$transaction(
        generated.posts.map((post) =>
          prisma.post.create({
            data: {
              profileId: profile.id,
              type: post.suggestedType as PostType,
              content: post.content,
              callToAction: post.callToActionUrl ?? null,
              status: "DRAFT",
            },
          })
        )
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
