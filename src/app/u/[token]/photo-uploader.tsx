"use client";

import { useRef, useState } from "react";
import { Camera, CheckCircle2, AlertCircle, Loader2, Plus } from "lucide-react";
import { prepareImageForUpload } from "@/lib/client-image";

interface UploadItem {
  key: string;
  name: string;
  previewUrl: string;
  status: "uploading" | "done" | "error";
  error?: string;
}

// Client-facing uploader: one file per request so each photo succeeds or
// fails on its own, with per-photo status the client can see.
export function PhotoUploader({ token }: { token: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const doneCount = items.filter((i) => i.status === "done").length;

  function updateItem(key: string, patch: Partial<UploadItem>) {
    setItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, ...patch } : item))
    );
  }

  async function handleFiles(fileList: FileList | File[] | null) {
    if (!fileList || fileList.length === 0 || busy) return;
    // Every selected file gets its own row and its own request — nothing is
    // silently dropped however many the client picks.
    const files = Array.from(fileList);
    setBusy(true);

    const newItems: UploadItem[] = files.map((file, i) => ({
      key: `${Date.now()}-${i}-${file.name}`,
      name: file.name,
      previewUrl: URL.createObjectURL(file),
      status: "uploading",
    }));
    setItems((prev) => [...prev, ...newItems]);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const item = newItems[i];
      try {
        const prepared = await prepareImageForUpload(file);
        const form = new FormData();
        form.append("files", prepared.blob, prepared.fileName);

        const res = await fetch(`/api/public/upload/${token}`, {
          method: "POST",
          body: form,
        });
        const data = await res.json().catch(() => null);

        if (!res.ok) {
          updateItem(item.key, {
            status: "error",
            error: data?.error ?? "Upload failed. Please try again.",
          });
          continue;
        }

        const result = data?.results?.[0];
        if (result?.ok) {
          updateItem(item.key, { status: "done" });
        } else {
          updateItem(item.key, {
            status: "error",
            error: result?.error ?? "This photo couldn't be used",
          });
        }
      } catch {
        updateItem(item.key, {
          status: "error",
          error: "Upload failed. Check your connection and try again.",
        });
      }
    }

    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-5">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        disabled={busy}
        className={`w-full rounded-2xl border-2 border-dashed px-6 py-12 flex flex-col items-center gap-3 transition-colors ${
          dragOver
            ? "border-brand-500 bg-brand-50"
            : "border-zinc-300 bg-white hover:border-brand-400 hover:bg-brand-50/50"
        } ${busy ? "opacity-60" : ""}`}
      >
        <div className="w-14 h-14 bg-brand-100 rounded-full flex items-center justify-center text-brand-600">
          {busy ? (
            <Loader2 size={26} className="animate-spin" />
          ) : (
            <Camera size={26} />
          )}
        </div>
        <div className="text-center">
          <p className="text-base font-semibold text-zinc-900">
            {busy ? "Uploading..." : "Tap to add photos"}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            Pick from your camera roll (you can select several at once)
          </p>
        </div>
      </button>

      {items.length > 0 && (
        <div className="bg-white rounded-2xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
          {items.map((item) => (
            <div key={item.key} className="flex items-center gap-3 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- blob: object URL previews aren't supported by next/image */}
              <img
                src={item.previewUrl}
                alt=""
                className="w-12 h-12 rounded-lg object-cover bg-zinc-100 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-zinc-700 truncate">{item.name}</p>
                {item.status === "error" && (
                  <p className="text-xs text-red-600 mt-0.5">{item.error}</p>
                )}
              </div>
              <div className="shrink-0">
                {item.status === "uploading" && (
                  <Loader2 size={18} className="text-zinc-400 animate-spin" />
                )}
                {item.status === "done" && (
                  <CheckCircle2 size={18} className="text-emerald-500" />
                )}
                {item.status === "error" && (
                  <AlertCircle size={18} className="text-red-500" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {doneCount > 0 && !busy && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center">
          <p className="text-sm font-semibold text-emerald-800">
            {doneCount} photo{doneCount === 1 ? "" : "s"} received. Thank
            you!
          </p>
          <p className="text-xs text-emerald-700 mt-1">
            Our team will review them and start using them in your posts.
          </p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 underline underline-offset-2"
          >
            <Plus size={14} />
            Add more photos
          </button>
        </div>
      )}
    </div>
  );
}
