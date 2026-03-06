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
    where: {
      isConnected: true,
      OR: [
        { onboardingProgress: { is: null } },
        { onboardingProgress: { isComplete: false } },
      ],
    },
    select: {
      id: true,
      name: true,
      address: true,
      category: true,
      onboardingProgress: {
        select: {
          currentStep: true,
          completedSteps: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ profiles });
}
