"use client";

import { useState, useEffect } from "react";
import { Loader2, Settings, MessageSquare, CheckCircle2 } from "lucide-react";
import { fetchJson, sendJson } from "@/lib/fetch-json";
import { StarReplyModeRows } from "@/components/reviews/star-reply-mode-rows";
import type { ReviewReplyMode, StarRating } from "@/lib/review-reply-mode";

interface SettingsStepProps {
  profileId: string;
  onComplete?: () => Promise<void>;
  // Rendered outside the onboarding wizard (Profile Settings page):
  // saves stay on the page with a confirmation, and there is no skip.
  standalone?: boolean;
}

const PRESETS = [4, 8, 12];

const DEFAULT_REPLY_MODES: Record<StarRating, ReviewReplyMode> = {
  1: "DRAFT",
  2: "DRAFT",
  3: "DRAFT",
  4: "DRAFT",
  5: "DRAFT",
};

export function SettingsStep({
  profileId,
  onComplete,
  standalone = false,
}: SettingsStepProps) {
  const [postFrequency, setPostFrequency] = useState(4);
  const [replyModes, setReplyModes] =
    useState<Record<StarRating, ReviewReplyMode>>(DEFAULT_REPLY_MODES);
  // Guards against clobbering saved modes with the DRAFT defaults when the
  // settings fetch fails: until the real values load, the rows stay
  // disabled and Save leaves the modes out of the PATCH entirely.
  const [modesLoaded, setModesLoaded] = useState(false);
  const [isCustom, setIsCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    async function fetchSettings() {
      try {
        const data = await fetchJson<{
          postFrequency?: number;
          reviewReplyMode1?: ReviewReplyMode;
          reviewReplyMode2?: ReviewReplyMode;
          reviewReplyMode3?: ReviewReplyMode;
          reviewReplyMode4?: ReviewReplyMode;
          reviewReplyMode5?: ReviewReplyMode;
        }>(`/api/onboarding/settings?profileId=${profileId}`);
        const freq = data.postFrequency ?? 4;
        setPostFrequency(freq);
        setReplyModes({
          1: data.reviewReplyMode1 ?? "DRAFT",
          2: data.reviewReplyMode2 ?? "DRAFT",
          3: data.reviewReplyMode3 ?? "DRAFT",
          4: data.reviewReplyMode4 ?? "DRAFT",
          5: data.reviewReplyMode5 ?? "DRAFT",
        });
        setModesLoaded(true);
        if (!PRESETS.includes(freq)) {
          setIsCustom(true);
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, [profileId]);

  const handleModeChange = (rating: StarRating, mode: ReviewReplyMode) => {
    setReplyModes((current) => ({ ...current, [rating]: mode }));
    setSaveSuccess(false);
  };

  const handleSelectChange = (value: string) => {
    setSaveSuccess(false);
    if (value === "custom") {
      setIsCustom(true);
    } else {
      setIsCustom(false);
      setPostFrequency(parseInt(value, 10));
    }
  };

  const handleCustomChange = (value: string) => {
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      setPostFrequency(Math.min(30, Math.max(1, num)));
      setSaveSuccess(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await sendJson(
        "/api/onboarding/settings",
        {
          profileId,
          postFrequency,
          ...(modesLoaded
            ? {
                reviewReplyMode1: replyModes[1],
                reviewReplyMode2: replyModes[2],
                reviewReplyMode3: replyModes[3],
                reviewReplyMode4: replyModes[4],
                reviewReplyMode5: replyModes[5],
              }
            : {}),
        },
        "PATCH"
      );
      setSaveSuccess(true);
      await onComplete?.();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Network error. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="w-5 h-5 text-zinc-400" />
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Post Frequency
          </h3>
          <p className="text-sm text-muted-foreground">
            How often should we generate and publish posts for this profile?
          </p>
        </div>
      </div>

      {/* Dropdown */}
      <div>
        <select
          value={isCustom ? "custom" : postFrequency.toString()}
          onChange={(e) => handleSelectChange(e.target.value)}
          className="w-full border border-border rounded-md p-2.5 text-sm text-foreground focus:ring-4 focus:ring-brand-50 focus:border-brand-300"
        >
          <option value="4">4 posts/month (Weekly)</option>
          <option value="8">8 posts/month (2x per week)</option>
          <option value="12">12 posts/month (3x per week)</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      {/* Custom input */}
      {isCustom && (
        <div>
          <label className="text-sm text-foreground block mb-1.5">
            Posts per month
          </label>
          <input
            type="number"
            min={1}
            max={30}
            value={postFrequency}
            onChange={(e) => handleCustomChange(e.target.value)}
            className="w-full border border-border rounded-md p-2.5 text-sm text-foreground focus:ring-4 focus:ring-brand-50 focus:border-brand-300"
          />
          <p className="text-xs text-zinc-400 mt-1">
            Maximum 30 posts per month
          </p>
        </div>
      )}

      {/* Per-star review reply handling */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-zinc-400" />
          <div>
            <h3 className="text-base font-semibold text-foreground">
              Review Replies
            </h3>
            <p className="text-sm text-muted-foreground">
              What should RankMaps do when a new review comes in at each star
              rating?
            </p>
          </div>
        </div>
        <StarReplyModeRows
          values={replyModes}
          onChange={handleModeChange}
          disabled={!modesLoaded}
        />
        {!modesLoaded && (
          <p className="text-xs text-zinc-400">
            Couldn&apos;t load the current reply settings — these are locked so
            saving won&apos;t change them. Reload the page to edit.
          </p>
        )}
      </div>

      {/* Save & Continue */}
      <div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-primary text-white hover:bg-primary/90 disabled:opacity-50 rounded-md px-6 py-2.5 font-medium text-sm mt-6"
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </span>
          ) : standalone ? (
            "Save Changes"
          ) : (
            "Save & Continue"
          )}
        </button>

        {standalone && saveSuccess && (
          <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 mt-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Changes saved. Future posts and review responses follow the new
            settings.
          </p>
        )}

        {saveError && (
          <p className="text-sm text-red-600 mt-2">{saveError}</p>
        )}

        {!standalone && (
          <button
            type="button"
            onClick={() => onComplete?.()}
            className="w-full text-muted-foreground underline text-sm py-2 mt-2"
          >
            Skip for Now
          </button>
        )}
      </div>
    </div>
  );
}
