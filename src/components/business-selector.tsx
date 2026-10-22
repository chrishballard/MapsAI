"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Search, Building2, Check } from "lucide-react";

interface Profile {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  // Offboarded with reviews still synced: in the selector for its reviews
  // settings, but it gets no AI posts and is left off the Generate page.
  reviewsOnly?: boolean;
}

export function ReviewsOnlyBadge() {
  return (
    <span
      title="Reviews are synced and answered; this business gets no AI posts"
      className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
    >
      Reviews only
    </span>
  );
}

export function BusinessOption({
  profile,
  selected,
  onSelect,
}: {
  profile: Profile;
  selected: boolean;
  onSelect: (profileId: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(profile.id)}
      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-50 transition-colors"
    >
      <div className="w-8 h-8 bg-zinc-100 rounded-full flex items-center justify-center shrink-0">
        <Building2 size={14} className="text-muted-foreground" />
      </div>
      <div className="text-left min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">
          {profile.name}
        </p>
        {profile.reviewsOnly ? (
          <p className="text-xs text-muted-foreground truncate">
            No AI posts{profile.address ? ` · ${profile.address}` : ""}
          </p>
        ) : (
          profile.address && (
            <p className="text-xs text-muted-foreground truncate">
              {profile.address}
            </p>
          )
        )}
      </div>
      {profile.reviewsOnly && <ReviewsOnlyBadge />}
      {selected && <Check size={16} className="text-brand-600 shrink-0" />}
    </button>
  );
}

export function BusinessSelector() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/profiles")
      .then((r) => {
        if (!r.ok) return { profiles: [] };
        return r.json();
      })
      .then((data) => setProfiles(data.profiles || []))
      .catch(() => setProfiles([]));

    // Read initial selection from cookie
    const match = document.cookie.match(/(?:^|; )selectedProfileId=([^;]*)/);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- document.cookie does not exist during SSR, so the initial selection must hydrate in an effect rather than a useState initializer
    if (match) setSelectedId(match[1] || null);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open]);

  const selectedProfile = profiles.find((p) => p.id === selectedId);
  const filtered = profiles.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.address && p.address.toLowerCase().includes(search.toLowerCase()))
  );

  function select(profileId: string | null) {
    setSelectedId(profileId);
    setOpen(false);
    setSearch("");

    if (profileId) {
      document.cookie = `selectedProfileId=${profileId}; path=/; max-age=${60 * 60 * 24 * 365}`;
    } else {
      document.cookie = "selectedProfileId=; path=/; max-age=0";
    }

    router.refresh();
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 bg-white border border-border rounded-lg hover:border-brand-300 transition-colors min-w-[220px]"
      >
        <Building2 size={16} className="text-zinc-400 shrink-0" />
        <span className="text-sm font-medium text-foreground truncate">
          {selectedProfile ? selectedProfile.name : "All Businesses"}
        </span>
        {selectedProfile?.reviewsOnly && <ReviewsOnlyBadge />}
        <ChevronDown size={14} className="text-zinc-400 ml-auto shrink-0" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-80 bg-white border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded-xl focus:outline-none focus:ring-4 focus:ring-brand-50 focus:border-brand-300"
              />
            </div>
          </div>

          {/* All Businesses option */}
          <button
            onClick={() => select(null)}
            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-50 transition-colors border-b border-border"
          >
            <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center shrink-0">
              <Building2 size={14} className="text-brand-600" />
            </div>
            <span className="text-sm font-medium text-foreground">All Businesses</span>
            {!selectedId && (
              <Check size={16} className="text-brand-600 ml-auto" />
            )}
          </button>

          {/* Profile list */}
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                No businesses found
              </div>
            ) : (
              filtered.map((profile) => (
                <BusinessOption
                  key={profile.id}
                  profile={profile}
                  selected={selectedId === profile.id}
                  onSelect={select}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
