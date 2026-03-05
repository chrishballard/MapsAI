"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

interface Profile {
  id: string;
  name: string;
}

interface GenerateFormProps {
  profiles: Profile[];
}

export function GenerateForm({ profiles }: GenerateFormProps) {
  const [profileId, setProfileId] = useState<string>("");
  const [month, setMonth] = useState<string>(
    new Date().toISOString().substring(0, 7) // YYYY-MM
  );
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const body: Record<string, string> = { month };
      if (profileId) body.profileId = profileId;

      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error("Failed to generate report");
      }

      const data = await res.json();
      const successCount = data.reports.filter(
        (r: { status: string }) => r.status === "success"
      ).length;

      setMessage(
        `Generated ${successCount} report${successCount !== 1 ? "s" : ""} successfully.`
      );

      // Reload page to show new reports
      window.location.reload();
    } catch {
      setMessage("Failed to generate report. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 mb-6">
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
        Generate Report
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label
            htmlFor="profile-select"
            className="block text-sm text-gray-600 mb-1"
          >
            Profile
          </label>
          <select
            id="profile-select"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Profiles</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[160px]">
          <label
            htmlFor="month-select"
            className="block text-sm text-gray-600 mb-1"
          >
            Month
          </label>
          <input
            id="month-select"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <button
          onClick={handleGenerate}
          disabled={loading || profiles.length === 0}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md font-medium text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading && <Loader2 size={16} className="mr-2 animate-spin" />}
          Generate Report
        </button>
      </div>

      {message && (
        <p className="mt-3 text-sm text-gray-600">{message}</p>
      )}
    </div>
  );
}

interface DownloadButtonProps {
  reportId: string;
}

export function DownloadButton({ reportId }: DownloadButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/${reportId}/download`);
      if (!res.ok) throw new Error("Download failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : "report.pdf";

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to download report. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      className="inline-flex items-center px-3 py-1.5 border border-blue-600 text-blue-600 rounded-md text-sm font-medium hover:bg-blue-50 transition-colors disabled:opacity-50"
    >
      {loading ? (
        <Loader2 size={14} className="mr-1.5 animate-spin" />
      ) : (
        <Download size={14} className="mr-1.5" />
      )}
      Download PDF
    </button>
  );
}
