"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { sendJson } from "@/lib/fetch-json";
import { MAX_REVIEW_INSTRUCTIONS_CHARS as MAX_INSTRUCTIONS } from "@/lib/reviews-enabled";
import { cn } from "@/lib/utils";

const PLACEHOLDER =
  'e.g. "Respond to all reviews in the first person, as if you were Ben, the owner. Never mention pricing or promotions."';

interface ReviewSettingsPanelProps {
  profileId: string;
  profileName: string;
  reviewsEnabled: boolean;
  reviewInstructions: string | null;
}

export function ReviewSettingsPanel({
  profileId,
  profileName,
  reviewsEnabled: initialEnabled,
  reviewInstructions,
}: ReviewSettingsPanelProps) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [instructions, setInstructions] = useState(reviewInstructions ?? "");
  const [savedInstructions, setSavedInstructions] = useState(
    reviewInstructions ?? ""
  );
  const [togglePending, setTogglePending] = useState(false);
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const instructionsDirty = instructions !== savedInstructions;

  async function handleToggle() {
    const next = !enabled;
    setTogglePending(true);
    setError(null);
    // Optimistic — reverted below if the request fails.
    setEnabled(next);
    try {
      await sendJson(
        "/api/reviews/settings",
        { profileId, reviewsEnabled: next },
        "PATCH"
      );
      router.refresh();
    } catch (err) {
      setEnabled(!next);
      setError(
        err instanceof Error ? err.message : "Failed to update review settings"
      );
    } finally {
      setTogglePending(false);
    }
  }

  async function handleSaveInstructions() {
    setSavingInstructions(true);
    setError(null);
    setJustSaved(false);
    try {
      const result = await sendJson<{ reviewInstructions: string | null }>(
        "/api/reviews/settings",
        { profileId, reviewInstructions: instructions },
        "PATCH"
      );
      const saved = result.reviewInstructions ?? "";
      setInstructions(saved);
      setSavedInstructions(saved);
      setJustSaved(true);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save instructions"
      );
    } finally {
      setSavingInstructions(false);
    }
  }

  return (
    <Card className="space-y-5">
      {/* Reviews on/off */}
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-base font-semibold text-zinc-900">
            Review management
          </h2>
          <p className="text-sm text-zinc-500 mt-1 max-w-xl">
            {enabled
              ? `RankMaps is monitoring reviews for ${profileName} and drafting replies.`
              : `Reviews are off for ${profileName}. No monitoring, no AI replies, and nothing publishes to Google until you turn this back on.`}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span
            className={cn(
              "text-sm font-medium",
              enabled ? "text-emerald-700" : "text-zinc-500"
            )}
          >
            {enabled ? "On" : "Off"}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={`Review management for ${profileName}`}
            onClick={handleToggle}
            disabled={togglePending}
            className={cn(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50",
              "focus:outline-none focus:ring-4 focus:ring-brand-100",
              enabled ? "bg-emerald-500" : "bg-zinc-300"
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                enabled ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </div>
      </div>

      {/* Train RankMaps */}
      <div className="border-t border-zinc-100 pt-5">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-brand-600" />
          <h3 className="text-sm font-semibold text-zinc-900">
            Train RankMaps
          </h3>
        </div>
        <p className="text-sm text-zinc-500 mt-1 max-w-2xl">
          Tell the AI how to write replies for this business — voice, who to
          sign as, what to mention, what to avoid. Applies to every reply
          drafted from now on.
        </p>
        <p className="text-xs text-zinc-400 mt-1 max-w-2xl">
          A few rules always win, whatever you put here: replies never promise
          refunds, discounts, or compensation, and never include phone numbers,
          email addresses, links, or promo codes.
        </p>
        <textarea
          value={instructions}
          onChange={(e) => {
            setInstructions(e.target.value.slice(0, MAX_INSTRUCTIONS));
            setJustSaved(false);
          }}
          placeholder={PLACEHOLDER}
          rows={4}
          maxLength={MAX_INSTRUCTIONS}
          className="mt-3 w-full border border-zinc-200 rounded-xl p-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:ring-4 focus:ring-brand-50 focus:border-brand-300 outline-none resize-y"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-zinc-400">
            {instructions.length}/{MAX_INSTRUCTIONS} characters
          </span>
          <div className="flex items-center gap-3">
            {justSaved && !instructionsDirty && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                <Check size={14} />
                Saved
              </span>
            )}
            <button
              type="button"
              onClick={handleSaveInstructions}
              disabled={savingInstructions || !instructionsDirty}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {savingInstructions && (
                <Loader2 size={14} className="animate-spin" />
              )}
              {savingInstructions ? "Saving..." : "Save instructions"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
