"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

interface ReviewFiltersProps {
  profiles: Array<{ id: string; name: string }>;
  currentProfileId?: string;
  currentRating?: string;
  currentResponseStatus?: string;
}

export function ReviewFilters({
  profiles,
  currentProfileId,
  currentRating,
  currentResponseStatus,
}: ReviewFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.push(`/dashboard/reviews?${params.toString()}`);
    },
    [router, searchParams]
  );

  return (
    <div className="flex flex-wrap gap-3 mb-6">
      <select
        value={currentProfileId || ""}
        onChange={(e) => updateFilter("profileId", e.target.value)}
        className="px-3 py-2 border border-border rounded-xl text-sm text-foreground bg-white focus:ring-4 focus:ring-brand-50 focus:border-brand-300 outline-none transition-all"
      >
        <option value="">All Profiles</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <select
        value={currentRating || ""}
        onChange={(e) => updateFilter("rating", e.target.value)}
        className="px-3 py-2 border border-border rounded-xl text-sm text-foreground bg-white focus:ring-4 focus:ring-brand-50 focus:border-brand-300 outline-none transition-all"
      >
        <option value="">All Ratings</option>
        <option value="5">5 Stars</option>
        <option value="4">4 Stars</option>
        <option value="3">3 Stars</option>
        <option value="2">2 Stars</option>
        <option value="1">1 Star</option>
      </select>

      <select
        value={currentResponseStatus || ""}
        onChange={(e) => updateFilter("responseStatus", e.target.value)}
        className="px-3 py-2 border border-border rounded-xl text-sm text-foreground bg-white focus:ring-4 focus:ring-brand-50 focus:border-brand-300 outline-none transition-all"
      >
        <option value="">All Statuses</option>
        <option value="DRAFTED">Drafted</option>
        <option value="APPROVED">Approved</option>
        <option value="PUBLISHED">Published</option>
        <option value="FAILED">Failed</option>
      </select>
    </div>
  );
}
