import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma, ReviewResponseStatus } from "@/generated/prisma/client";
import { idSchema, listLimitSchema, parseQuery } from "@/lib/api-validation";

// Filters are checked up front: a responseStatus that isn't one of the
// enum's values, or a rating that parses to NaN, used to reach the Prisma
// where clause, which throws, and came back as a 500.
const listReviewsQuery = z.object({
  profileId: idSchema.optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  responseStatus: z.enum(ReviewResponseStatus).optional(),
  limit: listLimitSchema,
});

export async function GET(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = parseQuery(request, listReviewsQuery);
  if (parsed.error) return parsed.error;
  const { profileId, rating, responseStatus, limit } = parsed.data;

  const where: Prisma.ReviewWhereInput = { removedAt: null };
  if (profileId) where.profileId = profileId;
  if (rating !== undefined) where.rating = rating;
  if (responseStatus) where.response = { status: responseStatus };

  const reviews = await prisma.review.findMany({
    where,
    include: {
      profile: { select: { id: true, name: true, category: true } },
      response: true,
    },
    orderBy: { reviewDate: "desc" },
    take: limit,
  });

  return NextResponse.json({ reviews });
}
