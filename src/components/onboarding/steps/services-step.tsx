"use client";

import { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Plus,
  X,
  Wrench,
} from "lucide-react";

interface ServiceItem {
  id?: string;
  serviceName: string;
  description: string;
  isStructured: boolean;
  isApproved: boolean;
  isPushed: boolean;
  pushedAt: string | null;
}

interface AvailableService {
  serviceTypeId: string;
  displayName: string;
}

interface ServicesStepProps {
  profileId: string;
  onComplete: () => Promise<void>;
}

export function ServicesStep({ profileId, onComplete }: ServicesStepProps) {
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [availableServices, setAvailableServices] = useState<
    AvailableService[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [customServiceInput, setCustomServiceInput] = useState("");
  const [showSelection, setShowSelection] = useState(true);

  // Selection phase state
  const [checkedServices, setCheckedServices] = useState<Set<string>>(
    new Set()
  );
  const [customServices, setCustomServices] = useState<string[]>([]);

  const hasInitialized = useRef(false);

  // On mount: fetch saved services and available GBP services
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    async function fetchData() {
      try {
        const res = await fetch(
          `/api/onboarding/services?profileId=${profileId}`
        );
        if (res.ok) {
          const data = await res.json();
          const saved: ServiceItem[] = (data.services ?? []).map(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (s: any) => ({
              id: s.id,
              serviceName: s.serviceName,
              description: s.description ?? "",
              isStructured: s.isStructured,
              isApproved: s.isApproved,
              isPushed: s.isPushed,
              pushedAt: s.pushedAt,
            })
          );
          const available: AvailableService[] = data.availableServices ?? [];

          setAvailableServices(available);

          if (saved.length > 0) {
            // Return visit: show service cards
            setServices(saved);
            setShowSelection(false);
          } else {
            // First visit: show selection checklist, pre-check all
            setShowSelection(true);
            setCheckedServices(
              new Set(available.map((a) => a.displayName))
            );
          }
        }
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [profileId]);

  // --- Selection Phase Handlers ---

  const toggleService = (displayName: string) => {
    setCheckedServices((prev) => {
      const next = new Set(prev);
      if (next.has(displayName)) {
        next.delete(displayName);
      } else {
        next.add(displayName);
      }
      return next;
    });
  };

  const addCustomService = () => {
    const trimmed = customServiceInput.trim();
    if (!trimmed) return;

    // Prevent duplicates (case-insensitive)
    const lowerTrimmed = trimmed.toLowerCase();
    const existsInAvailable = availableServices.some(
      (a) => a.displayName.toLowerCase() === lowerTrimmed
    );
    const existsInCustom = customServices.some(
      (c) => c.toLowerCase() === lowerTrimmed
    );
    if (existsInAvailable || existsInCustom) {
      setCustomServiceInput("");
      return;
    }

    setCustomServices((prev) => [...prev, trimmed]);
    setCustomServiceInput("");
  };

  const removeCustomService = (name: string) => {
    setCustomServices((prev) => prev.filter((c) => c !== name));
  };

  const totalSelected = checkedServices.size + customServices.length;

  const handleGenerate = async () => {
    const serviceNames = [
      ...Array.from(checkedServices),
      ...customServices,
    ];
    if (serviceNames.length === 0) return;

    setGenerating(true);
    setPushError(null);
    try {
      // Step 1: Generate descriptions via AI
      const genRes = await fetch("/api/onboarding/services/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, serviceNames }),
      });

      if (!genRes.ok) {
        const errData = await genRes.json().catch(() => ({}));
        setPushError(errData.error || "Failed to generate descriptions");
        setGenerating(false);
        return;
      }

      const genData = await genRes.json();

      // Map generated descriptions to ServiceItem objects
      const availableSet = new Set(
        availableServices.map((a) => a.displayName)
      );
      const newServices: ServiceItem[] = (
        genData.services as { serviceName: string; description: string }[]
      ).map((s) => ({
        serviceName: s.serviceName,
        description: s.description,
        isStructured: availableSet.has(s.serviceName),
        isApproved: false,
        isPushed: false,
        pushedAt: null,
      }));

      // Step 2: Save to DB
      await fetch("/api/onboarding/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId,
          services: newServices.map((s) => ({
            serviceName: s.serviceName,
            description: s.description,
            isStructured: s.isStructured,
            isApproved: false,
          })),
        }),
      });

      setServices(newServices);
      setShowSelection(false);
    } catch {
      setPushError("Network error during generation. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  // --- Card Phase Handlers ---

  const approvedCount = services.filter((s) => s.isApproved).length;
  const unapprovedCount = services.filter(
    (s) => !s.isApproved && !s.isPushed
  ).length;
  const allPushed =
    services.length > 0 && services.every((s) => s.isPushed);

  const approveService = (index: number) => {
    setServices((prev) =>
      prev.map((s, i) => (i === index ? { ...s, isApproved: true } : s))
    );
  };

  const unapproveService = (index: number) => {
    setServices((prev) =>
      prev.map((s, i) => (i === index ? { ...s, isApproved: false } : s))
    );
  };

  const updateDescription = (index: number, description: string) => {
    setServices((prev) =>
      prev.map((s, i) => (i === index ? { ...s, description } : s))
    );
  };

  const approveAll = () => {
    setServices((prev) =>
      prev.map((s) => (s.isPushed ? s : { ...s, isApproved: true }))
    );
  };

  const handlePush = async () => {
    setPushing(true);
    setPushError(null);
    try {
      // Step 1: Save all services to DB (persist edits + approval states)
      await fetch("/api/onboarding/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId,
          services: services.map((s) => ({
            serviceName: s.serviceName,
            description: s.description,
            isStructured: s.isStructured,
            isApproved: s.isApproved,
          })),
        }),
      });

      // Step 2: Push to Google
      const res = await fetch("/api/onboarding/services/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      const data = await res.json();

      if (data.success) {
        setPushSuccess(true);
        setServices((prev) =>
          prev.map((s) =>
            s.isApproved
              ? { ...s, isPushed: true, pushedAt: new Date().toISOString() }
              : s
          )
        );
        setTimeout(() => onComplete(), 2500);
      } else {
        setPushError(
          data.error || "Failed to push services to Google"
        );
      }
    } catch {
      setPushError("Network error. Please try again.");
    } finally {
      setPushing(false);
    }
  };

  const handleSkip = async () => {
    // Save current services to DB before skipping
    if (services.length > 0) {
      await fetch("/api/onboarding/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId,
          services: services.map((s) => ({
            serviceName: s.serviceName,
            description: s.description,
            isStructured: s.isStructured,
            isApproved: s.isApproved,
          })),
        }),
      });
    }
    await onComplete();
  };

  const handleRegenerate = () => {
    setShowSelection(true);
    // Re-check all available services + any custom ones that were in the list
    const customNames = services
      .filter((s) => !s.isStructured)
      .map((s) => s.serviceName);
    setCustomServices(customNames);
    setCheckedServices(
      new Set(
        services
          .filter((s) => s.isStructured)
          .map((s) => s.serviceName)
      )
    );
  };

  // --- Loading State ---
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  // --- Generation Loading State ---
  if (generating) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
          <p className="text-sm text-gray-600">
            Generating descriptions for {totalSelected} services...
          </p>
        </div>
        {Array.from({ length: Math.min(totalSelected, 5) }).map((_, i) => (
          <div
            key={i}
            className="bg-white border border-gray-200 rounded-lg p-4"
          >
            <div className="animate-pulse space-y-3">
              <div className="h-4 bg-gray-200 rounded w-1/3" />
              <div className="space-y-2">
                <div className="h-3 bg-gray-200 rounded w-full" />
                <div className="h-3 bg-gray-200 rounded w-5/6" />
                <div className="h-3 bg-gray-200 rounded w-4/6" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // --- Phase 1: Service Selection ---
  if (showSelection) {
    return (
      <div className="space-y-6">
        {/* Error Banner */}
        {pushError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800">{pushError}</p>
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center gap-2 mb-1">
            <Wrench className="w-5 h-5 text-gray-700" />
            <h3 className="text-base font-semibold text-gray-900">
              Available Services
            </h3>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Select the services your business offers. We&apos;ll generate
            AI-optimized descriptions for each.
          </p>

          {availableServices.length > 0 ? (
            <div className="space-y-2">
              {availableServices.map((svc) => (
                <label
                  key={svc.serviceTypeId}
                  className="flex items-center gap-3 p-3 rounded-md border border-gray-200 hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checkedServices.has(svc.displayName)}
                    onChange={() => toggleService(svc.displayName)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-900">
                    {svc.displayName}
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">
              No structured services found for this business category. You can
              add custom services below.
            </p>
          )}
        </div>

        {/* Custom Service Input */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-1">
            Add a custom service
          </h4>
          <p className="text-xs text-gray-500 mb-2">
            For niche services not in the list above
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={customServiceInput}
              onChange={(e) => setCustomServiceInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomService();
                }
              }}
              placeholder="e.g., Emergency Board-Up Service"
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm text-gray-900 flex-1"
            />
            <button
              type="button"
              onClick={addCustomService}
              disabled={!customServiceInput.trim()}
              className="flex items-center gap-1 border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 rounded-md px-3 py-1.5 text-sm"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>

          {/* Custom Service Chips */}
          {customServices.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {customServices.map((name) => (
                <span
                  key={name}
                  className="bg-gray-100 text-gray-700 rounded-full px-3 py-1.5 text-sm flex items-center gap-1.5"
                >
                  {name}
                  <button
                    type="button"
                    onClick={() => removeCustomService(name)}
                    className="text-gray-400 hover:text-red-500"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Generate Descriptions Button */}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={totalSelected === 0}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 rounded-md py-2.5 font-medium text-sm"
        >
          <Sparkles className="w-4 h-4" />
          Generate Descriptions
          {totalSelected > 0 && (
            <span className="text-blue-200">({totalSelected})</span>
          )}
        </button>
      </div>
    );
  }

  // --- Phase 2: Service Cards ---
  return (
    <div className="space-y-4">
      {/* Success Banner */}
      {pushSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-green-800">
              Services successfully pushed to Google Business Profile
            </p>
            <p className="text-xs text-green-600 mt-0.5">
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
            onClick={handlePush}
            className="bg-red-600 text-white hover:bg-red-700 rounded-md px-3 py-1 text-xs font-medium shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Running Counter */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {approvedCount} of {services.length} services approved
        </p>
        {!allPushed && (
          <button
            type="button"
            onClick={handleRegenerate}
            className="flex items-center gap-1.5 text-gray-600 border border-gray-300 hover:bg-gray-50 rounded-md px-3 py-1.5 text-sm"
          >
            <RotateCcw className="w-4 h-4" />
            Regenerate All
          </button>
        )}
      </div>

      {/* Service Cards */}
      {services.map((service, index) => (
        <div
          key={service.serviceName}
          className={`bg-white border border-gray-200 rounded-lg p-4${
            service.isPushed
              ? " border-l-4 border-l-blue-500"
              : service.isApproved
              ? " border-l-4 border-l-green-500"
              : ""
          }`}
        >
          {/* Top Row: Name + Badge */}
          <div className="flex items-center gap-2 mb-2">
            <span className="font-medium text-gray-900">
              {service.serviceName}
            </span>
            {service.isStructured ? (
              <span className="bg-blue-100 text-blue-700 text-xs rounded-full px-2 py-0.5">
                Structured
              </span>
            ) : (
              <span className="bg-gray-100 text-gray-600 text-xs rounded-full px-2 py-0.5">
                Custom
              </span>
            )}
          </div>

          {/* Editable Textarea */}
          <textarea
            value={service.description}
            onChange={(e) => updateDescription(index, e.target.value)}
            rows={3}
            disabled={service.isPushed}
            className="w-full border border-gray-300 rounded-md p-2 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:bg-gray-50"
          />

          {/* Character Count */}
          <p className="text-xs text-gray-400 mt-1">
            {service.description.length} characters
          </p>

          {/* Action Buttons */}
          <div className="mt-2">
            {service.isPushed ? (
              <div className="flex items-center gap-1.5 text-blue-600 text-sm">
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  Pushed on{" "}
                  {service.pushedAt
                    ? new Date(service.pushedAt).toLocaleDateString()
                    : "unknown"}
                </span>
              </div>
            ) : service.isApproved ? (
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5 text-green-600 text-sm">
                  <CheckCircle2 className="w-4 h-4" />
                  Approved
                </span>
                <button
                  type="button"
                  onClick={() => unapproveService(index)}
                  className="text-gray-400 text-xs underline hover:text-gray-600"
                >
                  Undo
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => approveService(index)}
                className="flex items-center gap-1.5 bg-green-50 text-green-700 border border-green-200 rounded px-3 py-1 text-sm hover:bg-green-100"
              >
                <CheckCircle2 className="w-4 h-4" />
                Approve
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Bottom Actions */}
      <div className="space-y-3 pt-2">
        {/* Approve All */}
        {unapprovedCount > 0 && (
          <button
            type="button"
            onClick={approveAll}
            className="w-full bg-green-50 text-green-700 border border-green-200 rounded-md px-4 py-2 text-sm font-medium hover:bg-green-100"
          >
            Approve All Remaining ({unapprovedCount})
          </button>
        )}

        {/* Push All to Google */}
        {!allPushed && (
          <button
            type="button"
            onClick={handlePush}
            disabled={approvedCount === 0 || pushing}
            className="w-full bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 rounded-md px-6 py-2.5 font-medium text-sm"
          >
            {pushing ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Pushing to Google...
              </span>
            ) : (
              "Push All to Google"
            )}
          </button>
        )}

        {/* Continue (return visit, all pushed) */}
        {allPushed && (
          <button
            type="button"
            onClick={onComplete}
            className="w-full border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-md py-2.5 font-medium text-sm"
          >
            Continue
          </button>
        )}

        {/* Skip for Now */}
        {!allPushed && (
          <button
            type="button"
            onClick={handleSkip}
            className="w-full text-gray-500 underline text-sm py-1"
          >
            Skip for Now
          </button>
        )}
      </div>
    </div>
  );
}
