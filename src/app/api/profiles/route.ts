import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * The profiles the app works on. By default that includes reviews-only
 * profiles (offboarded, reviews still synced), so the business selector can
 * reach their reviews settings. `?scope=posts` is onboarded profiles only:
 * a reviews-only profile gets no AI posts.
 */
export async function GET(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const forPosts = new URL(request.url).searchParams.get("scope") === "posts";

  const profiles = await prisma.profile.findMany({
    where: forPosts
      ? { isConnected: true, isOnboarded: true }
      : {
          isConnected: true,
          OR: [{ isOnboarded: true }, { reviewsOnly: true }],
        },
    select: {
      id: true,
      name: true,
      address: true,
      category: true,
      isOnboarded: true,
      reviewsOnly: true,
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ profiles });
}
