import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  metricsSyncQueue,
  initMetricsSyncScheduler,
} from "@/lib/queue/metrics-sync-queue";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Optional: pass ?days=365 to backfill historical data
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "90", 10);

  try {
    // Trigger immediate sync with requested window
    await metricsSyncQueue.add("manual-sync", { days }, { delay: 0 });

    // Ensure daily scheduler is active
    await initMetricsSyncScheduler();
  } catch (err) {
    console.warn(
      "Failed to trigger metrics sync (Redis may be unavailable):",
      err
    );
  }

  return NextResponse.json({ message: `Metrics sync triggered (${days} days)` });
}
