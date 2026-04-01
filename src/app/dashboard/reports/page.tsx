import { BarChart3 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { GenerateForm, DownloadButton } from "./report-actions";
import { getSelectedProfileId } from "@/lib/selected-profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MotionDiv } from "@/components/motion-wrapper";

export default async function ReportsPage() {
  const selectedProfileId = await getSelectedProfileId();
  const profileFilter = selectedProfileId
    ? { profileId: selectedProfileId }
    : {};

  const reports = await prisma.report.findMany({
    where: profileFilter,
    include: { profile: true },
    orderBy: { createdAt: "desc" },
  });

  const profiles = await prisma.profile.findMany({
    where: {
      isConnected: true,
      isOnboarded: true,
      ...(selectedProfileId ? { id: selectedProfileId } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <MotionDiv
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-8"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 tracking-tight">
            Reports
          </h1>
          <p className="text-zinc-500 mt-1">
            Generate and download performance reports for your profiles.
          </p>
        </div>
      </div>

      {profiles.length > 0 && <GenerateForm profiles={profiles} />}

      {reports.length > 0 ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Generated Reports</CardTitle>
            <span className="text-sm text-zinc-500">
              {reports.length} report{reports.length !== 1 ? "s" : ""}
            </span>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {reports.map((report, i) => (
                <MotionDiv
                  key={report.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center justify-between p-4 rounded-xl border border-zinc-100 hover:bg-zinc-50 transition-colors group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-brand-50 text-brand-600">
                      <BarChart3 size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-zinc-900">
                        {report.profile.name}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-zinc-500">
                          {report.month.toLocaleDateString("en-US", {
                            month: "long",
                            year: "numeric",
                          })}
                        </span>
                        <span className="text-xs text-zinc-400">
                          &middot; Generated{" "}
                          {report.createdAt.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                  <DownloadButton reportId={report.id} />
                </MotionDiv>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="flex flex-col items-center text-center py-16">
          <div className="w-16 h-16 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-400 mb-4">
            <BarChart3 size={32} />
          </div>
          <h2 className="text-lg font-semibold text-zinc-900 mb-2">
            No reports generated
          </h2>
          <p className="text-zinc-500 mb-4 max-w-md">
            {profiles.length > 0
              ? "Use the form above to generate PDF performance reports for your profiles."
              : "Connect a Google Business Profile first, then generate performance reports."}
          </p>
        </Card>
      )}
    </MotionDiv>
  );
}
