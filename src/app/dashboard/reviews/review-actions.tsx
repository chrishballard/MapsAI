"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, RefreshCw, CheckCheck } from "lucide-react";

interface ReviewActionsProps {
  reviewId: string;
  responseStatus: string | null;
}

export function ReviewActions({ reviewId, responseStatus }: ReviewActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  async function handleApprove() {
    setLoading("approve");
    try {
      const res = await fetch(`/api/reviews/${reviewId}/approve`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to approve response");
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to approve response");
    } finally {
      setLoading(null);
    }
  }

  async function handleRegenerate() {
    setLoading("regenerate");
    try {
      const res = await fetch(`/api/reviews/${reviewId}/generate`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to regenerate response");
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to regenerate response");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex items-center gap-2 mt-3">
      {responseStatus === "DRAFTED" && (
        <button
          onClick={handleApprove}
          disabled={loading !== null}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-green-700 border border-green-300 rounded-md hover:bg-green-50 transition-colors disabled:opacity-50"
        >
          <Check size={14} />
          {loading === "approve" ? "Approving..." : "Approve"}
        </button>
      )}
      {(responseStatus === "DRAFTED" || responseStatus === "FAILED" || responseStatus === null) && (
        <button
          onClick={handleRegenerate}
          disabled={loading !== null}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 border border-blue-300 rounded-md hover:bg-blue-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} />
          {loading === "regenerate" ? "Generating..." : responseStatus === null ? "Generate Response" : "Regenerate"}
        </button>
      )}
    </div>
  );
}

export function SyncButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSync() {
    setLoading(true);
    try {
      const res = await fetch("/api/reviews/sync", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to trigger sync");
        return;
      }
      alert("Review sync triggered! New reviews will appear shortly.");
      router.refresh();
    } catch {
      alert("Failed to trigger sync");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleSync}
      disabled={loading}
      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
    >
      <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
      {loading ? "Syncing..." : "Sync Reviews"}
    </button>
  );
}

interface BulkApproveButtonProps {
  profileId: string;
  draftCount: number;
}

export function BulkApproveButton({
  profileId,
  draftCount,
}: BulkApproveButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleBulkApprove() {
    if (!confirm(`Approve all ${draftCount} drafted responses?`)) return;

    setLoading(true);
    try {
      const res = await fetch("/api/reviews/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to approve responses");
        return;
      }
      const result = await res.json();
      alert(`${result.approved} responses approved and queued for publishing!`);
      router.refresh();
    } catch {
      alert("Failed to approve responses");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleBulkApprove}
      disabled={loading}
      className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
    >
      <CheckCheck size={16} />
      {loading ? "Approving..." : `Approve All (${draftCount})`}
    </button>
  );
}
