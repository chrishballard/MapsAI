import { FileText } from "lucide-react";

export default function PostsPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Posts</h1>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
        <FileText size={48} className="text-gray-300 mx-auto mb-4" />
        <h2 className="text-lg font-medium text-gray-900 mb-2">
          No posts yet
        </h2>
        <p className="text-gray-500">
          Connect a profile first, then generate AI-powered posts.
        </p>
      </div>
    </div>
  );
}
