import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { idSchema, parseBody } from "@/lib/api-validation";

export async function GET(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

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
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(
    request,
    z.object({
      profileId: idSchema,
      keywords: z.array(z.string().max(120)).max(50),
    })
  );
  if (parsed.error) return parsed.error;
  const { profileId, keywords } = parsed.data;

  const trimmed = keywords.map((kw) => kw.trim()).filter(Boolean);
  if (trimmed.length > 10) {
    return NextResponse.json(
      { error: "Maximum 10 keywords allowed" },
      { status: 400 }
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.profileKeyword.deleteMany({ where: { profileId } });
    await tx.profileKeyword.createMany({
      data: trimmed.map((keyword, i) => ({
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
