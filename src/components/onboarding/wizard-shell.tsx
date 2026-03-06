"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  MapPin,
  FileText,
  Wrench,
  SlidersHorizontal,
  Settings,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { StepIndicator, WIZARD_STEPS } from "./step-indicator";
import { KeywordsCitiesStep } from "./steps/keywords-cities-step";
import { DescriptionStep } from "./steps/description-step";
import { ServicesStep } from "./steps/services-step";

interface WizardShellProps {
  profileId: string;
  profileName: string;
  initialProgress: {
    currentStep: number;
    completedSteps: number[];
    isComplete: boolean;
  } | null;
}

const STEP_CONFIG = [
  { icon: Search, name: "Select Profile", phase: "Phase 8" },
  { icon: MapPin, name: "Keywords & Cities", phase: "Phase 9" },
  { icon: FileText, name: "Description", phase: "Phase 10" },
  { icon: Wrench, name: "Services", phase: "Phase 11" },
  { icon: SlidersHorizontal, name: "Attributes", phase: "Phase 12" },
  { icon: Settings, name: "Settings", phase: "Phase 12" },
  { icon: CheckCircle2, name: "Review & Complete", phase: "Phase 13" },
];

export function WizardShell({
  profileId,
  profileName,
  initialProgress,
}: WizardShellProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(
    initialProgress?.currentStep ?? 0
  );
  const [completedSteps, setCompletedSteps] = useState<number[]>(
    initialProgress?.completedSteps ?? []
  );
  const [saving, setSaving] = useState(false);

  const persistProgress = useCallback(
    async (step: number, completed: number[], isComplete: boolean) => {
      setSaving(true);
      try {
        await fetch("/api/onboarding/progress", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profileId,
            currentStep: step,
            completedSteps: completed,
            isComplete,
          }),
        });
      } finally {
        setSaving(false);
      }
    },
    [profileId]
  );

  // Initialize progress and auto-complete step 0 on first visit
  useEffect(() => {
    async function initProgress() {
      if (initialProgress === null) {
        await fetch("/api/onboarding/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileId }),
        });
      }
      // Auto-complete step 0 (profile selection) if not already done
      if (!completedSteps.includes(0)) {
        const newCompleted = [...completedSteps, 0];
        const newStep = currentStep === 0 ? 1 : currentStep;
        setCompletedSteps(newCompleted);
        setCurrentStep(newStep);
        await persistProgress(newStep, newCompleted, false);
      }
    }
    initProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToStep = (step: number) => {
    if (completedSteps.includes(step) || step === currentStep) {
      setCurrentStep(step);
      persistProgress(step, completedSteps, false);
    }
  };

  const completeCurrentStep = async () => {
    const newCompleted = completedSteps.includes(currentStep)
      ? completedSteps
      : [...completedSteps, currentStep];

    const isLastStep = currentStep === WIZARD_STEPS.length - 1;

    if (isLastStep) {
      setCompletedSteps(newCompleted);
      await persistProgress(currentStep, newCompleted, true);
      router.push("/dashboard/onboarding?completed=true");
      return;
    }

    const nextStep = currentStep + 1;
    setCompletedSteps(newCompleted);
    setCurrentStep(nextStep);
    await persistProgress(nextStep, newCompleted, false);
  };

  const goBack = () => {
    if (currentStep > 0) {
      const prevStep = currentStep - 1;
      setCurrentStep(prevStep);
      persistProgress(prevStep, completedSteps, false);
    }
  };

  const StepIcon = STEP_CONFIG[currentStep]?.icon ?? Search;
  const isLastStep = currentStep === WIZARD_STEPS.length - 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900">{profileName}</h2>
        {saving && (
          <span className="flex items-center gap-1 text-sm text-gray-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            Saving...
          </span>
        )}
      </div>

      <StepIndicator
        steps={WIZARD_STEPS}
        currentStep={currentStep}
        completedSteps={completedSteps}
        onStepClick={goToStep}
      />

      <div
        className={`min-h-[400px] bg-white rounded-lg shadow-sm border border-gray-200 p-6 mt-6${
          currentStep !== 1 && currentStep !== 2 && currentStep !== 3
            ? " flex flex-col items-center justify-center text-center"
            : ""
        }`}
      >
        {currentStep === 0 ? (
          <div className="flex flex-col items-center gap-3">
            <CheckCircle2 className="w-12 h-12 text-green-500" />
            <h3 className="text-lg font-semibold text-gray-900">
              Profile Selected
            </h3>
            <p className="text-gray-500">
              Profile selected: {profileName}
            </p>
          </div>
        ) : currentStep === 1 ? (
          <KeywordsCitiesStep
            profileId={profileId}
            onComplete={completeCurrentStep}
          />
        ) : currentStep === 2 ? (
          <DescriptionStep
            profileId={profileId}
            onComplete={completeCurrentStep}
          />
        ) : currentStep === 3 ? (
          <ServicesStep
            profileId={profileId}
            onComplete={completeCurrentStep}
          />
        ) : (
          <div className="flex flex-col items-center gap-3">
            <StepIcon className="w-12 h-12 text-gray-300" />
            <h3 className="text-lg font-semibold text-gray-900">
              {STEP_CONFIG[currentStep].name}
            </h3>
            <p className="text-sm text-gray-400">
              Coming in {STEP_CONFIG[currentStep].phase}
            </p>
          </div>
        )}
      </div>

      <div className="flex justify-between mt-6">
        <div>
          {currentStep > 0 && (
            <button
              type="button"
              onClick={goBack}
              className="flex items-center gap-1 border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-md px-4 py-2 text-sm"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
          )}
        </div>
        {currentStep !== 1 && currentStep !== 2 && currentStep !== 3 && (
          <button
            type="button"
            onClick={completeCurrentStep}
            className="flex items-center gap-1 bg-blue-600 text-white hover:bg-blue-700 rounded-md px-4 py-2 text-sm"
          >
            {isLastStep ? "Complete Onboarding" : "Continue"}
            {!isLastStep && <ChevronRight className="w-4 h-4" />}
          </button>
        )}
      </div>
    </div>
  );
}
