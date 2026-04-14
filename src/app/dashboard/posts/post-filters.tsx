"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

interface PostFiltersProps {
  profiles: Array<{ id: string; name: string }>;
  currentProfileId?: string;
  currentStatus?: string;
  currentType?: string;
}

export function PostFilters({
  profiles,
  currentProfileId,
  currentStatus,
  currentType,
}: PostFiltersProps) {
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
      router.push(`/dashboard/posts?${params.toString()}`);
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
        value={currentStatus || "SCHEDULED"}
        onChange={(e) => updateFilter("status", e.target.value)}
        className="px-3 py-2 border border-border rounded-xl text-sm text-foreground bg-white focus:ring-4 focus:ring-brand-50 focus:border-brand-300 outline-none transition-all"
      >
        <option value="all">All Statuses</option>
        <option value="DRAFT">Draft</option>
        <option value="APPROVED">Approved</option>
        <option value="SCHEDULED">Scheduled</option>
        <option value="PUBLISHED">Published</option>
        <option value="FAILED">Failed</option>
      </select>

      <select
        value={currentType || ""}
        onChange={(e) => updateFilter("type", e.target.value)}
        className="px-3 py-2 border border-border rounded-xl text-sm text-foreground bg-white focus:ring-4 focus:ring-brand-50 focus:border-brand-300 outline-none transition-all"
      >
        <option value="">All Types</option>
        <option value="WHATS_NEW">What&apos;s New</option>
        <option value="EVENT">Event</option>
        <option value="OFFER">Offer</option>
      </select>
    </div>
  );
}
