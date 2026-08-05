import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const profiles = await prisma.profile.findMany({
    where: { isConnected: true, isOnboarded: true },
    select: {
      id: true,
      name: true,
      address: true,
      category: true,
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ profiles });
}
