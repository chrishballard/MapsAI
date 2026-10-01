"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function ResyncButton() {
  const [syncing, setSyncing] = useState(false);
  const router = useRouter();

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/profiles/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        const failed: string[] = data.failedAccounts ?? [];
        const reauth: string[] = data.needsReauth ?? [];
        const problems = [
          failed.length > 0 && `Sync failed for ${failed.join(", ")}.`,
          reauth.length > 0 &&
            `Skipped ${reauth.join(", ")}: Google access expired, reconnect with "Connect another Google account".`,
        ].filter(Boolean);
        alert(
          problems.length > 0
            ? `Synced ${data.count} profiles.\n\n${problems.join("\n")}`
            : `Synced ${data.count} profiles successfully.`
        );
        router.refresh();
      } else {
        alert(`Sync failed: ${data.error}`);
      }
    } catch {
      alert("Sync request failed.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <button
      onClick={handleSync}
      disabled={syncing}
      className="inline-flex items-center gap-2 px-4 py-2 border border-border text-foreground rounded-lg font-medium hover:bg-muted/50 transition-colors disabled:opacity-50"
    >
      <RefreshCw size={16} className={syncing ? "animate-spin" : ""} />
      {syncing ? "Syncing..." : "Resync Profiles"}
    </button>
  );
}
