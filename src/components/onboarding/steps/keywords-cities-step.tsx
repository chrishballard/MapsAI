"use client";

import { useState, useEffect } from "react";
import { Sparkles, Plus, X, Loader2, MapPin, CheckCircle2 } from "lucide-react";
import { fetchJson, sendJson } from "@/lib/fetch-json";

interface KeywordsCitiesStepProps {
  profileId: string;
  onComplete?: () => Promise<void>;
  // Rendered outside the onboarding wizard (Profile Settings page):
  // saves stay on the page with a confirmation instead of advancing.
  standalone?: boolean;
}

interface Suggestion {
  keyword: string;
  reasoning: string;
}

interface CitySuggestion {
  city: string;
  reasoning: string;
}

export function KeywordsCitiesStep({
  profileId,
  onComplete,
  standalone = false,
}: KeywordsCitiesStepProps) {
  const [keywords, setKeywords] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [citySuggestions, setCitySuggestions] = useState<CitySuggestion[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatingCities, setGeneratingCities] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [newCity, setNewCity] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [kwData, cityData] = await Promise.all([
          fetchJson<{ keywords?: { keyword: string }[] }>(
            `/api/onboarding/keywords?profileId=${profileId}`
          ),
          fetchJson<{ cities?: { city: string }[] }>(
            `/api/onboarding/cities?profileId=${profileId}`
          ),
        ]);
        setKeywords(
          (kwData.keywords ?? []).map((k: { keyword: string }) => k.keyword)
        );
        setCities(
          (cityData.cities ?? []).map((c: { city: string }) => c.city)
        );
      } catch (err) {
        console.error("Failed to load keywords/cities:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [profileId]);

  const generateSuggestions = async () => {
    setGenerating(true);
    try {
      const data = await sendJson<{ keywords?: Suggestion[] }>(
        "/api/onboarding/keywords/generate",
        { profileId }
      );
      setSuggestions(data.keywords ?? []);
    } catch (err) {
      console.error("Failed to generate keyword suggestions:", err);
    } finally {
      setGenerating(false);
    }
  };

  const generateCitySuggestions = async () => {
    setGeneratingCities(true);
    try {
      const data = await sendJson<{ cities?: CitySuggestion[] }>(
        "/api/onboarding/cities/generate",
        { profileId }
      );
      setCitySuggestions(data.cities ?? []);
    } catch (err) {
      console.error("Failed to generate city suggestions:", err);
    } finally {
      setGeneratingCities(false);
    }
  };

  const addKeyword = (kw: string) => {
    const trimmed = kw.trim();
    if (!trimmed || keywords.length >= 10 || keywords.includes(trimmed)) return;
    setKeywords((prev) => [...prev, trimmed]);
    setNewKeyword("");
    setSaveSuccess(false);
  };

  const removeKeyword = (kw: string) => {
    setKeywords((prev) => prev.filter((k) => k !== kw));
    setSaveSuccess(false);
  };

  const addCity = (city: string) => {
    const trimmed = city.trim();
    if (!trimmed || cities.length >= 3 || cities.includes(trimmed)) return;
    setCities((prev) => [...prev, trimmed]);
    setNewCity("");
    setSaveSuccess(false);
  };

  const removeCity = (city: string) => {
    setCities((prev) => prev.filter((c) => c !== city));
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // Keywords feed descriptions, services, and post generation downstream —
      // never advance the wizard unless both saves actually succeeded.
      await Promise.all([
        sendJson("/api/onboarding/keywords", { profileId, keywords }),
        sendJson("/api/onboarding/cities", { profileId, cities }),
      ]);

      setSaveSuccess(true);
      await onComplete?.();
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : "Network error while saving. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const filteredSuggestions = suggestions?.filter(
    (s) => !keywords.includes(s.keyword)
  );

  const filteredCitySuggestions = citySuggestions?.filter(
    (s) => !cities.some((c) => c.toLowerCase() === s.city.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Section 1: Target Keywords */}
      <div>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              Target Keywords
            </h3>
            <p className="text-sm text-muted-foreground">
              Up to 10 keywords that describe your business and services
            </p>
          </div>
          <button
            type="button"
            onClick={generateSuggestions}
            disabled={generating}
            className="flex items-center gap-1.5 bg-primary text-white hover:bg-primary/90 disabled:opacity-50 rounded-md px-3 py-1.5 text-sm whitespace-nowrap"
          >
            {generating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            Generate with AI
          </button>
        </div>

        {/* AI Suggestions Panel */}
        {filteredSuggestions && filteredSuggestions.length > 0 && (
          <div className="bg-brand-50 border border-brand-100 rounded-md p-3 mb-4 space-y-2">
            {filteredSuggestions.map((s) => (
              <div
                key={s.keyword}
                className="flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-sm text-foreground">{s.keyword}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {s.reasoning}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => addKeyword(s.keyword)}
                  disabled={keywords.length >= 10}
                  className="flex items-center gap-1 border border-border bg-white text-foreground hover:bg-zinc-50 disabled:opacity-50 rounded-md px-2 py-1 text-xs shrink-0"
                >
                  <Plus className="w-3 h-3" />
                  Add
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Keyword Chips */}
        {keywords.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {keywords.map((kw) => (
              <span
                key={kw}
                className="bg-brand-50 text-primary rounded-full px-3 py-1.5 text-sm flex items-center gap-1.5"
              >
                {kw}
                <button
                  type="button"
                  onClick={() => removeKeyword(kw)}
                  className="text-brand-400 hover:text-red-500"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Add Keyword Input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addKeyword(newKeyword);
              }
            }}
            placeholder="Add a keyword..."
            disabled={keywords.length >= 10}
            className="border border-border rounded-md px-3 py-1.5 text-sm text-foreground flex-1 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => addKeyword(newKeyword)}
            disabled={keywords.length >= 10 || !newKeyword.trim()}
            className="border border-border text-foreground hover:bg-zinc-50 disabled:opacity-50 rounded-md px-3 py-1.5 text-sm"
          >
            Add
          </button>
        </div>
        <p className="text-xs text-zinc-400 mt-1">
          {keywords.length}/10
        </p>
      </div>

      {/* Section 2: Target Cities */}
      <div>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-foreground flex items-center gap-1.5">
              <MapPin className="w-4 h-4" />
              Target Cities
            </h3>
            <p className="text-sm text-muted-foreground">
              Up to 3 cities or service areas
            </p>
          </div>
          <button
            type="button"
            onClick={generateCitySuggestions}
            disabled={generatingCities}
            className="flex items-center gap-1.5 bg-primary text-white hover:bg-primary/90 disabled:opacity-50 rounded-md px-3 py-1.5 text-sm whitespace-nowrap"
          >
            {generatingCities ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            Suggest Cities
          </button>
        </div>

        {/* AI City Suggestions Panel */}
        {filteredCitySuggestions && filteredCitySuggestions.length > 0 && (
          <div className="bg-emerald-50 border border-emerald-100 rounded-md p-3 mb-4 space-y-2">
            {filteredCitySuggestions.map((s) => (
              <div
                key={s.city}
                className="flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-sm text-foreground">{s.city}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {s.reasoning}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => addCity(s.city)}
                  disabled={cities.length >= 3}
                  className="flex items-center gap-1 border border-border bg-white text-foreground hover:bg-zinc-50 disabled:opacity-50 rounded-md px-2 py-1 text-xs shrink-0"
                >
                  <Plus className="w-3 h-3" />
                  Add
                </button>
              </div>
            ))}
          </div>
        )}

        {/* City Chips */}
        {cities.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {cities.map((city) => (
              <span
                key={city}
                className="bg-emerald-50 text-emerald-700 rounded-full px-3 py-1.5 text-sm flex items-center gap-1.5"
              >
                {city}
                <button
                  type="button"
                  onClick={() => removeCity(city)}
                  className="text-emerald-400 hover:text-red-500"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Add City Input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={newCity}
            onChange={(e) => setNewCity(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCity(newCity);
              }
            }}
            placeholder="Add a city..."
            disabled={cities.length >= 3}
            className="border border-border rounded-md px-3 py-1.5 text-sm text-foreground flex-1 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => addCity(newCity)}
            disabled={cities.length >= 3 || !newCity.trim()}
            className="border border-border text-foreground hover:bg-zinc-50 disabled:opacity-50 rounded-md px-3 py-1.5 text-sm"
          >
            Add
          </button>
        </div>
        <p className="text-xs text-zinc-400 mt-1">
          {cities.length}/3
        </p>
      </div>

      {/* Save & Continue */}
      <div>
        {saveError && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-3">
            <p className="text-sm font-medium text-red-800">{saveError}</p>
          </div>
        )}
        {standalone && saveSuccess && (
          <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 mb-3">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Changes saved. New keywords and cities apply to all AI content
            generated from now on.
          </p>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-primary text-white hover:bg-primary/90 disabled:opacity-50 rounded-md py-2.5 font-medium text-sm"
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </span>
          ) : standalone ? (
            "Save Changes"
          ) : (
            "Save & Continue"
          )}
        </button>
      </div>
    </div>
  );
}
