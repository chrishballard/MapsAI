"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import NextImage from "next/image";
import {
  Upload,
  RefreshCw,
  Link2,
  Check,
  Copy,
  EyeOff,
  Eye,
  Trash2,
  Image as ImageIcon,
  CloudDownload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { prepareImageForUpload } from "@/lib/client-image";
import { fetchJson, sendJson, FetchError } from "@/lib/fetch-json";
import { MAX_FILES_PER_UPLOAD } from "@/lib/image-validation";
import { formatMediumDate } from "@/lib/dates";
import type { ImageListItem } from "@/lib/image-library";
import type { StoredFileResult } from "@/lib/image-upload";

interface ImageLibraryProps {
  profileId: string;
  profileName: string;
  canSyncFromGoogle: boolean;
  lastSyncedAt: string | null;
  initialUploadLinkUrl: string | null;
  images: ImageListItem[];
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof FetchError ? err.message : fallback;
}

const SOURCE_BADGES: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  GBP: { label: "Google", variant: "default" },
  TEAM: { label: "Team", variant: "secondary" },
  CLIENT: { label: "Client", variant: "outline" },
};

function formatCategory(category: string | null): string | null {
  if (!category || category === "CATEGORY_UNSPECIFIED") return null;
  return category.charAt(0) + category.slice(1).toLowerCase().replace(/_/g, " ");
}

