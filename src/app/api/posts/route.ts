import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get("profileId");
  const status = searchParams.get("status");
  const type = searchParams.get("type");

  const where: Record<string, string> = {};
  if (profileId) where.profileId = profileId;
  if (status) where.status = status;
  if (type) where.type = type;

  const posts = await prisma.post.findMany({
    where,
    include: {
      profile: {
        select: { name: true, category: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ posts });
}
