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
  ChevronDown,
  ChevronRight,
} from "lucide-react";

// --- Interfaces ---

interface SavedDescription {
  id: string;
  content: string;
  isApproved: boolean;
  isPushed: boolean;
  pushedAt: string | null;
}

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

interface GBPService {
  serviceTypeId: string;
  displayName: string;
}

// --- Main Component ---

export function ReoptimizeSection({ profileId }: { profileId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Description state
  const [currentGBPDescription, setCurrentGBPDescription] = useState<
    string | null
  >(null);
  const [savedDescription, setSavedDescription] =
    useState<SavedDescription | null>(null);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [aiDescription, setAiDescription] = useState("");
  const [descGenerating, setDescGenerating] = useState(false);
  const [descPushing, setDescPushing] = useState(false);
  const [descPushSuccess, setDescPushSuccess] = useState(false);
  const [descError, setDescError] = useState<string | null>(null);
  const [descExpanded, setDescExpanded] = useState(true);
  const [descShowComparison, setDescShowComparison] = useState(false);

  // Services state
  const [currentGBPServices, setCurrentGBPServices] = useState<GBPService[]>(
    []
  );
  const [savedServices, setSavedServices] = useState<ServiceItem[]>([]);
  const [availableServices, setAvailableServices] = useState<
    AvailableService[]
  >([]);
  const [svcGenerating, setSvcGenerating] = useState(false);
  const [svcPushing, setSvcPushing] = useState(false);
  const [svcPushSuccess, setSvcPushSuccess] = useState(false);
  const [svcError, setSvcError] = useState<string | null>(null);
  const [svcExpanded, setSvcExpanded] = useState(true);
  const [svcShowSelection, setSvcShowSelection] = useState(false);
  const [svcShowCards, setSvcShowCards] = useState(false);

  // Service selection state
  const [checkedServices, setCheckedServices] = useState<Set<string>>(
    new Set()
  );
  const [customServices, setCustomServices] = useState<string[]>([]);
  const [customServiceInput, setCustomServiceInput] = useState("");

  const hasLoaded = useRef(false);

  // --- Data Loading ---

  useEffect(() => {
    if (hasLoaded.current) return;
    hasLoaded.current = true;

    async function fetchAll() {
      try {
        const [descRes, svcRes] = await Promise.all([
          fetch(`/api/reoptimize/description?profileId=${profileId}`),
          fetch(`/api/reoptimize/services?profileId=${profileId}`),
        ]);

        if (descRes.ok) {
          const data = await descRes.json();
          setCurrentGBPDescription(data.currentGBPDescription ?? null);
          setKeywords(data.keywords ?? []);
          if (data.savedDescription) {
            setSavedDescription(data.savedDescription);
            setAiDescription(data.savedDescription.content);
          }
        }

        if (svcRes.ok) {
          const data = await svcRes.json();
          setCurrentGBPServices(data.currentGBPServices ?? []);
          setAvailableServices(data.availableServices ?? []);
          const saved: ServiceItem[] = (data.savedServices ?? []).map(
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
          setSavedServices(saved);
          if (saved.length > 0) {
            setSvcShowCards(true);
          }
        }
      } catch {
        setError("Failed to load re-optimization data.");
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, [profileId]);

  // --- Description Handlers ---

  const generateDescription = async () => {
    setDescGenerating(true);
    setDescError(null);
    setDescPushSuccess(false);
    try {
      const res = await fetch("/api/reoptimize/description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiDescription(data.description ?? "");
        setDescShowComparison(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setDescError(data.error || "Failed to generate description");
      }
    } catch {
      setDescError("Network error during generation. Please try again.");
    } finally {
      setDescGenerating(false);
    }
  };

  const pushDescription = async () => {
    setDescPushing(true);
    setDescError(null);
    try {
      const res = await fetch("/api/reoptimize/description/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, content: aiDescription }),
      });
      const data = await res.json();
      if (data.success) {
        setDescPushSuccess(true);
        setSavedDescription({
          id: data.description?.id ?? savedDescription?.id ?? "",
          content: aiDescription,
          isApproved: true,
          isPushed: true,
          pushedAt: new Date().toISOString(),
        });
      } else {
        setDescError(data.error ?? "Failed to push description to Google");
      }
    } catch {
      setDescError("Network error. Please try again.");
    } finally {
      setDescPushing(false);
    }
  };

  // --- Services Selection Handlers ---

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

  // --- Services Generate / Push Handlers ---

  const generateServices = async () => {
    const serviceNames = [
      ...Array.from(checkedServices),
      ...customServices,
    ];
    if (serviceNames.length === 0) return;

    setSvcGenerating(true);
    setSvcError(null);
    setSvcPushSuccess(false);
    try {
      const res = await fetch("/api/reoptimize/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, serviceNames }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setSvcError(errData.error || "Failed to generate service descriptions");
        setSvcGenerating(false);
        return;
      }

      const data = await res.json();
      const selectedSet = new Set([
        ...Array.from(checkedServices),
        ...customServices,
      ]);
      const newServices: ServiceItem[] = (
        data.services as { serviceName: string; description: string }[]
      ).map((s) => ({
        serviceName: s.serviceName,
        description: s.description,
        isStructured: selectedSet.has(s.serviceName),
        isApproved: false,
        isPushed: false,
        pushedAt: null,
      }));

      setSavedServices(newServices);
      setSvcShowSelection(false);
      setSvcShowCards(true);
    } catch {
      setSvcError("Network error during generation. Please try again.");
    } finally {
      setSvcGenerating(false);
    }
  };

  const approveService = (index: number) => {
    setSavedServices((prev) =>
      prev.map((s, i) => (i === index ? { ...s, isApproved: true } : s))
    );
  };

  const unapproveService = (index: number) => {
    setSavedServices((prev) =>
      prev.map((s, i) => (i === index ? { ...s, isApproved: false } : s))
    );
  };

  const updateServiceDescription = (index: number, description: string) => {
    setSavedServices((prev) =>
      prev.map((s, i) => (i === index ? { ...s, description } : s))
    );
  };

  const approveAll = () => {
    setSavedServices((prev) =>
      prev.map((s) => (s.isPushed ? s : { ...s, isApproved: true }))
    );
  };

  const pushServices = async () => {
    setSvcPushing(true);
    setSvcError(null);
    try {
      const res = await fetch("/api/reoptimize/services/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      const data = await res.json();
      if (data.success) {
        setSvcPushSuccess(true);
        setSavedServices((prev) =>
          prev.map((s) =>
            s.isApproved
              ? { ...s, isPushed: true, pushedAt: new Date().toISOString() }
              : s
          )
        );
      } else {
        setSvcError(data.error || "Failed to push services to Google");
      }
    } catch {
      setSvcError("Network error. Please try again.");
    } finally {
      setSvcPushing(false);
    }
  };

  const startServiceReoptimize = () => {
    // Pre-check currently saved services
    const structuredNames = savedServices
      .filter((s) => s.isStructured)
      .map((s) => s.serviceName);
    const customNames = savedServices
      .filter((s) => !s.isStructured)
      .map((s) => s.serviceName);

    // Merge saved service names into available services so they appear as checkboxes
    // even when GBP returns no structured services for the category
    const availableNames = new Set(availableServices.map((a) => a.displayName));
    const mergedAvailable = [...availableServices];
    for (const name of structuredNames) {
      if (!availableNames.has(name)) {
        mergedAvailable.push({ serviceTypeId: `saved-${name}`, displayName: name });
      }
    }
    setAvailableServices(mergedAvailable);

    setCheckedServices(new Set(structuredNames));
    setCustomServices(customNames);
    setSvcShowSelection(true);
    setSvcShowCards(false);
    setSvcError(null);
    setSvcPushSuccess(false);
  };

  // --- Computed ---

  const descCharCount = aiDescription.length;
  const descCharColor = descCharCount > 750 ? "text-red-600" : "text-green-600";

  const approvedCount = savedServices.filter((s) => s.isApproved).length;
  const unapprovedCount = savedServices.filter(
    (s) => !s.isApproved && !s.isPushed
  ).length;

  // --- Loading State ---

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
        <p className="text-sm font-medium text-red-800">{error}</p>
      </div>
    );
  }

  // --- Render ---

  return (
    <div className="space-y-4">
      {/* Section 1: Description Re-optimization */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <button
          type="button"
          onClick={() => setDescExpanded(!descExpanded)}
          className="w-full px-6 py-4 flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            {descExpanded ? (
              <ChevronDown size={18} className="text-gray-400" />
            ) : (
              <ChevronRight size={18} className="text-gray-400" />
            )}
            <h3 className="text-base font-semibold text-gray-900">
              Description
            </h3>
            {savedDescription?.isPushed && (
              <span className="bg-green-100 text-green-700 text-xs rounded-full px-2 py-0.5">
                Pushed
              </span>
            )}
          </div>
          {descExpanded && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                generateDescription();
              }}
              disabled={descGenerating}
              className="flex items-center gap-1.5 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 rounded-md px-3 py-1.5 text-sm"
            >
              {descGenerating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Re-optimize
            </button>
          )}
        </button>

        {descExpanded && (
          <div className="px-6 pb-6 space-y-4">
            {/* Success Banner */}
            {descPushSuccess && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
                <p className="text-sm font-medium text-green-800">
                  Description successfully pushed to Google Business Profile
                </p>
              </div>
            )}

            {/* Error Banner */}
            {descError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-800">
                    {descError}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={generateDescription}
                  className="bg-red-600 text-white hover:bg-red-700 rounded-md px-3 py-1 text-xs font-medium shrink-0"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Loading skeleton during generation */}
            {descGenerating && (
              <div className="space-y-2">
                <div className="animate-pulse bg-gray-200 rounded h-4 w-full" />
                <div className="animate-pulse bg-gray-200 rounded h-4 w-5/6" />
                <div className="animate-pulse bg-gray-200 rounded h-4 w-4/6" />
                <div className="animate-pulse bg-gray-200 rounded h-4 w-full" />
                <div className="animate-pulse bg-gray-200 rounded h-4 w-3/6" />
              </div>
            )}

            {/* Side-by-side comparison */}
            {!descGenerating && descShowComparison && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* LEFT: Current Live */}
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      Current (Live on Google)
                    </p>
                    <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600 italic min-h-[120px]">
                      {currentGBPDescription || (
                        <span className="text-gray-400">
                          No description currently set
                        </span>
                      )}
                    </div>
                  </div>

                  {/* RIGHT: AI Suggestion */}
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      AI Suggestion
                    </p>
                    <textarea
                      value={aiDescription}
                      onChange={(e) => setAiDescription(e.target.value)}
                      rows={5}
                      disabled={descPushing}
                      className={`w-full border rounded-md p-3 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 min-h-[120px] ${
                        descCharCount > 750
                          ? "border-red-500"
                          : "border-gray-300"
                      }`}
                    />
                  </div>
                </div>

                {/* Character counter */}
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-medium ${descCharColor}`}>
                    {descCharCount} / 750 characters
                  </span>
                  {descCharCount > 750 && (
                    <span className="text-xs text-red-600">
                      Exceeds 750 character limit
                    </span>
                  )}
                </div>

                {/* Keyword Coverage */}
                {keywords.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">
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
                                ? "bg-green-50 text-green-700"
                                : "bg-gray-100 text-gray-500"
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

                {/* Action buttons */}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={pushDescription}
                    disabled={
                      !aiDescription.trim() ||
                      descCharCount > 750 ||
                      descPushing
                    }
                    className="flex items-center gap-2 bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 rounded-md px-4 py-2 text-sm font-medium"
                  >
                    {descPushing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Pushing...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        Approve & Push to Google
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={generateDescription}
                    disabled={descGenerating}
                    className="flex items-center gap-1.5 border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 rounded-md px-3 py-2 text-sm"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Regenerate
                  </button>
                </div>
              </>
            )}

            {/* Initial state: show current and saved descriptions */}
            {!descGenerating && !descShowComparison && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Current (Live on Google)
                  </p>
                  <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600 italic min-h-[80px]">
                    {currentGBPDescription || (
                      <span className="text-gray-400">
                        No description currently set
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Last Saved Description
                  </p>
                  <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600 italic min-h-[80px]">
                    {savedDescription ? (
                      <>
                        {savedDescription.content}
                        {savedDescription.isPushed && savedDescription.pushedAt && (
                          <p className="text-xs text-gray-400 mt-2 not-italic">
                            Pushed on{" "}
                            {new Date(
                              savedDescription.pushedAt
                            ).toLocaleDateString()}
                          </p>
                        )}
                      </>
                    ) : (
                      <span className="text-gray-400">
                        No saved description
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section 2: Services Re-optimization */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <button
          type="button"
          onClick={() => setSvcExpanded(!svcExpanded)}
          className="w-full px-6 py-4 flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            {svcExpanded ? (
              <ChevronDown size={18} className="text-gray-400" />
            ) : (
              <ChevronRight size={18} className="text-gray-400" />
            )}
            <h3 className="text-base font-semibold text-gray-900">Services</h3>
            {savedServices.length > 0 && (
              <span className="text-xs text-gray-500">
                ({savedServices.length} services)
              </span>
            )}
          </div>
          {svcExpanded && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                startServiceReoptimize();
              }}
              disabled={svcGenerating}
              className="flex items-center gap-1.5 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 rounded-md px-3 py-1.5 text-sm"
            >
              {svcGenerating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Re-optimize
            </button>
          )}
        </button>

        {svcExpanded && (
          <div className="px-6 pb-6 space-y-4">
            {/* Success Banner */}
            {svcPushSuccess && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
                <p className="text-sm font-medium text-green-800">
                  Services successfully pushed to Google Business Profile
                </p>
              </div>
            )}

            {/* Error Banner */}
            {svcError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-800">{svcError}</p>
                </div>
                <button
                  type="button"
                  onClick={generateServices}
                  className="bg-red-600 text-white hover:bg-red-700 rounded-md px-3 py-1 text-xs font-medium shrink-0"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Generation Loading */}
            {svcGenerating && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                  <p className="text-sm text-gray-600">
                    Generating descriptions for {totalSelected} services...
                  </p>
                </div>
                {Array.from({ length: Math.min(totalSelected, 5) }).map(
                  (_, i) => (
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
                  )
                )}
              </div>
            )}

            {/* Service Selection Phase */}
            {!svcGenerating && svcShowSelection && (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Wrench className="w-5 h-5 text-gray-700" />
                    <h4 className="text-sm font-semibold text-gray-900">
                      Available Services
                    </h4>
                  </div>
                  <p className="text-sm text-gray-500 mb-3">
                    Select the services to re-optimize with AI-generated
                    descriptions.
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
                      No structured services found for this business category.
                      Add custom services below.
                    </p>
                  )}
                </div>

                {/* Custom Service Input */}
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-1">
                    Add a custom service
                  </h4>
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

                {/* Generate Button */}
                <button
                  type="button"
                  onClick={generateServices}
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
            )}

            {/* Service Cards Phase */}
            {!svcGenerating && !svcShowSelection && svcShowCards && (
              <div className="space-y-4">
                {/* Running Counter */}
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-600">
                    {approvedCount} of {savedServices.length} services approved
                  </p>
                </div>

                {/* Service Cards */}
                {savedServices.map((service, index) => (
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

                    <textarea
                      value={service.description}
                      onChange={(e) =>
                        updateServiceDescription(index, e.target.value)
                      }
                      rows={3}
                      disabled={service.isPushed}
                      className="w-full border border-gray-300 rounded-md p-2 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:bg-gray-50"
                    />

                    <p className="text-xs text-gray-400 mt-1">
                      {service.description.length} characters
                    </p>

                    <div className="mt-2">
                      {service.isPushed ? (
                        <div className="flex items-center gap-1.5 text-blue-600 text-sm">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>
                            Pushed on{" "}
                            {service.pushedAt
                              ? new Date(
                                  service.pushedAt
                                ).toLocaleDateString()
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
                  {unapprovedCount > 0 && (
                    <button
                      type="button"
                      onClick={approveAll}
                      className="w-full bg-green-50 text-green-700 border border-green-200 rounded-md px-4 py-2 text-sm font-medium hover:bg-green-100"
                    >
                      Approve All Remaining ({unapprovedCount})
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={pushServices}
                    disabled={approvedCount === 0 || svcPushing}
                    className="w-full bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 rounded-md px-6 py-2.5 font-medium text-sm"
                  >
                    {svcPushing ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Pushing to Google...
                      </span>
                    ) : (
                      "Push All to Google"
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Initial state: show currently saved services */}
            {!svcGenerating &&
              !svcShowSelection &&
              !svcShowCards &&
              currentGBPServices.length === 0 &&
              savedServices.length === 0 && (
                <p className="text-sm text-gray-400 italic">
                  No services found. Click &quot;Re-optimize&quot; to select and
                  generate service descriptions.
                </p>
              )}

            {!svcGenerating &&
              !svcShowSelection &&
              !svcShowCards &&
              currentGBPServices.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Currently Live on Google
                  </p>
                  <div className="space-y-1">
                    {currentGBPServices.map((svc) => (
                      <div
                        key={svc.serviceTypeId}
                        className="flex items-center gap-2 text-sm text-gray-600 py-1"
                      >
                        <Wrench className="w-3.5 h-3.5 text-gray-400" />
                        {svc.displayName}
                      </div>
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}
      </div>
    </div>
  );
}
