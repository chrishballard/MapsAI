import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { reviewSyncQueue, initReviewSyncScheduler } from "@/lib/queue/review-sync-queue";

export async function POST() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  // Trigger immediate sync. If the job can't be queued (Redis down) no sync
  // is coming, so say so rather than telling the operator one is on its way.
  try {
    await reviewSyncQueue.add("manual-sync", {}, { delay: 0 });
  } catch (err) {
    console.error("Failed to queue review sync (Redis may be unavailable):", err);
    return NextResponse.json(
      { error: "Review sync could not be started. Please try again in a minute." },
      { status: 503 }
    );
  }

  // Ensure repeatable scheduler is active. The manual sync above is already
  // queued, so a failure here doesn't change the answer.
  try {
    await initReviewSyncScheduler();
  } catch (err) {
    console.warn("Failed to refresh the review sync scheduler:", err);
  }

  return NextResponse.json({ message: "Review sync triggered" });
}
