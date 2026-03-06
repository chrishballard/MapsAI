import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profiles = await prisma.profile.findMany({
    where: { isConnected: true },
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
