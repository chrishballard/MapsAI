"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, CheckCheck, RotateCcw, Trash2, Send } from "lucide-react";

interface PostActionsProps {
  postId: string;
  status: string;
}

export function PostActions({ postId, status }: PostActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleApprove() {
    setLoading(true);
    try {
      const res = await fetch(`/api/posts/${postId}/approve`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to approve post");
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to approve post");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this draft post?")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to delete post");
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to delete post");
    } finally {
      setLoading(false);
    }
  }

  async function handlePublishNow() {
    if (!confirm("Publish this post to Google now?")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/posts/${postId}/publish`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to publish post");
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to publish post");
    } finally {
      setLoading(false);
    }
  }

  async function handleRetry() {
    setLoading(true);
    try {
      // Reset to DRAFT first, then approve
      const patchRes = await fetch(`/api/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DRAFT" }),
      });
      if (!patchRes.ok) {
        alert("Failed to reset post");
        return;
      }
      const approveRes = await fetch(`/api/posts/${postId}/approve`, {
        method: "POST",
      });
      if (!approveRes.ok) {
        const data = await approveRes.json();
        alert(data.error || "Failed to re-approve post");
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to retry post");
    } finally {
      setLoading(false);
    }
  }

  if (status === "DRAFT") {
    return (
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={handleApprove}
          disabled={loading}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-700 border border-emerald-300 rounded-lg hover:bg-emerald-50 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <Check size={14} />
          {loading ? "Approving..." : "Approve"}
        </button>
        <button
          onClick={handlePublishNow}
          disabled={loading}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-violet-700 border border-violet-300 rounded-lg hover:bg-violet-50 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <Send size={14} />
          {loading ? "Publishing..." : "Publish Now"}
        </button>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <Trash2 size={14} />
          Delete
        </button>
      </div>
    );
  }

  if (status === "APPROVED" || status === "SCHEDULED") {
    return (
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={handlePublishNow}
          disabled={loading}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-violet-700 border border-violet-300 rounded-lg hover:bg-violet-50 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <Send size={14} />
          {loading ? "Publishing..." : "Publish Now"}
        </button>
      </div>
    );
  }

  if (status === "FAILED") {
    return (
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={handleRetry}
          disabled={loading}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-50 transition-colors disabled:opacity-50"
        >
          <RotateCcw size={14} />
          {loading ? "Retrying..." : "Retry"}
        </button>
      </div>
    );
  }

  return null;
}

interface BulkApproveButtonProps {
  profileId: string;
  profileName: string;
  draftCount: number;
}

export function BulkApproveButton({
  profileId,
  profileName,
  draftCount,
}: BulkApproveButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleBulkApprove() {
    if (
      !confirm(
        `Approve all ${draftCount} draft posts for ${profileName}?`
      )
    )
      return;

    setLoading(true);
    try {
      const res = await fetch("/api/posts/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to approve posts");
        return;
      }
      const result = await res.json();
      alert(`${result.approved} posts approved and scheduled!`);
      router.refresh();
    } catch {
      alert("Failed to approve posts");
    } finally {
      setLoading(false);
    }
  }

  if (draftCount === 0) return null;

  return (
    <button
      onClick={handleBulkApprove}
      disabled={loading}
      className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
    >
      <CheckCheck size={16} />
      {loading ? "Approving..." : `Approve All (${draftCount})`}
    </button>
  );
}
