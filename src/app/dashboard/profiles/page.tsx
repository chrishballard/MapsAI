import { Building2 } from "lucide-react";

export default function ProfilesPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Profiles</h1>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
        <Building2 size={48} className="text-gray-300 mx-auto mb-4" />
        <h2 className="text-lg font-medium text-gray-900 mb-2">
          No profiles connected
        </h2>
        <p className="text-gray-500">
          Connect a Google account to import your business profiles.
        </p>
      </div>
    </div>
  );
}
