"use client";

import { useState, useEffect } from "react";
import { Loader2, Settings } from "lucide-react";

interface SettingsStepProps {
  profileId: string;
  onComplete: () => Promise<void>;
}

const PRESETS = [4, 8, 12];

export function SettingsStep({ profileId, onComplete }: SettingsStepProps) {
  const [postFrequency, setPostFrequency] = useState(4);
  const [isCustom, setIsCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSettings() {
      try {
        const res = await fetch(
          `/api/onboarding/settings?profileId=${profileId}`
        );
        if (res.ok) {
          const data = await res.json();
          const freq = data.postFrequency ?? 4;
          setPostFrequency(freq);
          if (!PRESETS.includes(freq)) {
            setIsCustom(true);
          }
        }
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, [profileId]);

  const handleSelectChange = (value: string) => {
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
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/onboarding/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, postFrequency }),
      });
      if (res.ok) {
        await onComplete();
      } else {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error || "Failed to save settings");
      }
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="w-5 h-5 text-gray-400" />
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Post Frequency
          </h3>
          <p className="text-sm text-gray-500">
            How often should we generate and publish posts for this profile?
          </p>
        </div>
      </div>

      {/* Dropdown */}
      <div>
        <select
          value={isCustom ? "custom" : postFrequency.toString()}
          onChange={(e) => handleSelectChange(e.target.value)}
          className="w-full border border-gray-300 rounded-md p-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
          <label className="text-sm text-gray-700 block mb-1.5">
            Posts per month
          </label>
          <input
            type="number"
            min={1}
            max={30}
            value={postFrequency}
            onChange={(e) => handleCustomChange(e.target.value)}
            className="w-full border border-gray-300 rounded-md p-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <p className="text-xs text-gray-400 mt-1">
            Maximum 30 posts per month
          </p>
        </div>
      )}

      {/* Save & Continue */}
      <div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 rounded-md px-6 py-2.5 font-medium text-sm mt-6"
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </span>
          ) : (
            "Save & Continue"
          )}
        </button>

        {saveError && (
          <p className="text-sm text-red-600 mt-2">{saveError}</p>
        )}

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
