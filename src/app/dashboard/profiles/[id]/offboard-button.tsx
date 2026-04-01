"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Loader2 } from "lucide-react";

export function OffboardButton({ profileId }: { profileId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleOffboard() {
    setLoading(true);
    try {
      const res = await fetch("/api/profiles/offboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      if (res.ok) {
        router.push("/dashboard/profiles");
        router.refresh();
      }
    } finally {
      setLoading(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-500">Remove from MapsAI?</span>
        <button
          onClick={handleOffboard}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            "Yes, offboard"
          )}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-zinc-200 text-zinc-500 rounded-lg text-sm font-medium hover:border-red-300 hover:text-red-600 transition-colors"
    >
      <LogOut size={14} />
      Offboard
    </button>
  );
}
