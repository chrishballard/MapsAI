"use client";

import { Check } from "lucide-react";

export const WIZARD_STEPS = [
  { label: "Select Profile", shortLabel: "Profile" },
  { label: "Keywords & Cities", shortLabel: "Keywords" },
  { label: "Description", shortLabel: "Desc" },
  { label: "Services", shortLabel: "Services" },
  { label: "Attributes", shortLabel: "Attrs" },
  { label: "Settings", shortLabel: "Settings" },
  { label: "Review & Complete", shortLabel: "Review" },
];

interface StepIndicatorProps {
  steps: { label: string; shortLabel: string }[];
  currentStep: number;
  completedSteps: number[];
  onStepClick: (step: number) => void;
}

export function StepIndicator({
  steps,
  currentStep,
  completedSteps,
  onStepClick,
}: StepIndicatorProps) {
  return (
    <div className="flex items-center w-full">
      {steps.map((step, index) => {
        const isCompleted = completedSteps.includes(index);
        const isCurrent = index === currentStep;
        const isFuture = !isCompleted && !isCurrent;

        return (
          <div key={index} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={() => isCompleted && onStepClick(index)}
                className={`
                  w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors
                  ${isCompleted ? "bg-green-500 text-white cursor-pointer hover:bg-green-600" : ""}
                  ${isCurrent ? "bg-blue-600 text-white ring-2 ring-blue-200" : ""}
                  ${isFuture ? "bg-gray-200 text-gray-400 cursor-default opacity-50" : ""}
                `}
                disabled={isFuture}
              >
                {isCompleted ? (
                  <Check className="w-3 h-3 sm:w-4 sm:h-4" />
                ) : (
                  <span className="text-xs sm:text-sm">{index + 1}</span>
                )}
              </button>
              <span
                className={`hidden sm:block text-xs mt-1 text-center whitespace-nowrap ${
                  isCurrent
                    ? "text-blue-600 font-medium"
                    : isCompleted
                    ? "text-green-600"
                    : "text-gray-400"
                }`}
              >
                {step.shortLabel}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-2 ${
                  completedSteps.includes(index) ? "bg-green-500" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
