import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchAttributes } from "@/lib/google-business-info";

export async function GET(request: NextRequest) {
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

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { id: true, googleAccountId: true, locationName: true, category: true },
  });

  if (!profile) {
    return NextResponse.json(
      { error: "Profile not found" },
      { status: 404 }
    );
  }

  const result = await fetchAttributes({
    googleAccountId: profile.googleAccountId,
    locationName: profile.locationName,
    categoryId: profile.category ?? undefined,
  });

  if (result.attributes.length === 0 && !result.error) {
    return NextResponse.json({ attributes: [], empty: true });
  }

  return NextResponse.json({
    attributes: result.attributes,
    error: result.error,
  });
}
