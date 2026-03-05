import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const templates = await prisma.promptTemplate.findMany({
    include: { profile: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(templates);
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, prompt, profileId, category, isDefault } = body;

  if (!name || !prompt) {
    return NextResponse.json(
      { error: "Name and prompt are required" },
      { status: 400 }
    );
  }

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
