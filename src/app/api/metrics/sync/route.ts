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
