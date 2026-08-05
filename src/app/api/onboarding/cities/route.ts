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

  const cities = await prisma.profileCity.findMany({
    where: { profileId },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ cities });
}

export async function POST(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(
    request,
    z.object({
      profileId: idSchema,
      cities: z.array(z.string().max(120)).max(50),
    })
  );
  if (parsed.error) return parsed.error;
  const { profileId, cities } = parsed.data;

  const trimmed = cities.map((c) => c.trim()).filter(Boolean);
  if (trimmed.length > 3) {
    return NextResponse.json(
      { error: "Maximum 3 cities allowed" },
      { status: 400 }
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.profileCity.deleteMany({ where: { profileId } });
    await tx.profileCity.createMany({
      data: trimmed.map((city, i) => ({
        profileId,
        city,
        sortOrder: i,
      })),
    });
    return tx.profileCity.findMany({
      where: { profileId },
      orderBy: { sortOrder: "asc" },
    });
  });

  return NextResponse.json({ cities: result });
}
