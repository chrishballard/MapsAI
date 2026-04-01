"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  X,
  Building2,
  MapPin,
  Search,
  Loader2,
  ArrowRight,
} from "lucide-react";

interface AvailableProfile {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  googleAccount: { googleEmail: string };
}

export function AddBusinessButton({
  availableCount,
  variant = "default",
}: {
  availableCount: number;
  variant?: "default" | "primary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<AvailableProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (open) {
      setLoading(true);
      fetch("/api/profiles/available")
        .then((r) => r.json())
        .then((data) => setProfiles(data.profiles || []))
        .finally(() => setLoading(false));
    }
  }, [open]);

  const filtered = profiles.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.address && p.address.toLowerCase().includes(search.toLowerCase()))
  );

  // Group by Google account email
  const grouped = filtered.reduce(
    (acc, profile) => {
      const email = profile.googleAccount.googleEmail;
      if (!acc[email]) acc[email] = [];
      acc[email].push(profile);
      return acc;
    },
    {} as Record<string, AvailableProfile[]>
  );

  if (availableCount === 0 && variant === "default") {
    return (
      <a
        href="/api/auth/google"
        className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
      >
        <Plus className="w-4 h-4" />
        Connect Account
      </a>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={
          variant === "primary"
            ? "inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
            : "inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
        }
      >
        <Plus className="w-4 h-4" />
        Add a business
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => {
              setOpen(false);
              setSearch("");
            }}
          />

          {/* Modal */}
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[70vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
              <div>
                <h2 className="text-lg font-bold text-zinc-900">
                  Add a business
                </h2>
                <p className="text-sm text-zinc-500">
                  Select a profile to onboard to MapsAI
                </p>
              </div>
              <button
                onClick={() => {
                  setOpen(false);
                  setSearch("");
                }}
                className="p-2 text-zinc-400 hover:text-zinc-600 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Search */}
            <div className="px-6 py-3 border-b border-zinc-100">
              <div className="relative">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
                />
                <input
                  type="text"
                  placeholder="Search profiles..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                  className="w-full pl-10 pr-4 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-300"
                />
              </div>
            </div>

            {/* Profile list */}
            <div className="flex-1 overflow-y-auto px-6 py-3">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2
                    size={24}
                    className="text-zinc-300 animate-spin"
                  />
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12">
                  <Building2
                    size={32}
                    className="text-zinc-300 mx-auto mb-3"
                  />
                  <p className="text-sm text-zinc-500">
                    {search
                      ? "No matching profiles found"
                      : "All profiles have been onboarded"}
                  </p>
                </div>
              ) : (
                Object.entries(grouped).map(([email, emailProfiles]) => (
                  <div key={email} className="mb-4">
                    <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">
                      {email}
                    </p>
                    <div className="space-y-2">
                      {emailProfiles.map((profile) => (
                        <button
                          key={profile.id}
                          onClick={() => {
                            setOpen(false);
                            setSearch("");
                            router.push(
                              `/dashboard/onboarding/${profile.id}`
                            );
                          }}
                          className="w-full flex items-center gap-3 p-3 rounded-lg border border-zinc-200 hover:border-brand-300 hover:bg-brand-50/50 transition-colors text-left group"
                        >
                          <div className="w-10 h-10 bg-zinc-100 rounded-lg flex items-center justify-center text-zinc-500 group-hover:bg-brand-100 group-hover:text-brand-600 transition-colors shrink-0">
                            <Building2 size={20} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-zinc-900 truncate">
                              {profile.name}
                            </p>
                            <div className="flex items-center gap-3 mt-0.5">
                              {profile.address && (
                                <span className="text-xs text-zinc-500 flex items-center gap-1 truncate">
                                  <MapPin size={10} className="shrink-0" />
                                  {profile.address}
                                </span>
                              )}
                              {profile.category && (
                                <span className="text-xs text-brand-600 font-medium shrink-0">
                                  {profile.category}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs font-medium text-brand-600 group-hover:text-brand-700">
                              Onboard
                            </span>
                            <ArrowRight
                              size={14}
                              className="text-brand-600 group-hover:text-brand-700"
                            />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-zinc-200 bg-zinc-50">
              <a
                href="/api/auth/google"
                className="text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors"
              >
                + Connect another Google account
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
