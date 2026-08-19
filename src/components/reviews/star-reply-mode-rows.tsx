"use client";

import { Loader2, Star } from "lucide-react";
import {
  REVIEW_REPLY_MODES,
  REVIEW_REPLY_MODE_LABELS,
  STAR_RATINGS,
  type ReviewReplyMode,
  type StarRating,
} from "@/lib/review-reply-mode";

interface StarReplyModeRowsProps {
  values: Record<StarRating, ReviewReplyMode>;
  onChange: (rating: StarRating, mode: ReviewReplyMode) => void;
  disabled?: boolean;
  /** Rating whose save is in flight — shows a spinner on that row. */
  pendingRating?: StarRating | null;
}

/**
 * One row per star rating, each with a dropdown choosing how RankMaps
 * handles new reviews at that rating (ignore / draft for approval / reply
 * automatically). Purely presentational — the parent owns state and saving.
 */
export function StarReplyModeRows({
  values,
  onChange,
  disabled = false,
  pendingRating = null,
}: StarReplyModeRowsProps) {
  return (
    <div className="space-y-2">
      {STAR_RATINGS.map((rating) => (
        <div
          key={rating}
          className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 rounded-xl border border-zinc-100 bg-zinc-50/60 px-4 py-3"
        >
          <div className="flex items-center gap-3 sm:w-48 shrink-0">
            <span className="text-sm font-semibold text-zinc-900">
              {rating} star reviews
            </span>
            <div className="flex items-center gap-0.5" aria-hidden="true">
              {STAR_RATINGS.map((star) => (
                <Star
                  key={star}
                  size={13}
                  className={
                    star <= rating
                      ? "fill-amber-400 text-amber-400"
                      : "text-zinc-200"
                  }
                />
              ))}
            </div>
          </div>
          <div className="flex flex-1 items-center gap-2">
            <select
              value={values[rating]}
              onChange={(e) =>
                onChange(rating, e.target.value as ReviewReplyMode)
              }
              disabled={disabled || pendingRating === rating}
              aria-label={`Reply handling for ${rating} star reviews`}
              className="w-full sm:max-w-sm border border-zinc-200 rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 focus:ring-4 focus:ring-brand-50 focus:border-brand-300 outline-none disabled:opacity-50"
            >
              {REVIEW_REPLY_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {REVIEW_REPLY_MODE_LABELS[mode]}
                </option>
              ))}
            </select>
            {pendingRating === rating && (
              <Loader2 size={14} className="animate-spin text-zinc-400 shrink-0" />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
