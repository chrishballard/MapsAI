"use client";

import { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Info,
  RotateCcw,
} from "lucide-react";
import { fetchJson, sendJson } from "@/lib/fetch-json";

interface SavedDescription {
  id: string;
  content: string;
  isApproved: boolean;
  isPushed: boolean;
  pushedAt: string | null;
}

interface DescriptionStepProps {
  profileId: string;
  onComplete: () => Promise<void>;
}

export function DescriptionStep({
  profileId,
  onComplete,
}: DescriptionStepProps) {
  const [currentGBPDescription, setCurrentGBPDescription] = useState<
    string | null
  >(null);
  // Set when the GET degraded because GBP was unreachable — the saved copy
  // below is intact, but the live "Current Description" is unknown.
  const [gbpError, setGbpError] = useState<string | null>(null);
  const [aiDescription, setAiDescription] = useState("");
  const [savedDescription, setSavedDescription] =
    useState<SavedDescription | null>(null);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  // Which operation the error came from, so Retry re-runs that operation —
  // retrying a failed generate must not push, and retrying a failed push
  // must not re-generate (it would discard the user's edits).
  const [failedOp, setFailedOp] = useState<"generate" | "push" | null>(null);
  const hasGenerated = useRef(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const [descData, kwData] = await Promise.all([
          fetchJson<{
            currentGBPDescription?: string | null;
            description?: SavedDescription | null;
            gbpError?: string | null;
          }>(`/api/onboarding/description?profileId=${profileId}`),
          fetchJson<{ keywords?: { keyword: string }[] }>(
            `/api/onboarding/keywords?profileId=${profileId}`
          ),
        ]);

        setCurrentGBPDescription(descData.currentGBPDescription ?? null);
        setGbpError(descData.gbpError ?? null);
        if (descData.description) {
          setSavedDescription(descData.description);
          setAiDescription(descData.description.content);
        }

        setKeywords(
          (kwData.keywords ?? []).map((k: { keyword: string }) => k.keyword)
        );
      } catch (err) {
        console.error("Failed to load description data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [profileId]);

  // Auto-generate on first visit (no saved description)
  useEffect(() => {
    if (loading || hasGenerated.current || savedDescription) return;
    hasGenerated.current = true;
    generateDescription();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, savedDescription]);

  const generateDescription = async () => {
    setGenerating(true);
    setPushError(null);
    setFailedOp(null);
    try {
      const data = await sendJson<{ description?: string }>(
        "/api/onboarding/description/generate",
        { profileId }
      );
      setAiDescription(data.description ?? "");
    } catch (err) {
      setPushError(
        err instanceof Error
          ? err.message
          : "Network error during generation. Please try again."
      );
      setFailedOp("generate");
    } finally {
      setGenerating(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    setPushError(null);
    setFailedOp(null);
    try {
      const data = await sendJson<{
        success?: boolean;
        error?: string;
        id?: string;
      }>("/api/onboarding/description/push", {
        profileId,
        content: aiDescription,
      });
      if (data.success) {
        setPushSuccess(true);
        setSavedDescription({
          id: data.id ?? savedDescription?.id ?? "",
          content: aiDescription,
          isApproved: true,
          isPushed: true,
          pushedAt: new Date().toISOString(),
        });
        setTimeout(() => onComplete(), 2500);
      } else {
        setPushError(data.error ?? "Failed to push description to Google");
        setFailedOp("push");
      }
    } catch (err) {
      setPushError(
        err instanceof Error ? err.message : "Network error. Please try again."
      );
      setFailedOp("push");
    } finally {
      setPushing(false);
    }
  };

  const handleSkip = async () => {
    if (aiDescription.trim()) {
      try {
        await sendJson("/api/onboarding/description", {
          profileId,
          content: aiDescription,
        });
      } catch (err) {
        console.error("Failed to save description before skipping:", err);
      }
    }
    await onComplete();
  };

  const charCount = aiDescription.length;
  const charColor =
    charCount > 750
      ? "text-red-600"
      : charCount > 700
        ? "text-yellow-600"
        : "text-emerald-600";

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Success Banner */}
      {pushSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-emerald-800">
              Description successfully pushed to Google Business Profile
            </p>
            <p className="text-xs text-emerald-600 mt-0.5">
              Advancing to next step...
            </p>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {pushError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800">{pushError}</p>
          </div>
          <button
            type="button"
            onClick={
              failedOp === "generate" ? generateDescription : handlePush
            }
            disabled={generating || pushing}
            className="bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 rounded-md px-3 py-1 text-xs font-medium shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Section 1: Current GBP Description */}
      <div>
        <h3 className="text-base font-semibold text-foreground">
          Current Description
        </h3>
        <p className="text-sm text-muted-foreground mb-3">
          Currently on your Google Business Profile
        </p>
        {currentGBPDescription ? (
          <div className="bg-muted/50 rounded-lg p-4 text-muted-foreground italic text-sm">
            {currentGBPDescription}
          </div>
        ) : gbpError ? (
          <p className="flex items-center gap-1.5 text-sm text-amber-600">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            Couldn&apos;t reach Google — showing your saved copy
          </p>
        ) : (
          <p className="text-sm text-zinc-400 italic">
            No description currently set on your Google Business Profile
          </p>
        )}
      </div>

      {/* Section 2: AI-Recommended Description */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-foreground">
            Recommended Description
          </h3>
          <button
            type="button"
            onClick={generateDescription}
            disabled={generating}
            className="flex items-center gap-1.5 border border-border text-foreground hover:bg-zinc-50 disabled:opacity-50 rounded-lg px-3 py-1.5 text-sm"
          >
            {generating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RotateCcw className="w-4 h-4" />
            )}
            Regenerate
          </button>
        </div>

        {generating && !aiDescription ? (
          <div className="space-y-2">
            <div className="animate-pulse bg-zinc-200 rounded h-4 w-full" />
            <div className="animate-pulse bg-zinc-200 rounded h-4 w-5/6" />
            <div className="animate-pulse bg-zinc-200 rounded h-4 w-4/6" />
            <div className="animate-pulse bg-zinc-200 rounded h-4 w-full" />
            <div className="animate-pulse bg-zinc-200 rounded h-4 w-3/6" />
          </div>
        ) : (
          <textarea
            value={aiDescription}
            onChange={(e) => setAiDescription(e.target.value)}
            rows={6}
            disabled={generating || pushing}
            className={`w-full border rounded-lg p-3 text-sm text-foreground focus:ring-4 focus:ring-brand-50 focus:border-brand-300 disabled:opacity-50 ${
              charCount > 750
                ? "border-red-500"
                : "border-border"
            }`}
          />
        )}

        {/* Character counter */}
        <div className="flex items-center justify-between mt-1">
          <div>
            <span className={`text-xs font-medium ${charColor}`}>
              {charCount} / 750 characters
            </span>
            {charCount > 750 && (
              <span className="text-xs text-red-600 ml-2">
                Description exceeds 750 character limit
              </span>
            )}
          </div>
        </div>

        {/* First-250 indicator */}
        <div className="flex items-center gap-1 mt-1">
          <Info className="w-3 h-3 text-zinc-400" />
          <span className="text-xs text-zinc-400">
            First 250 characters visible in Google Search
          </span>
        </div>

        {/* Keyword Coverage */}
        {keywords.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-medium text-foreground mb-2">
              Keyword Coverage
            </p>
            <div className="flex flex-wrap gap-2">
              {keywords.map((kw) => {
                const found = aiDescription
                  .toLowerCase()
                  .includes(kw.toLowerCase());
                return (
                  <span
                    key={kw}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                      found
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-zinc-100 text-muted-foreground"
                    }`}
                  >
                    {found && <CheckCircle2 className="w-3 h-3" />}
                    {kw}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div>
        {savedDescription?.isPushed ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="w-5 h-5" />
              <span className="text-sm font-medium">
                Pushed to Google
                {savedDescription.pushedAt && (
                  <span className="text-zinc-400 font-normal ml-1">
                    on{" "}
                    {new Date(savedDescription.pushedAt).toLocaleDateString()}
                  </span>
                )}
              </span>
            </div>
            <button
              type="button"
              onClick={onComplete}
              className="w-full border border-border text-foreground hover:bg-zinc-50 rounded-lg py-2.5 font-medium text-sm"
            >
              Continue
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              onClick={handlePush}
              disabled={
                !aiDescription.trim() || charCount > 750 || pushing
              }
              className="w-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 rounded-lg py-2.5 font-medium text-sm"
            >
              {pushing ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Pushing to Google...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  Approve & Push to Google
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={handleSkip}
              className="w-full text-muted-foreground underline text-sm py-1"
            >
              Skip for Now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
