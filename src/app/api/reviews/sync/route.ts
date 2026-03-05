import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { reviewSyncQueue, initReviewSyncScheduler } from "@/lib/queue/review-sync-queue";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Trigger immediate sync
    await reviewSyncQueue.add("manual-sync", {}, { delay: 0 });

    // Ensure repeatable scheduler is active
    await initReviewSyncScheduler();
  } catch (err) {
    console.warn("Failed to trigger review sync (Redis may be unavailable):", err);
  }

  return NextResponse.json({ message: "Review sync triggered" });
}
