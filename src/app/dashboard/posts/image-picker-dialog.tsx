"use client";

import { useEffect, useState } from "react";
import NextImage from "next/image";
import { Check, ImageOff, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/fetch-json";

interface PickerImage {
  id: string;
  url: string;
}

interface ImagePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: string;
  currentImageId: string | null;
  /** Called with the chosen image id, or null to remove the photo. */
  onSelect: (imageId: string | null) => Promise<void>;
}

/** Grid of the profile's approved library photos for manual attachment. */
export function ImagePickerDialog({
  open,
  onOpenChange,
  profileId,
  currentImageId,
  onSelect,
}: ImagePickerDialogProps) {
  const [images, setImages] = useState<PickerImage[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setImages(null);
    fetchJson<{ images: PickerImage[] }>(
      `/api/images?profileId=${encodeURIComponent(profileId)}&status=APPROVED`
    )
      .then((data) => {
        if (!cancelled) setImages(data.images ?? []);
      })
      .catch(() => {
        if (!cancelled) setImages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, profileId]);

  async function choose(imageId: string | null) {
    setSaving(true);
    try {
      await onSelect(imageId);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Choose a photo</DialogTitle>
        </DialogHeader>

        {images === null ? (
          <div className="flex items-center justify-center py-10 text-zinc-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : images.length === 0 ? (
          <div className="text-center py-8">
            <ImageOff className="w-8 h-8 text-zinc-300 mx-auto mb-3" />
            <p className="text-sm text-zinc-500">
              No approved photos in this business&apos;s library yet — add
              some on the Images page.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {images.map((img) => {
              const selected = img.id === currentImageId;
              return (
                <button
                  key={img.id}
                  type="button"
                  disabled={saving}
                  onClick={() => choose(img.id)}
                  className={`relative aspect-[4/3] rounded-lg overflow-hidden border-2 transition-colors ${
                    selected
                      ? "border-brand-600"
                      : "border-transparent hover:border-brand-300"
                  }`}
                >
                  <NextImage
                    src={img.url}
                    alt=""
                    fill
                    sizes="160px"
                    unoptimized
                    className="object-cover"
                  />
                  {selected && (
                    <span className="absolute top-1 right-1 w-5 h-5 bg-brand-600 rounded-full flex items-center justify-center text-white">
                      <Check size={12} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {currentImageId && (
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => choose(null)}
              className="text-red-600 border-red-200 hover:bg-red-50"
            >
              Remove photo from this post
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
