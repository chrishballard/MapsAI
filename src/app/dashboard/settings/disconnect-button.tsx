"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmsGoogleAccount } from "@/lib/google-account-confirm";

export function DisconnectButton({
  accountId,
  email,
}: {
  accountId: string;
  email: string;
}) {
  const [disconnecting, setDisconnecting] = useState(false);
  const router = useRouter();

  async function handleDisconnect() {
    // A typed confirmation, not an OK button: this deletes every profile
    // under the login. The route checks the typed email too.
    const typed = prompt(
      `Disconnecting ${email} permanently deletes every profile under it and all of their RankMaps history: posts, reviews and replies, metrics, reports and photos. Nothing changes on Google.\n\nType ${email} to confirm.`
    );
    if (typed === null) return;
    if (!confirmsGoogleAccount(typed, email)) {
      alert("That doesn't match the account's email. Nothing was disconnected.");
      return;
    }

    setDisconnecting(true);
    try {
      const res = await fetch(`/api/google-accounts/${accountId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail: typed }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.error || "Failed to disconnect account.");
      }
    } catch {
      alert("Request failed.");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <button
      onClick={handleDisconnect}
      disabled={disconnecting}
      className="px-3 py-1.5 text-sm font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors disabled:opacity-50"
    >
      {disconnecting ? "Disconnecting..." : "Disconnect"}
    </button>
  );
}
