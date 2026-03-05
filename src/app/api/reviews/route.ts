import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get("profileId");
  const rating = searchParams.get("rating");
  const responseStatus = searchParams.get("responseStatus");

  const where: Prisma.ReviewWhereInput = {};
  if (profileId) where.profileId = profileId;
  if (rating) where.rating = parseInt(rating, 10);
  if (responseStatus) {
    where.response = {
      status: responseStatus as Prisma.EnumReviewResponseStatusFilter["equals"],
    };
  }

  const reviews = await prisma.review.findMany({
    where,
    include: {
      profile: { select: { id: true, name: true, category: true } },
      response: true,
    },
    orderBy: { reviewDate: "desc" },
  });

  return NextResponse.json({ reviews });
}
