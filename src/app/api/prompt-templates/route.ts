import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { idSchema, parseBody } from "@/lib/api-validation";
import { isPrismaError } from "@/lib/prisma-errors";

export async function GET() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const templates = await prisma.promptTemplate.findMany({
    include: { profile: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(templates);
}

export async function POST(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(
    request,
    z.object({
      name: z.string().min(1).max(200),
      prompt: z.string().min(1).max(20000),
      profileId: idSchema.nullish(),
      category: z.string().max(200).nullish(),
      isDefault: z.boolean().optional(),
    })
  );
  if (parsed.error) return parsed.error;
  const { name, prompt, profileId, category, isDefault } = parsed.data;

  try {
    const template = await prisma.promptTemplate.create({
      data: {
        name,
        prompt,
        profileId: profileId || null,
        category: category || null,
        isDefault: isDefault ?? false,
      },
      include: { profile: { select: { name: true } } },
    });

    return NextResponse.json(template, { status: 201 });
  } catch (err) {
    // A profile has at most one template, and so does each category and
    // default setting (the schema's unique keys).
    if (isPrismaError(err, "P2002")) {
      return NextResponse.json(
        { error: "A prompt template already exists for this profile or category" },
        { status: 409 }
      );
    }
    if (isPrismaError(err, "P2003")) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }
    throw err;
  }
}
