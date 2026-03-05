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

  const cities = await prisma.profileCity.findMany({
    where: { profileId },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ cities });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { profileId, cities } = body;

  if (!profileId || !Array.isArray(cities)) {
    return NextResponse.json(
      { error: "profileId and cities array required" },
      { status: 400 }
    );
  }

  const trimmed = cities
    .map((c: string) => c.trim())
    .filter(Boolean);
  if (trimmed.length > 3) {
    return NextResponse.json(
      { error: "Maximum 3 cities allowed" },
      { status: 400 }
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.profileCity.deleteMany({ where: { profileId } });
    await tx.profileCity.createMany({
      data: trimmed.map((city: string, i: number) => ({
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
