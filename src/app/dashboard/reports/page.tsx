import { BarChart3 } from "lucide-react";

export default function ReportsPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
        <BarChart3 size={48} className="text-gray-300 mx-auto mb-4" />
        <h2 className="text-lg font-medium text-gray-900 mb-2">
          No reports generated
        </h2>
        <p className="text-gray-500">
          Generate PDF performance reports once analytics data is available.
        </p>
      </div>
    </div>
  );
}
