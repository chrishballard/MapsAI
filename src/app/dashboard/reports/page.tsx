import { BarChart3 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { GenerateForm, DownloadButton } from "./report-actions";
import { getSelectedProfileId } from "@/lib/selected-profile";

export default async function ReportsPage() {
  const selectedProfileId = await getSelectedProfileId();
  const profileFilter = selectedProfileId ? { profileId: selectedProfileId } : {};

  // Fetch reports with profile info
  const reports = await prisma.report.findMany({
    where: profileFilter,
    include: { profile: true },
    orderBy: { createdAt: "desc" },
  });

  // Fetch connected profiles for the generate form
  const profiles = await prisma.profile.findMany({
    where: {
      isConnected: true,
      ...(selectedProfileId ? { id: selectedProfileId } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Reports{" "}
          {reports.length > 0 && (
            <span className="text-lg font-normal text-gray-500">
              ({reports.length})
            </span>
          )}
        </h1>
      </div>

      {/* Generate Form */}
      {profiles.length > 0 && <GenerateForm profiles={profiles} />}

      {/* Reports List */}
      {reports.length > 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                  Profile
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                  Month
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                  Generated
                </th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {reports.map((report) => (
                <tr key={report.id} className="hover:bg-gray-50">
                  <td className="px-5 py-4">
                    <span className="text-sm font-medium text-gray-900">
                      {report.profile.name}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm text-gray-600">
                      {report.month.toLocaleDateString("en-US", {
                        month: "long",
                        year: "numeric",
                      })}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm text-gray-500">
                      {report.createdAt.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <DownloadButton reportId={report.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <BarChart3 size={48} className="text-gray-300 mx-auto mb-4" />
          <h2 className="text-lg font-medium text-gray-900 mb-2">
            No reports generated
          </h2>
          <p className="text-gray-500 mb-4">
            {profiles.length > 0
              ? "Use the form above to generate PDF performance reports for your profiles."
              : "Connect a Google Business Profile first, then generate performance reports."}
          </p>
        </div>
      )}
    </div>
  );
}
