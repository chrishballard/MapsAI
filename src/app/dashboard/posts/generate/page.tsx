"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Sparkles,
  ArrowLeft,
  Check,
  AlertCircle,
  Loader2,
} from "lucide-react";

interface Profile {
  id: string;
  name: string;
  category: string | null;
}

interface GenerationResult {
  profileId: string;
  count: number;
  status: "success" | "error";
  error?: string;
}

export default function GeneratePostsPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [currentProfile, setCurrentProfile] = useState<string | null>(null);
  const [results, setResults] = useState<GenerationResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProfiles() {
      try {
        const res = await fetch("/api/profiles");
        if (!res.ok) throw new Error("Failed to fetch profiles");
        const data = await res.json();
        setProfiles(data.profiles);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load profiles"
        );
      } finally {
        setLoading(false);
      }
    }
    fetchProfiles();
  }, []);

  const toggleProfile = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(profiles.map((p) => p.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleGenerate = async () => {
    if (selectedIds.size === 0) return;

    setGenerating(true);
    setError(null);
    setResults(null);

    const profileIds = Array.from(selectedIds);
    // Show which profile is being processed
    const firstProfile = profiles.find((p) => p.id === profileIds[0]);
    setCurrentProfile(firstProfile?.name || profileIds[0]);

    try {
      const res = await fetch("/api/posts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileIds }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Generation failed");
      }

      const data = await res.json();
      setResults(data.results);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Generation failed"
      );
    } finally {
      setGenerating(false);
      setCurrentProfile(null);
    }
  };

  const totalGenerated =
    results?.reduce((sum, r) => sum + r.count, 0) || 0;
  const successCount =
    results?.filter((r) => r.status === "success").length || 0;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/dashboard/posts"
          className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Generate Posts</h1>
          <p className="text-sm text-gray-500 mt-1">
            Select profiles to generate AI-powered monthly post drafts
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle size={20} className="text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {results && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-start gap-3">
            <Check size={20} className="text-green-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-green-800">
                Generated {totalGenerated} posts for {successCount} profile
                {successCount !== 1 ? "s" : ""}
              </p>
              {results.some((r) => r.status === "error") && (
                <div className="mt-2 space-y-1">
                  {results
                    .filter((r) => r.status === "error")
                    .map((r) => (
                      <p key={r.profileId} className="text-xs text-red-600">
                        Failed: {r.error}
                      </p>
                    ))}
                </div>
              )}
              <Link
                href="/dashboard/posts"
                className="inline-flex items-center gap-1 mt-3 text-sm font-medium text-green-700 hover:text-green-800"
              >
                View Posts
                <ArrowLeft size={14} className="rotate-180" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <Loader2
            size={32}
            className="text-gray-300 mx-auto mb-4 animate-spin"
          />
          <p className="text-gray-500">Loading profiles...</p>
        </div>
      ) : profiles.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <AlertCircle size={48} className="text-gray-300 mx-auto mb-4" />
          <h2 className="text-lg font-medium text-gray-900 mb-2">
            No profiles available
          </h2>
          <p className="text-gray-500">
            Connect a Google account and sync profiles first.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <button
                onClick={selectAll}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Select All
              </button>
              <span className="text-gray-300">|</span>
              <button
                onClick={deselectAll}
                className="text-sm text-gray-500 hover:text-gray-700 font-medium"
              >
                Deselect All
              </button>
            </div>
            <span className="text-sm text-gray-500">
              {selectedIds.size} selected
            </span>
          </div>

          <div className="space-y-2 mb-6">
            {profiles.map((profile) => (
              <label
                key={profile.id}
                className={`flex items-center gap-3 p-4 bg-white rounded-lg border cursor-pointer transition-colors ${
                  selectedIds.has(profile.id)
                    ? "border-blue-300 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(profile.id)}
                  onChange={() => toggleProfile(profile.id)}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300"
                />
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {profile.name}
                  </p>
                  {profile.category && (
                    <p className="text-xs text-gray-500">{profile.category}</p>
                  )}
                </div>
              </label>
            ))}
          </div>

          <button
            onClick={handleGenerate}
            disabled={selectedIds.size === 0 || generating}
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Generating posts for {currentProfile}...
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Generate Monthly Posts
              </>
            )}
          </button>
        </>
      )}
    </div>
  );
}
