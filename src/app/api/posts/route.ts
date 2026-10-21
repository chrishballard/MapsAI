import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma, PostStatus, PostType } from "@/generated/prisma/client";
import { idSchema, listLimitSchema, parseQuery } from "@/lib/api-validation";

// Filters are checked against the enums up front: an unknown value used to
// reach the Prisma where clause, which throws, and came back as a 500.
const listPostsQuery = z.object({
  profileId: idSchema.optional(),
  status: z.enum(PostStatus).optional(),
  type: z.enum(PostType).optional(),
  limit: listLimitSchema,
});

export async function GET(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = parseQuery(request, listPostsQuery);
  if (parsed.error) return parsed.error;
  const { profileId, status, type, limit } = parsed.data;

  const where: Prisma.PostWhereInput = {};
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
    take: limit,
  });

  return NextResponse.json({ posts });
}
