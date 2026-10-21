import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import {
  metricsSyncQueue,
  initMetricsSyncScheduler,
} from "@/lib/queue/metrics-sync-queue";
import { enqueueWithin } from "@/lib/queue/enqueue-deadline";

export async function POST(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  // Optional: pass ?days=365 to backfill historical data.
  // Parsed as integer, clamped to [1, 365], default 30; NaN is rejected.
  const { searchParams } = new URL(request.url);
  const rawDays = searchParams.get("days");
  const parsedDays = rawDays === null ? 30 : parseInt(rawDays, 10);
  if (Number.isNaN(parsedDays)) {
    return NextResponse.json(
      { error: "days must be an integer between 1 and 365" },
      { status: 400 }
    );
  }
  const days = Math.min(Math.max(parsedDays, 1), 365);

  // Trigger immediate sync with requested window. If the job can't be
  // queued (Redis down, which makes add() hang rather than throw, hence the
  // deadline) no sync is coming, so say so rather than telling the operator
  // one is on its way.
  try {
    await enqueueWithin(metricsSyncQueue.add("manual-sync", { days }, { delay: 0 }));
  } catch (err) {
    console.error(
      "Failed to queue metrics sync (Redis may be unavailable):",
      err
    );
    return NextResponse.json(
      { error: "Metrics sync could not be started. Please try again in a minute." },
      { status: 503 }
    );
  }

  // Ensure daily scheduler is active. The manual sync above is already
  // queued, so a failure here doesn't change the answer.
  try {
    await initMetricsSyncScheduler();
  } catch (err) {
    console.warn("Failed to refresh the metrics sync scheduler:", err);
  }

  return NextResponse.json({ message: `Metrics sync triggered (${days} days)` });
}
