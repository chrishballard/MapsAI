"use client";

import { useState, useEffect } from "react";
import {
  SlidersHorizontal,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface GBPAttribute {
  attributeId: string;
  displayName: string;
  groupDisplayName: string;
  valueType: "BOOL" | "ENUM" | "REPEATED_ENUM" | "URL";
  values: unknown[];
  valueMetadata?: Array<{ value: string; displayName: string }>;
}

interface AttributeState {
  attributeId: string;
  displayName: string;
  groupDisplayName: string;
  valueType: "BOOL" | "ENUM" | "REPEATED_ENUM" | "URL";
  boolValue?: boolean;
  enumValue?: string;
  repeatedEnumValues?: string[];
  urlValue?: string;
  valueMetadata?: Array<{ value: string; displayName: string }>;
}

interface AttributesStepProps {
  profileId: string;
  onComplete: () => Promise<void>;
}

function parseAttribute(attr: GBPAttribute): AttributeState {
  const base = {
    attributeId: attr.attributeId,
    displayName: attr.displayName,
    groupDisplayName: attr.groupDisplayName,
    valueType: attr.valueType,
    valueMetadata: attr.valueMetadata,
  };

  switch (attr.valueType) {
    case "BOOL":
      return { ...base, boolValue: attr.values[0] === true };
    case "ENUM":
      return { ...base, enumValue: (attr.values[0] as string) ?? "" };
    case "REPEATED_ENUM":
      return {
        ...base,
        repeatedEnumValues: (attr.values as string[]) ?? [],
      };
    case "URL": {
      const v = attr.values[0];
      const uri =
        typeof v === "string"
          ? v
          : typeof v === "object" && v !== null && "uri" in v
            ? (v as { uri: string }).uri
            : "";
      return { ...base, urlValue: uri };
    }
    default:
      return base;
  }
}

function groupAttributes(
  attrs: AttributeState[]
): Map<string, AttributeState[]> {
  const groups = new Map<string, AttributeState[]>();
  for (const attr of attrs) {
    const group = attr.groupDisplayName || "Other";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(attr);
  }
  return groups;
}

export function AttributesStep({ profileId, onComplete }: AttributesStepProps) {
  const [attributes, setAttributes] = useState<AttributeState[]>([]);
  const [loading, setLoading] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set()
  );
  const [noAttributes, setNoAttributes] = useState(false);

  useEffect(() => {
    async function fetchAttributes() {
      try {
        const res = await fetch(
          `/api/onboarding/attributes?profileId=${profileId}`
        );
        if (res.ok) {
          const data = await res.json();
          if (!data.attributes || data.attributes.length === 0) {
            setNoAttributes(true);
            setTimeout(() => onComplete(), 1500);
            return;
          }
          setAttributes(
            data.attributes.map((a: GBPAttribute) => parseAttribute(a))
          );
        }
      } finally {
        setLoading(false);
      }
    }
    fetchAttributes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  const updateAttribute = (
    attributeId: string,
    update: Partial<AttributeState>
  ) => {
    setAttributes((prev) =>
      prev.map((a) => (a.attributeId === attributeId ? { ...a, ...update } : a))
    );
  };

  const handlePush = async () => {
    setPushing(true);
    setPushError(null);
    try {
      const payload = attributes
        .map((attr) => {
          switch (attr.valueType) {
            case "BOOL":
              return {
                attributeId: attr.attributeId,
                valueType: "BOOL",
                values: [attr.boolValue ?? false],
              };
            case "ENUM":
              if (!attr.enumValue) return null;
              return {
                attributeId: attr.attributeId,
                valueType: "ENUM",
                values: [attr.enumValue],
              };
            case "REPEATED_ENUM":
              return {
                attributeId: attr.attributeId,
                valueType: "REPEATED_ENUM",
                repeatedEnumValue: {
                  setValues: attr.repeatedEnumValues ?? [],
                  unsetValues: [],
                },
              };
            case "URL":
              if (!attr.urlValue) return null;
              return {
                attributeId: attr.attributeId,
                valueType: "URL",
                uriValues: [{ uri: attr.urlValue }],
              };
            default:
              return null;
          }
        })
        .filter(Boolean);

      const res = await fetch("/api/onboarding/attributes/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, attributes: payload }),
      });
      const data = await res.json();
      if (data.success) {
        setPushSuccess(true);
        setTimeout(() => onComplete(), 2500);
      } else {
        setPushError(data.error || "Failed to push attributes to Google");
      }
    } catch {
      setPushError("Network error. Please try again.");
    } finally {
      setPushing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (noAttributes) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-3 text-center">
        <SlidersHorizontal className="w-12 h-12 text-gray-300" />
        <h3 className="text-lg font-semibold text-gray-900">
          No attributes available for this business category
        </h3>
        <p className="text-sm text-gray-400">Auto-advancing...</p>
      </div>
    );
  }

  const grouped = groupAttributes(attributes);

  return (
    <div className="space-y-6">
      {/* Success Banner */}
      {pushSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-green-800">
              Attributes successfully pushed to Google Business Profile
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

      {/* Heading */}
      <div>
        <h3 className="text-base font-semibold text-gray-900">
          Business Attributes
        </h3>
        <p className="text-sm text-gray-500">
          Manage your Google Business Profile attributes. Toggle, select, or
          enter values, then push to Google.
        </p>
      </div>

      {/* Grouped Attributes */}
      {Array.from(grouped.entries()).map(([group, attrs]) => {
        const isCollapsed = collapsedGroups.has(group);
        return (
          <div
            key={group}
            className="bg-white rounded-lg shadow-sm border border-gray-200"
          >
            <button
              type="button"
              onClick={() => toggleGroup(group)}
              className="w-full flex items-center justify-between p-4 text-left"
            >
              <span className="font-medium text-gray-900">{group}</span>
              {isCollapsed ? (
                <ChevronRight className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </button>

            {!isCollapsed && (
              <div className="px-4 pb-4">
                {attrs.map((attr) => (
                  <div
                    key={attr.attributeId}
                    className="py-3 border-b border-gray-100 last:border-b-0"
                  >
                    {attr.valueType === "BOOL" && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">
                          {attr.displayName}
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={attr.boolValue ?? false}
                          onClick={() =>
                            updateAttribute(attr.attributeId, {
                              boolValue: !(attr.boolValue ?? false),
                            })
                          }
                          className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${
                            attr.boolValue ? "bg-blue-600" : "bg-gray-200"
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              attr.boolValue
                                ? "translate-x-5"
                                : "translate-x-1"
                            }`}
                          />
                        </button>
                      </div>
                    )}

                    {attr.valueType === "ENUM" && (
                      <div>
                        <span className="text-sm text-gray-700 block mb-2">
                          {attr.displayName}
                        </span>
                        <div className="space-y-1.5">
                          {attr.valueMetadata?.map((meta) => (
                            <label
                              key={meta.value}
                              className="flex items-center gap-2 cursor-pointer"
                            >
                              <input
                                type="radio"
                                name={attr.attributeId}
                                value={meta.value}
                                checked={attr.enumValue === meta.value}
                                onChange={() =>
                                  updateAttribute(attr.attributeId, {
                                    enumValue: meta.value,
                                  })
                                }
                                className="w-4 h-4 text-blue-600"
                              />
                              <span className="text-sm text-gray-700">
                                {meta.displayName}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {attr.valueType === "REPEATED_ENUM" && (
                      <div>
                        <span className="text-sm text-gray-700 block mb-2">
                          {attr.displayName}
                        </span>
                        <div className="space-y-1.5">
                          {attr.valueMetadata?.map((meta) => {
                            const checked = (
                              attr.repeatedEnumValues ?? []
                            ).includes(meta.value);
                            return (
                              <label
                                key={meta.value}
                                className="flex items-center gap-2 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    const current =
                                      attr.repeatedEnumValues ?? [];
                                    const next = checked
                                      ? current.filter(
                                          (v) => v !== meta.value
                                        )
                                      : [...current, meta.value];
                                    updateAttribute(attr.attributeId, {
                                      repeatedEnumValues: next,
                                    });
                                  }}
                                  className="w-4 h-4 text-blue-600 rounded"
                                />
                                <span className="text-sm text-gray-700">
                                  {meta.displayName}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {attr.valueType === "URL" && (
                      <div>
                        <label className="text-sm text-gray-700 block mb-1.5">
                          {attr.displayName}
                        </label>
                        <input
                          type="url"
                          placeholder="https://..."
                          value={attr.urlValue ?? ""}
                          onChange={(e) =>
                            updateAttribute(attr.attributeId, {
                              urlValue: e.target.value,
                            })
                          }
                          className="w-full border border-gray-300 rounded-md p-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Push to Google Button */}
      <div>
        <button
          type="button"
          onClick={handlePush}
          disabled={pushing || pushSuccess}
          className="w-full bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 rounded-md px-6 py-2.5 font-medium text-sm"
        >
          {pushing ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Pushing to Google...
            </span>
          ) : (
            "Push to Google"
          )}
        </button>
        <button
          type="button"
          onClick={() => onComplete()}
          className="w-full text-gray-500 underline text-sm py-2 mt-2"
        >
          Skip for Now
        </button>
      </div>
    </div>
  );
}
