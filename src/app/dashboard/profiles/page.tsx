import { Building2, RefreshCw, Plus } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ResyncButton } from "./resync-button";

export default async function ProfilesPage() {
  const profiles = await prisma.profile.findMany({
    include: { googleAccount: { select: { googleEmail: true } } },
    orderBy: { name: "asc" },
  });

  const connectedCount = profiles.filter((p) => p.isConnected).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Profiles</h1>
          <p className="text-sm text-gray-500 mt-1">
            {profiles.length} profile{profiles.length !== 1 ? "s" : ""} total,{" "}
            {connectedCount} connected
          </p>
        </div>
        <div className="flex items-center gap-3">
          {profiles.length > 0 && <ResyncButton />}
          <a
            href="/api/auth/google"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            Connect Google Account
          </a>
        </div>
      </div>

      {profiles.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <Building2 size={48} className="text-gray-300 mx-auto mb-4" />
          <h2 className="text-lg font-medium text-gray-900 mb-2">
            No profiles connected
          </h2>
          <p className="text-gray-500 mb-4">
            Connect a Google account to import your business profiles.
          </p>
          <a
            href="/api/auth/google"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            Connect Google Account
          </a>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                  Name
                </th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                  Address
                </th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                  Category
                </th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                  Google Account
                </th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {profiles.map((profile) => (
                <tr key={profile.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    <Link
                      href={`/dashboard/profiles/${profile.id}`}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {profile.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {profile.address || "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {profile.category || "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {profile.googleAccount.googleEmail}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        profile.isConnected
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {profile.isConnected ? "Connected" : "Disconnected"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
