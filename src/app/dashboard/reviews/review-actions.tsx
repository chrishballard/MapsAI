"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Check,
  RefreshCw,
  CheckCheck,
  Pencil,
  ShieldAlert,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FetchError, fetchJson, sendJson } from "@/lib/fetch-json";
import { checkHealthcareReply } from "@/lib/healthcare";
import { GBP_REPLY_MAX_BYTES } from "@/lib/reviews-enabled";
import { cn } from "@/lib/utils";

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

interface ReviewReplyPanelProps {
  reviewId: string;
  reviewerName: string | null;
  response: {
    content: string;
    status: string;
    errorMessage: string | null;
  } | null;
  repliedExternally?: boolean;
  /** Review management is off for this profile — the API refuses every action. */
  reviewsDisabled?: boolean;
  /** The profile's Google category is a healthcare one (see lib/healthcare). */
  healthcare?: boolean;
  /** The one phone number a healthcare reply may contain. */
  officePhone?: string | null;
}

/**
 * A review's reply: its text, an editor for it, and Approve / Edit /
 * Regenerate. Approve publishes exactly the text shown here. For a
 * healthcare business, a reply that fails the privacy check lists what to
 * fix and can't be approved until it's edited.
 */
export function ReviewReplyPanel({
  reviewId,
  reviewerName,
  response,
  repliedExternally,
  reviewsDisabled,
  healthcare,
  officePhone,
}: ReviewReplyPanelProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(response?.content ?? "");
  const [error, setError] = useState<string | null>(null);

  // Reviews already replied to outside RankMaps are off-limits —
  // no generating, editing, approving, or publishing.
  const actionable = !repliedExternally && !reviewsDisabled;
  const status = response?.status ?? null;
  const editable = status === null || status === "DRAFTED" || status === "FAILED";

  const shownText = editing ? draft : response?.content ?? "";
  const issues =
    healthcare && (editing || status === "DRAFTED")
      ? checkHealthcareReply(shownText, { reviewerName, officePhone })
      : [];
  const draftBytes = byteLength(draft.trim());
  const draftTooLong = draftBytes > GBP_REPLY_MAX_BYTES;

  async function run(action: string, request: () => Promise<unknown>) {
    setLoading(action);
    setError(null);
    try {
      await request();
      return true;
    } catch (err) {
      setError(err instanceof FetchError ? err.message : `Failed to ${action}`);
      return false;
    } finally {
      setLoading(null);
    }
  }

  async function handleApprove() {
    // Send the text on screen: the server refuses if the stored draft no
    // longer matches it, so Approve never publishes unseen text.
    const ok = await run("approve", () =>
      sendJson(`/api/reviews/${reviewId}/approve`, {
        content: response?.content,
      })
    );
    if (ok) router.refresh();
  }

  async function handleRegenerate() {
    const ok = await run("regenerate", () =>
      fetchJson(`/api/reviews/${reviewId}/generate`, { method: "POST" })
    );
    if (ok) router.refresh();
  }

  async function handleSave() {
    const ok = await run("save", () =>
      sendJson(`/api/reviews/${reviewId}/response`, { content: draft }, "PATCH")
    );
    if (ok) {
      setEditing(false);
      router.refresh();
    }
  }

  function startEditing() {
    setDraft(response?.content ?? "");
    setError(null);
    setEditing(true);
  }

  const busy = loading !== null;

  return (
    <div className="mt-3 space-y-3">
      {(response || editing) && (
        <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-100">
          <p className="text-xs font-medium text-zinc-400 mb-1">
            {editing ? "Edit reply" : status === "PUBLISHED" ? "Reply" : "Draft reply"}
          </p>
          {editing ? (
            <>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={5}
                autoFocus
                aria-label="Reply text"
                className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900 bg-white focus:ring-4 focus:ring-brand-50 focus:border-brand-300 outline-none resize-y"
              />
              <p
                className={cn(
                  "text-xs mt-1",
                  draftTooLong ? "text-red-600" : "text-zinc-400"
                )}
              >
                {draftBytes}/{GBP_REPLY_MAX_BYTES} bytes
              </p>
            </>
          ) : (
            <p className="text-sm text-zinc-600 whitespace-pre-line">
              {response?.content}
            </p>
          )}
          {!editing && response?.errorMessage && status === "FAILED" && (
            <p className="text-xs text-red-600 mt-2 truncate">
              Error: {response.errorMessage}
            </p>
          )}
          {!editing &&
            response?.errorMessage &&
            (status === "SKIPPED" || status === "DRAFTED") && (
              <p className="text-xs text-amber-600 mt-2">
                {response.errorMessage}
              </p>
            )}
        </div>
      )}

      {actionable && issues.length > 0 && (
        <div
          className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3"
          role="status"
        >
          <ShieldAlert size={16} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-900">
            <p className="font-medium">
              Not safe to publish for a healthcare business. Edit out:
            </p>
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              {issues.map((issue) => (
                <li key={issue.reason}>
                  {issue.reason}: &ldquo;{issue.match}&rdquo;
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}

      {actionable && (
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={busy || !draft.trim() || draftTooLong}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {loading === "save" && <Loader2 size={14} className="animate-spin" />}
                {loading === "save" ? "Saving..." : "Save draft"}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                disabled={busy}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-zinc-600 border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {status === "DRAFTED" && (
                <button
                  onClick={handleApprove}
                  disabled={busy || issues.length > 0}
                  title={
                    issues.length > 0
                      ? "Edit the reply until the warnings above are gone"
                      : "Publish this reply to Google exactly as shown"
                  }
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-700 border border-emerald-300 rounded-lg hover:bg-emerald-50 transition-colors disabled:opacity-50"
                >
                  <Check size={14} />
                  {loading === "approve" ? "Approving..." : "Approve"}
                </button>
              )}
              {editable && (
                <button
                  onClick={startEditing}
                  disabled={busy}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-zinc-700 border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors disabled:opacity-50"
                >
                  <Pencil size={14} />
                  {status === null ? "Write reply" : "Edit"}
                </button>
              )}
              {editable && (
                <button
                  onClick={handleRegenerate}
                  disabled={busy}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-brand-700 border border-brand-300 rounded-lg hover:bg-brand-50 transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={14} />
                  {loading === "regenerate"
                    ? "Generating..."
                    : status === null
                      ? "Generate Response"
                      : "Regenerate"}
                </button>
              )}
            </>
          )}
        </div>
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
      className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
    >
      <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
      {loading ? "Syncing..." : "Sync Reviews"}
    </button>
  );
}

interface BulkApproveButtonProps {
  profileId: string;
  draftCount: number;
  /** Healthcare profiles have no Approve all: each reply is read and approved on its own. */
  healthcare?: boolean;
}

/**
 * Approve all publishes every live draft on the profile exactly as written,
 * so it asks the operator to type the number of replies before it runs.
 * The server checks that number against its own count and approves
 * nothing if they differ.
 */
export function BulkApproveButton({
  profileId,
  draftCount,
  healthcare,
}: BulkApproveButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (healthcare) {
    return (
      <span
        className="inline-flex items-center gap-2 px-3 py-2 text-sm text-zinc-500 border border-zinc-200 rounded-md"
        title="A reply that confirms someone is a patient, or repeats their visit, treatment or bill, can break HIPAA. Read and approve each reply on its own."
      >
        <ShieldAlert size={16} className="text-amber-600" />
        Approve all is off for healthcare
      </span>
    );
  }

  const confirmed = typed.trim() === String(draftCount);

  async function handleBulkApprove() {
    setLoading(true);
    setError(null);
    try {
      const result = await sendJson<{ approved: number }>(
        "/api/reviews/approve",
        { profileId, confirmCount: draftCount }
      );
      setOpen(false);
      alert(`${result.approved} responses approved and queued for publishing!`);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof FetchError ? err.message : "Failed to approve responses"
      );
      if (err instanceof FetchError && err.status === 409) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setTyped("");
          setError(null);
          setOpen(true);
        }}
        className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
      >
        <CheckCheck size={16} />
        {`Approve All (${draftCount})`}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Publish {draftCount} {draftCount === 1 ? "reply" : "replies"} to Google?
            </DialogTitle>
            <DialogDescription>
              Every pending draft for this business goes to Google exactly as
              written, about 8 a minute, including any you haven&apos;t read.
              They can&apos;t be edited in RankMaps afterwards. To check them
              one at a time, cancel and use Approve on each review instead.
            </DialogDescription>
          </DialogHeader>
          <label className="block text-sm text-zinc-700">
            Type <span className="font-semibold">{draftCount}</span> to confirm
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              inputMode="numeric"
              autoFocus
              aria-label="Number of replies to publish"
              className="mt-1 w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 focus:ring-4 focus:ring-brand-50 focus:border-brand-300 outline-none"
            />
          </label>
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button
              onClick={handleBulkApprove}
              disabled={!confirmed || loading}
              className="bg-green-600 text-white hover:bg-green-700"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Publish {draftCount} {draftCount === 1 ? "reply" : "replies"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
