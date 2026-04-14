"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Send,
  Check,
  Trash2,
  RotateCcw,
  Clock,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface PostDetailDialogProps {
  post: {
    id: string;
    content: string;
    type: string;
    status: string;
    callToAction: string | null;
    scheduledAt: string | null;
    publishedAt: string | null;
    createdAt: string;
    errorMessage: string | null;
    profileName: string;
  };
  children: React.ReactNode;
}

const TYPE_LABELS: Record<string, string> = {
  WHATS_NEW: "What's New",
  EVENT: "Event",
  OFFER: "Offer",
};

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: typeof CheckCircle2; color: string }
> = {
  DRAFT: { label: "Draft", icon: Clock, color: "text-zinc-500" },
  APPROVED: { label: "Approved", icon: CheckCircle2, color: "text-blue-500" },
  SCHEDULED: { label: "Scheduled", icon: Clock, color: "text-amber-500" },
  PUBLISHED: { label: "Published", icon: CheckCircle2, color: "text-emerald-500" },
  FAILED: { label: "Failed", icon: AlertCircle, color: "text-red-500" },
};

function formatDate(date: string | null): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PostDetailDialog({ post, children }: PostDetailDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const statusConfig = STATUS_CONFIG[post.status] || STATUS_CONFIG.DRAFT;
  const StatusIcon = statusConfig.icon;

  async function handlePublishNow() {
    if (!confirm("Publish this post to Google now?")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/posts/${post.id}/publish`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to publish post");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      alert("Failed to publish post");
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove() {
    setLoading(true);
    try {
      const res = await fetch(`/api/posts/${post.id}/approve`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to approve post");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      alert("Failed to approve post");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this post?")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
      if (!res.ok) {
        alert("Failed to delete post");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      alert("Failed to delete post");
    } finally {
      setLoading(false);
    }
  }

  async function handleRetry() {
    setLoading(true);
    try {
      await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DRAFT" }),
      });
      const res = await fetch(`/api/posts/${post.id}/approve`, {
        method: "POST",
      });
      if (!res.ok) {
        alert("Failed to retry post");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      alert("Failed to retry post");
    } finally {
      setLoading(false);
    }
  }

  const canPublish =
    post.status === "DRAFT" ||
    post.status === "APPROVED" ||
    post.status === "SCHEDULED";

  return (
    <>
      <div onClick={() => setOpen(true)} className="cursor-pointer">
        {children}
      </div>

      <Dialog
        open={open}
        onOpenChange={(v) => !loading && setOpen(v)}
      >
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="text-lg">{post.profileName}</DialogTitle>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <Badge variant="secondary" className="text-[10px] uppercase tracking-wider font-bold">
                {TYPE_LABELS[post.type] || post.type}
              </Badge>
              <div className="flex items-center gap-1.5">
                <StatusIcon size={14} className={statusConfig.color} />
                <span className={`text-xs font-bold ${statusConfig.color}`}>
                  {statusConfig.label}
                </span>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Full post content */}
            <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-100">
              <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap">
                {post.content}
              </p>
            </div>

            {/* Call to action */}
            {post.callToAction && (
              <div>
                <p className="text-xs font-medium text-zinc-400 mb-1">
                  Call to Action
                </p>
                <p className="text-sm font-medium text-zinc-700">
                  {post.callToAction}
                </p>
              </div>
            )}

            {/* Dates */}
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-zinc-500">
              <span>Created: {formatDate(post.createdAt)}</span>
              {post.scheduledAt && (
                <span>Scheduled: {formatDate(post.scheduledAt)}</span>
              )}
              {post.publishedAt && (
                <span>Published: {formatDate(post.publishedAt)}</span>
              )}
            </div>

            {/* Error message */}
            {post.status === "FAILED" && post.errorMessage && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-lg">
                <p className="text-xs text-red-600">{post.errorMessage}</p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0 flex-wrap">
            {post.status === "DRAFT" && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleApprove}
                disabled={loading}
                className="text-emerald-700 border-emerald-300 hover:bg-emerald-50"
              >
                <Check size={14} className="mr-1.5" />
                Approve
              </Button>
            )}
            {canPublish && (
              <Button
                size="sm"
                onClick={handlePublishNow}
                disabled={loading}
                className="bg-violet-600 hover:bg-violet-700 text-white"
              >
                <Send size={14} className="mr-1.5" />
                {loading ? "Publishing..." : "Publish Now"}
              </Button>
            )}
            {post.status === "FAILED" && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRetry}
                disabled={loading}
                className="text-amber-700 border-amber-300 hover:bg-amber-50"
              >
                <RotateCcw size={14} className="mr-1.5" />
                Retry
              </Button>
            )}
            {(post.status === "DRAFT" || post.status === "FAILED") && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={loading}
              >
                <Trash2 size={14} className="mr-1.5" />
                Delete
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
