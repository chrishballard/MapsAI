import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { idSchema, parseBody } from "@/lib/api-validation";

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
}
