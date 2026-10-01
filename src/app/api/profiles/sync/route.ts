import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncLocationsForAccount } from "@/lib/google-locations";

export async function POST() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  try {
    const allAccounts = await prisma.googleAccount.findMany();
    const googleAccounts = allAccounts.filter((a) => !a.needsReauth);
    // A login whose Google grant was revoked is skipped, but say so: its
    // locations never reach "Add a business" until it is reconnected.
    const needsReauth = allAccounts
      .filter((a) => a.needsReauth)
      .map((a) => a.googleEmail);
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
      ...(needsReauth.length > 0 ? { needsReauth } : {}),
    });
  } catch (error) {
    console.error("Profile sync error:", error);
    return NextResponse.json(
      { error: "Sync failed" },
      { status: 500 }
    );
  }
}
