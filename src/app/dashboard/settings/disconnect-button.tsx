"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
    if (
      !confirm(
        `Disconnect ${email}? This will remove all associated profiles and their data.`
      )
    ) {
      return;
    }

    setDisconnecting(true);
    try {
      const res = await fetch(`/api/google-accounts/${accountId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.refresh();
      } else {
        alert("Failed to disconnect account.");
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