export function ImageLibrary({
  profileId,
  profileName,
  canSyncFromGoogle,
  lastSyncedAt,
  initialUploadLinkUrl,
  images,
}: ImageLibraryProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [busyImageId, setBusyImageId] = useState<string | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [uploadLinkUrl, setUploadLinkUrl] = useState(initialUploadLinkUrl);
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const pending = images.filter((img) => img.status === "PENDING");
  const active = images.filter((img) => img.status !== "PENDING");

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setUploading(true);
    try {
      // The API caps files per request — send big selections in chunks so
      // nothing is silently dropped.
      const failures: StoredFileResult[] = [];
      for (let i = 0; i < files.length; i += MAX_FILES_PER_UPLOAD) {
        const chunk = files.slice(i, i + MAX_FILES_PER_UPLOAD);
        const form = new FormData();
        form.append("profileId", profileId);
        for (const file of chunk) {
          const prepared = await prepareImageForUpload(file);
          form.append("files", prepared.blob, prepared.fileName);
        }

        const data = await fetchJson<{ results: StoredFileResult[] }>(
          "/api/images",
          { method: "POST", body: form }
        );
        failures.push(...(data.results ?? []).filter((r) => !r.ok));
      }

      if (failures.length > 0) {
        alert(
          "Some photos were not accepted:\n" +
            failures.map((f) => `• ${f.fileName}: ${f.error}`).join("\n")
        );
      }
      router.refresh();
    } catch (err) {
      alert(errorMessage(err, "Upload failed"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const data = await sendJson<{
        added: number;
        removed: number;
        total: number;
      }>("/api/images/sync", { profileId });
      setSyncMessage(
        `Synced from Google: ${data.added} new, ${data.removed} removed (${data.total} photos on the profile)`
      );
      router.refresh();
    } catch (err) {
      alert(errorMessage(err, "Sync failed"));
    } finally {
      setSyncing(false);
    }
  }

  async function setImageStatus(imageId: string, status: string) {
    setBusyImageId(imageId);
    try {
      await sendJson(`/api/images/${imageId}`, { status }, "PATCH");
      router.refresh();
    } catch (err) {
      alert(errorMessage(err, "Update failed"));
    } finally {
      setBusyImageId(null);
    }
  }

  async function handleDelete(imageId: string) {
    if (!confirm("Remove this photo from the library?")) return;
    setBusyImageId(imageId);
    try {
      await fetchJson(`/api/images/${imageId}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      alert(errorMessage(err, "Delete failed"));
    } finally {
      setBusyImageId(null);
    }
  }

  async function handleApproveAll() {
    setBusyImageId("all");
    try {
      // One bulk update server-side instead of a request per photo.
      await sendJson(
        "/api/images",
        { profileId, from: "PENDING", to: "APPROVED" },
        "PATCH"
      );
      router.refresh();
    } catch (err) {
      alert(errorMessage(err, "Approve failed"));
    } finally {
      setBusyImageId(null);
    }
  }

  async function manageLink(action: "create" | "disable") {
    setLinkBusy(true);
    try {
      const data =
        action === "create"
          ? await sendJson<{ url: string | null }>("/api/images/upload-link", {
              profileId,
            })
          : await fetchJson<{ url: string | null }>(
              `/api/images/upload-link?profileId=${encodeURIComponent(profileId)}`,
              { method: "DELETE" }
            );
      setUploadLinkUrl(data.url);
      setCopied(false);
    } catch (err) {
      alert(errorMessage(err, "Failed to update the link"));
    } finally {
      setLinkBusy(false);
    }
  }

  async function copyLink() {
    if (!uploadLinkUrl) return;
    try {
      await navigator.clipboard.writeText(uploadLinkUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert(uploadLinkUrl);
    }
  }

  return (
    <div className="space-y-8">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="gap-2"
        >
          <Upload className="w-4 h-4" />
          {uploading ? "Uploading..." : "Upload photos"}
        </Button>
        {canSyncFromGoogle && (
          <Button
            variant="outline"
            onClick={handleSync}
            disabled={syncing}
            className="gap-2"
          >
            <CloudDownload className="w-4 h-4" />
            {syncing ? "Syncing..." : "Sync from Google"}
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => setLinkDialogOpen(true)}
          className="gap-2"
        >
          <Link2 className="w-4 h-4" />
          Client upload link
        </Button>
        <span className="text-xs text-zinc-400">
          {syncMessage ??
            (lastSyncedAt
              ? `Last synced from Google ${formatMediumDate(lastSyncedAt)}`
              : null)}
        </span>
      </div>

      {/* Pending client uploads */}
      {pending.length > 0 && (
        <Card className="p-6 border-amber-200 bg-amber-50/50">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-zinc-900">
                {pending.length} client photo{pending.length === 1 ? "" : "s"}{" "}
                waiting for review
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Photos sent through the client upload link join the post
                rotation once approved.
              </p>
            </div>
            <Button
              size="sm"
              onClick={handleApproveAll}
              disabled={busyImageId !== null}
              className="gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              Approve all
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {pending.map((img) => (
              <div key={img.id} className="group relative">
                <div className="relative aspect-[4/3] rounded-lg overflow-hidden bg-zinc-100 border border-zinc-200">
                  <NextImage
                    src={img.url}
                    alt={`Pending photo for ${profileName}`}
                    fill
                    sizes="200px"
                    unoptimized
                    className="object-cover"
                  />
                </div>
                <div className="flex gap-1.5 mt-2">
                  <Button
                    size="sm"
                    className="flex-1 h-7 text-xs"
                    disabled={busyImageId !== null}
                    onClick={() => setImageStatus(img.id, "APPROVED")}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 h-7 text-xs"
                    disabled={busyImageId !== null}
                    onClick={() => setImageStatus(img.id, "HIDDEN")}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Library grid */}
      {active.length === 0 && pending.length === 0 ? (
        <Card className="flex flex-col items-center text-center py-16">
          <div className="w-16 h-16 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-400 mb-4">
            <ImageIcon size={32} />
          </div>
          <h2 className="text-lg font-semibold text-zinc-900 mb-2">
            No photos yet
          </h2>
          <p className="text-zinc-500 mb-6 max-w-md">
            Sync the profile&apos;s existing Google photos, upload some, or
            send the client an upload link. New posts automatically rotate
            through approved photos.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {active.map((img) => {
            const sourceBadge = SOURCE_BADGES[img.source] ?? SOURCE_BADGES.TEAM;
            const hidden = img.status === "HIDDEN";
            const category = formatCategory(img.category);
            return (
              <div key={img.id} className="group">
                <div
                  className={`relative aspect-[4/3] rounded-lg overflow-hidden bg-zinc-100 border border-zinc-200 ${
                    hidden ? "opacity-40" : ""
                  }`}
                >
                  <NextImage
                    src={img.url}
                    alt={`Photo for ${profileName}`}
                    fill
                    sizes="240px"
                    unoptimized
                    className="object-cover"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                    {hidden ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-8 gap-1.5"
                        disabled={busyImageId !== null}
                        onClick={() => setImageStatus(img.id, "APPROVED")}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Show
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-8 gap-1.5"
                        disabled={busyImageId !== null}
                        onClick={() => setImageStatus(img.id, "HIDDEN")}
                      >
                        <EyeOff className="w-3.5 h-3.5" />
                        Hide
                      </Button>
                    )}
                    {img.source !== "GBP" && (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-8"
                        disabled={busyImageId !== null}
                        onClick={() => handleDelete(img.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Badge
                      variant={sourceBadge.variant}
                      className="text-[9px] uppercase tracking-wider font-bold shrink-0"
                    >
                      {sourceBadge.label}
                    </Badge>
                    {hidden && (
                      <span className="text-[10px] text-zinc-400 font-medium">
                        Hidden
                      </span>
                    )}
                    {category && !hidden && (
                      <span className="text-[10px] text-zinc-400 truncate">
                        {category}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-zinc-400 shrink-0">
                    {img.timesUsed > 0
                      ? `Used ${img.timesUsed}x`
                      : "Not used yet"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Client upload link dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Client upload link</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-zinc-500">
              Share this link with {profileName} — it opens a simple page
              where they can send photos straight from their phone. New
              photos wait for your approval before entering the post
              rotation.
            </p>
            {uploadLinkUrl ? (
              <>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={uploadLinkUrl}
                    className="flex-1 text-xs px-3 py-2 rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-600 font-mono"
                    onFocus={(e) => e.target.select()}
                  />
                  <Button size="sm" onClick={copyLink} className="gap-1.5 shrink-0">
                    {copied ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={linkBusy}
                    onClick={() => manageLink("create")}
                    className="gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Rotate link
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={linkBusy}
                    onClick={() => manageLink("disable")}
                    className="text-red-600 border-red-200 hover:bg-red-50"
                  >
                    Disable link
                  </Button>
                </div>
                <p className="text-xs text-zinc-400">
                  Rotating or disabling immediately stops the old link from
                  working.
                </p>
              </>
            ) : (
              <Button
                disabled={linkBusy}
                onClick={() => manageLink("create")}
                className="gap-2"
              >
                <Link2 className="w-4 h-4" />
                {linkBusy ? "Creating..." : "Create upload link"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
