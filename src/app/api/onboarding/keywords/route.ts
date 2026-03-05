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

  if (!profileId) {
    return NextResponse.json(
      { error: "profileId is required" },
      { status: 400 }
    );
  }

  const keywords = await prisma.profileKeyword.findMany({
    where: { profileId },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ keywords });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { profileId, keywords } = body;

  if (!profileId || !Array.isArray(keywords)) {
    return NextResponse.json(
      { error: "profileId and keywords array required" },
      { status: 400 }
    );
  }

  const trimmed = keywords
    .map((kw: string) => kw.trim())
    .filter(Boolean);
  if (trimmed.length > 10) {
    return NextResponse.json(
      { error: "Maximum 10 keywords allowed" },
      { status: 400 }
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.profileKeyword.deleteMany({ where: { profileId } });
    await tx.profileKeyword.createMany({
      data: trimmed.map((keyword: string, i: number) => ({
        profileId,
        keyword,
        sortOrder: i,
      })),
    });
    return tx.profileKeyword.findMany({
      where: { profileId },
      orderBy: { sortOrder: "asc" },
    });
  });

  return NextResponse.json({ keywords: result });
}
