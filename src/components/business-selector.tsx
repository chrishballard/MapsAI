"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Search, Building2, Check } from "lucide-react";

interface Profile {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
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
      .then((r) => r.json())
      .then((data) => setProfiles(data.profiles || []));

    // Read initial selection from cookie
    const match = document.cookie.match(/(?:^|; )selectedProfileId=([^;]*)/);
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
        className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-300 rounded-lg hover:border-gray-400 transition-colors min-w-[220px]"
      >
        <Building2 size={16} className="text-gray-400 shrink-0" />
        <span className="text-sm font-medium text-gray-700 truncate">
          {selectedProfile ? selectedProfile.name : "All Businesses"}
        </span>
        <ChevronDown size={14} className="text-gray-400 ml-auto shrink-0" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* All Businesses option */}
          <button
            onClick={() => select(null)}
            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-100"
          >
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
              <Building2 size={14} className="text-blue-600" />
            </div>
            <span className="text-sm font-medium text-gray-700">All Businesses</span>
            {!selectedId && (
              <Check size={16} className="text-blue-600 ml-auto" />
            )}
          </button>

          {/* Profile list */}
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-gray-500 text-center">
                No businesses found
              </div>
            ) : (
              filtered.map((profile) => (
                <button
                  key={profile.id}
                  onClick={() => select(profile.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors"
                >
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center shrink-0">
                    <Building2 size={14} className="text-gray-500" />
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {profile.name}
                    </p>
                    {profile.address && (
                      <p className="text-xs text-gray-500 truncate">
                        {profile.address}
                      </p>
                    )}
                  </div>
                  {selectedId === profile.id && (
                    <Check size={16} className="text-blue-600 shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
