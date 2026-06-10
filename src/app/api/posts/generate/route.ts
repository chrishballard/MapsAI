import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateMonthlyPosts } from "@/lib/post-generator";
import { PostType } from "@/generated/prisma/client";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { profileIds: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  if (!body.profileIds || !Array.isArray(body.profileIds) || body.profileIds.length === 0) {
    return NextResponse.json(
      { error: "profileIds must be a non-empty array" },
      { status: 400 }
    );
  }

  // Each profileId triggers Claude API calls — cap batch size.
  const MAX_PROFILE_IDS = 100;
  if (body.profileIds.length > MAX_PROFILE_IDS) {
    return NextResponse.json(
      { error: `profileIds cannot exceed ${MAX_PROFILE_IDS} items` },
      { status: 400 }
    );
  }

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

      // Save generated posts as DRAFT
      const createdPosts = await Promise.all(
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
        error: error instanceof Error ? error.message : "Generation failed",
      });
    }
  }

  return NextResponse.json({ results });
}
