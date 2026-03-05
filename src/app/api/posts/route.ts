import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
