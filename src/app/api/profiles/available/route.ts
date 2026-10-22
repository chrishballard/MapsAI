import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hideCopiesOfOnboardedLocations } from "@/lib/location-copies";

export async function GET() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  // A location already onboarded under another login's row is not offered
  // again: onboarding the second copy would post and reply twice.
  const notACopy = await hideCopiesOfOnboardedLocations();
  const profiles = await prisma.profile.findMany({
    where: { isConnected: true, isOnboarded: false, ...notACopy },
    select: {
      id: true,
      name: true,
      address: true,
      category: true,
      googleAccount: { select: { googleEmail: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ profiles });
}
