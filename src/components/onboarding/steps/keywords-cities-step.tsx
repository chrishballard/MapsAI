"use client";

import { useState, useEffect } from "react";
import { Sparkles, Plus, X, Loader2, MapPin } from "lucide-react";

interface KeywordsCitiesStepProps {
  profileId: string;
  onComplete: () => Promise<void>;
}

interface Suggestion {
  keyword: string;
  reasoning: string;
}

export function KeywordsCitiesStep({
  profileId,
  onComplete,
}: KeywordsCitiesStepProps) {
  const [keywords, setKeywords] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [newCity, setNewCity] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [kwRes, cityRes] = await Promise.all([
          fetch(`/api/onboarding/keywords?profileId=${profileId}`),
          fetch(`/api/onboarding/cities?profileId=${profileId}`),
        ]);
        if (kwRes.ok) {
          const kwData = await kwRes.json();
          setKeywords(kwData.keywords ?? []);
        }
        if (cityRes.ok) {
          const cityData = await cityRes.json();
          setCities(cityData.cities ?? []);
        }
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [profileId]);

  const generateSuggestions = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/onboarding/keywords/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data.suggestions ?? []);
      }
    } finally {
      setGenerating(false);
    }
  };

  const addKeyword = (kw: string) => {
    const trimmed = kw.trim();
    if (!trimmed || keywords.length >= 10 || keywords.includes(trimmed)) return;
    setKeywords((prev) => [...prev, trimmed]);
    setNewKeyword("");
  };

  const removeKeyword = (kw: string) => {
    setKeywords((prev) => prev.filter((k) => k !== kw));
  };

  const addCity = (city: string) => {
    const trimmed = city.trim();
    if (!trimmed || cities.length >= 3 || cities.includes(trimmed)) return;
    setCities((prev) => [...prev, trimmed]);
    setNewCity("");
  };

  const removeCity = (city: string) => {
    setCities((prev) => prev.filter((c) => c !== city));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all([
        fetch("/api/onboarding/keywords", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileId, keywords }),
        }),
        fetch("/api/onboarding/cities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileId, cities }),
        }),
      ]);
      await onComplete();
    } finally {
      setSaving(false);
    }
  };

  const filteredSuggestions = suggestions?.filter(
    (s) => !keywords.includes(s.keyword)
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Section 1: Target Keywords */}
      <div>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              Target Keywords
            </h3>
            <p className="text-sm text-gray-500">
              Up to 10 keywords that describe your business and services
            </p>
          </div>
          <button
            type="button"
            onClick={generateSuggestions}
            disabled={generating}
            className="flex items-center gap-1.5 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 rounded-md px-3 py-1.5 text-sm whitespace-nowrap"
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
          <div className="bg-blue-50 border border-blue-100 rounded-md p-3 mb-4 space-y-2">
            {filteredSuggestions.map((s) => (
              <div
                key={s.keyword}
                className="flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <span className="font-medium text-sm">{s.keyword}</span>
                  <span className="text-xs text-gray-400 ml-2">
                    {s.reasoning}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => addKeyword(s.keyword)}
                  disabled={keywords.length >= 10}
                  className="flex items-center gap-1 border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 rounded-md px-2 py-1 text-xs shrink-0"
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
                className="bg-blue-50 text-blue-700 rounded-full px-3 py-1.5 text-sm flex items-center gap-1.5"
              >
                {kw}
                <button
                  type="button"
                  onClick={() => removeKeyword(kw)}
                  className="text-blue-400 hover:text-red-500"
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
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => addKeyword(newKeyword)}
            disabled={keywords.length >= 10 || !newKeyword.trim()}
            className="border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 rounded-md px-3 py-1.5 text-sm"
          >
            Add
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1">
          {keywords.length}/10
        </p>
      </div>

      {/* Section 2: Target Cities */}
      <div>
        <div className="mb-4">
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-1.5">
            <MapPin className="w-4 h-4" />
            Target Cities
          </h3>
          <p className="text-sm text-gray-500">
            Up to 3 cities or service areas
          </p>
        </div>

        {/* City Chips */}
        {cities.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {cities.map((city) => (
              <span
                key={city}
                className="bg-green-50 text-green-700 rounded-full px-3 py-1.5 text-sm flex items-center gap-1.5"
              >
                {city}
                <button
                  type="button"
                  onClick={() => removeCity(city)}
                  className="text-green-400 hover:text-red-500"
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
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => addCity(newCity)}
            disabled={cities.length >= 3 || !newCity.trim()}
            className="border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 rounded-md px-3 py-1.5 text-sm"
          >
            Add
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1">
          {cities.length}/3
        </p>
      </div>

      {/* Save & Continue */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || keywords.length === 0}
        className="w-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 rounded-md py-2.5 font-medium text-sm"
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
    </div>
  );
}
