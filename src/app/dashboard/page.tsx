import { Building2, FileText, MessageSquare, BarChart3 } from "lucide-react";
import { prisma } from "@/lib/prisma";

export default async function DashboardPage() {
  const totalProfiles = await prisma.profile.count();
  const connectedProfiles = await prisma.profile.count({
    where: { isConnected: true },
  });

  const stats = [
    { label: "Total Profiles", value: totalProfiles.toString(), icon: Building2 },
    { label: "Posts This Month", value: "0", icon: FileText },
    { label: "Pending Reviews", value: "0", icon: MessageSquare },
    { label: "Reports Generated", value: "0", icon: BarChart3 },
  ];

  const hasProfiles = totalProfiles > 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="bg-white rounded-lg shadow-sm border border-gray-200 p-5"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-md">
                  <Icon size={20} className="text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">{stat.label}</p>
                  <p className="text-2xl font-semibold text-gray-900">
                    {stat.value}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
        <Building2 size={48} className="text-gray-300 mx-auto mb-4" />
        <h2 className="text-lg font-medium text-gray-900 mb-2">
          {hasProfiles ? "Connect More Profiles" : "Get Started with MapsAI"}
        </h2>
        <p className="text-gray-500 mb-4">
          {hasProfiles
            ? `You have ${connectedProfiles} connected profile${connectedProfiles !== 1 ? "s" : ""}. Add more Google accounts to manage additional business profiles.`
            : "Connect your Google Business Profiles to start managing posts, reviews, and analytics."}
        </p>
        <a
          href={hasProfiles ? "/api/auth/google" : "/dashboard/profiles"}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors"
        >
          {hasProfiles ? "Connect Another Account" : "Connect Your First Profile"}
        </a>
      </div>
    </div>
  );
}
