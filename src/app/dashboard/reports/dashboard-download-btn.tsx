"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

interface DashboardDownloadBtnProps {
  profileId: string | null;
  from: string;
  to: string;
  narrativeText: string | null;
}

export function DashboardDownloadBtn({
  profileId,
  from,
  to,
  narrativeText,
}: DashboardDownloadBtnProps) {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/reports/dashboard-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, from, to, narrativeText }),
      });

      if (!res.ok) throw new Error("Download failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `dashboard-report-${from}-to-${to}.pdf`;

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to download PDF. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      className="inline-flex items-center px-4 py-2 border border-violet-300 text-violet-700 bg-violet-50 rounded-lg text-sm font-medium hover:bg-violet-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {loading ? (
        <Loader2 size={14} className="mr-2 animate-spin" />
      ) : (
        <Download size={14} className="mr-2" />
      )}
      Download PDF
    </button>
  );
}
