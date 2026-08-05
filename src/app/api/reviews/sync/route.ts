import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { reviewSyncQueue, initReviewSyncScheduler } from "@/lib/queue/review-sync-queue";

export async function POST() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

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
