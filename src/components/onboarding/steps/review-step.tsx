"use client";

import { useState, useEffect } from "react";
import {
  CheckCircle2,
  Circle,
  MinusCircle,
  Loader2,
  ChevronRight,
  AlertCircle,
} from "lucide-react";

interface StepSummary {
  name: string;
  stepIndex: number;
  status: "complete" | "skipped" | "pending";
  detail?: string;
}

interface ReviewStepProps {
  profileId: string;
  onComplete: () => Promise<void>;
  onGoToStep: (step: number) => void;
}

export function ReviewStep({
  profileId,
  onComplete,
  onGoToStep,
}: ReviewStepProps) {
  const [steps, setSteps] = useState<StepSummary[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSummary() {
      try {
        const res = await fetch(
          `/api/onboarding/summary?profileId=${profileId}`
        );
        if (res.ok) {
          const data = await res.json();
          setSteps(data.steps ?? []);
          setIsComplete(data.isComplete ?? false);
        }
      } finally {
        setLoading(false);
      }
    }
    fetchSummary();
  }, [profileId]);

  const handleComplete = async () => {
    setCompleting(true);
    setCompleteError(null);
    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      const data = await res.json();
      if (data.success) {
        await onComplete();
      } else {
        setCompleteError(
          data.error || "Failed to complete onboarding"
        );
      }
    } catch {
      setCompleteError("Network error. Please try again.");
    } finally {
      setCompleting(false);
    }
  };

  const completedCount = steps.filter((s) => s.status === "complete").length;
  const skippedCount = steps.filter((s) => s.status === "skipped").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  // Already completed state
  if (isComplete) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-3 text-center">
        <CheckCircle2 className="w-12 h-12 text-emerald-500" />
        <h3 className="text-lg font-semibold text-foreground">
          Onboarding Complete
        </h3>
        <p className="text-sm text-muted-foreground">
          This profile has been fully onboarded.
        </p>
        <button
          type="button"
          onClick={() => onComplete()}
          className="bg-primary text-white hover:bg-primary/90 rounded-md px-6 py-2.5 font-medium text-sm mt-2"
        >
          Go to Profile
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Heading */}
      <div>
        <h3 className="text-base font-semibold text-foreground">
          Review & Complete
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Review the status of each optimization step before completing
          onboarding.
        </p>
      </div>

      {/* Error Banner */}
      {completeError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800">
              {completeError}
            </p>
          </div>
          <button
            type="button"
            onClick={handleComplete}
            className="bg-red-600 text-white hover:bg-red-700 rounded-md px-3 py-1 text-xs font-medium shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Checklist */}
      <div className="space-y-2">
        {steps.map((step) => {
          const isReviewStep = step.name === "Review & Complete";
          const StatusIcon =
            step.status === "complete"
              ? CheckCircle2
              : step.status === "skipped"
                ? MinusCircle
                : Circle;
          const statusColor =
            step.status === "complete"
              ? "text-emerald-500"
              : step.status === "skipped"
                ? "text-amber-500"
                : "text-zinc-300";

          if (isReviewStep) {
            return (
              <div
                key={step.stepIndex}
                className="flex items-center gap-3 p-3 rounded-lg border border-border bg-brand-50"
              >
                <StatusIcon className={`w-5 h-5 ${statusColor} shrink-0`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {step.name}
                  </p>
                  {step.detail && (
                    <p className="text-xs text-muted-foreground">{step.detail}</p>
                  )}
                </div>
              </div>
            );
          }

          return (
            <button
              key={step.stepIndex}
              type="button"
              onClick={() => onGoToStep(step.stepIndex)}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-zinc-50 cursor-pointer transition-colors text-left"
            >
              <StatusIcon className={`w-5 h-5 ${statusColor} shrink-0`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {step.name}
                </p>
                {step.detail && (
                  <p className="text-xs text-muted-foreground">{step.detail}</p>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
            </button>
          );
        })}
      </div>

      {/* Completion Summary */}
      <p className="text-sm text-muted-foreground">
        {completedCount} of {steps.length} steps completed
        {skippedCount > 0 && `, ${skippedCount} skipped`}
      </p>

      {/* Complete Onboarding Button */}
      <button
        type="button"
        onClick={handleComplete}
        disabled={completing}
        className="w-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 rounded-md px-6 py-2.5 font-medium text-sm"
      >
        {completing ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Completing...
          </span>
        ) : (
          "Complete Onboarding"
        )}
      </button>
    </div>
  );
}
