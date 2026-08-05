import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncLocationsForAccount } from "@/lib/google-locations";

export async function POST() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  try {
    const googleAccounts = await prisma.googleAccount.findMany({
      where: { needsReauth: false },
    });
    let totalSynced = 0;
    const failures: string[] = [];

    for (const account of googleAccounts) {
      try {
        const profiles = await syncLocationsForAccount(account.id);
        totalSynced += profiles.length;
      } catch (error) {
        console.error(
          `Profile sync failed for ${account.googleEmail}:`,
          error instanceof Error ? error.message : error
        );
        failures.push(account.googleEmail);
      }
    }

    return NextResponse.json({
      count: totalSynced,
      ...(failures.length > 0 ? { failedAccounts: failures } : {}),
    });
  } catch (error) {
    console.error("Profile sync error:", error);
    return NextResponse.json(
      { error: "Sync failed" },
      { status: 500 }
    );
  }
}
