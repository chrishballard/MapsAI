import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncLocationsForAccount } from "@/lib/google-locations";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const googleAccounts = await prisma.googleAccount.findMany();
    let totalSynced = 0;

    for (const account of googleAccounts) {
      const profiles = await syncLocationsForAccount(account.id);
      totalSynced += profiles.length;
    }

    return NextResponse.json({ count: totalSynced });
  } catch (error) {
    console.error("Profile sync error:", error);
    return NextResponse.json(
      { error: "Sync failed" },
      { status: 500 }
    );
  }
}
