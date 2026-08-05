import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseBody } from "@/lib/api-validation";

const patchTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  prompt: z.string().min(1).max(20000).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const parsed = await parseBody(request, patchTemplateSchema);
  if (parsed.error) return parsed.error;
  const { name, prompt } = parsed.data;

  const template = await prisma.promptTemplate.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(prompt !== undefined && { prompt }),
    },
    include: { profile: { select: { name: true } } },
  });

  return NextResponse.json(template);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  await prisma.promptTemplate.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
