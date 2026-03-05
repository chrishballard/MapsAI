import { Settings, Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { DisconnectButton } from "./disconnect-button";

export default async function SettingsPage() {
  const googleAccounts = await prisma.googleAccount.findMany({
    include: { _count: { select: { profiles: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      </div>

      <div className="space-y-6">
        {/* Connected Google Accounts */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-gray-900">
                Connected Google Accounts
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Manage your Google Business Profile connections.
              </p>
            </div>
            <a
              href="/api/auth/google"
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <Plus size={14} />
              Add Account
            </a>
          </div>

          {googleAccounts.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-500">
              No Google accounts connected yet.
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {googleAccounts.map((account) => (
                <div
                  key={account.id}
                  className="px-6 py-4 flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {account.googleEmail}
                    </p>
                    <p className="text-sm text-gray-500">
                      {account._count.profiles} profile
                      {account._count.profiles !== 1 ? "s" : ""} &middot;
                      Connected{" "}
                      {account.createdAt.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <DisconnectButton
                    accountId={account.id}
                    email={account.googleEmail}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
