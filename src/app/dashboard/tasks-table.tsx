"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Check, Trash2, Star, Building2 } from "lucide-react";

export interface TaskItem {
  id: string;
  type: "approve_post" | "approve_review_reply";
  profileName: string;
  dueDate: string;
  // Post fields
  postContent?: string;
  postType?: string;
  callToAction?: string;
  // Review fields
  reviewerName?: string;
  rating?: number;
  comment?: string;
  responseContent?: string;
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={14}
          className={
            star <= rating
              ? "fill-yellow-400 text-yellow-400"
              : "text-gray-300"
          }
        />
      ))}
    </div>
  );
}

function taskLabel(type: TaskItem["type"]): string {
  switch (type) {
    case "approve_post":
      return "Approve Post";
    case "approve_review_reply":
      return "Approve Review Reply";
  }
}

export function TasksTable({ tasks }: { tasks: TaskItem[] }) {
  const router = useRouter();
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleApprove(task: TaskItem) {
    setLoading(true);
    try {
      let res: Response;
      if (task.type === "approve_post") {
        res = await fetch(`/api/posts/${task.id}/approve`, { method: "POST" });
      } else {
        // For review responses, the API uses the review ID
        res = await fetch(`/api/reviews/${task.id}/approve`, { method: "POST" });
      }
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to approve");
        return;
      }
      setSelectedTask(null);
      router.refresh();
    } catch {
      alert("Failed to approve");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(task: TaskItem) {
    if (task.type === "approve_post") {
      if (!confirm("Delete this draft post?")) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/posts/${task.id}`, { method: "DELETE" });
        if (!res.ok) {
          alert("Failed to delete post");
          return;
        }
        setSelectedTask(null);
        router.refresh();
      } catch {
        alert("Failed to delete");
      } finally {
        setLoading(false);
      }
    }
  }

  if (tasks.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
        <Check size={48} className="text-green-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-1">All caught up!</h3>
        <p className="text-sm text-gray-500">No pending tasks across your businesses.</p>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                Due Date
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                Business
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                Task
              </th>
              <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task, i) => (
              <tr
                key={`${task.type}-${task.id}`}
                className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                  i % 2 === 1 ? "bg-blue-50/30" : ""
                }`}
              >
                <td className="px-5 py-3.5 text-sm text-gray-600">
                  {task.dueDate}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center shrink-0">
                      <Building2 size={14} className="text-gray-500" />
                    </div>
                    <span className="text-sm font-medium text-gray-900">
                      {task.profileName}
                    </span>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-sm text-gray-700">
                  {taskLabel(task.type)}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <button
                    onClick={() => setSelectedTask(task)}
                    className="inline-flex items-center px-4 py-1.5 text-sm font-medium text-blue-600 border border-blue-300 rounded-full hover:bg-blue-50 transition-colors"
                  >
                    Review
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Review Modal */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !loading && setSelectedTask(null)}
          />
          <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-xl">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {selectedTask.type === "approve_post"
                    ? `Approve post for ${selectedTask.profileName}`
                    : `Approve review reply for ${selectedTask.profileName}`}
                </h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {selectedTask.dueDate}
                </p>
              </div>
              <button
                onClick={() => !loading && setSelectedTask(null)}
                className="p-1 hover:bg-gray-100 rounded-md transition-colors"
              >
                <X size={18} className="text-gray-400" />
              </button>
            </div>

            <div className="px-6 py-5">
              {selectedTask.type === "approve_post" ? (
                <div>
                  {selectedTask.postType && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 mb-3">
                      {selectedTask.postType.replace("_", " ")}
                    </span>
                  )}
                  <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                    {selectedTask.postContent}
                  </p>
                  {selectedTask.callToAction && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <p className="text-xs text-gray-500">Call to Action</p>
                      <p className="text-sm font-medium text-gray-700 mt-0.5">
                        {selectedTask.callToAction}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  {/* Original review */}
                  <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-center gap-2 mb-2">
                      {selectedTask.rating && (
                        <StarRating rating={selectedTask.rating} />
                      )}
                      <span className="text-sm font-medium text-gray-700">
                        {selectedTask.reviewerName || "Anonymous"}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">
                      {selectedTask.comment || (
                        <span className="italic text-gray-400">
                          Rating only - no comment
                        </span>
                      )}
                    </p>
                  </div>
                  {/* AI response */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1.5">
                      AI-Generated Reply
                    </p>
                    <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                      {selectedTask.responseContent}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Action bar */}
            <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex items-center gap-3 rounded-b-xl">
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex-1">
                <p className="text-sm text-blue-800">
                  Please approve this ASAP so I can publish it to your profile.
                </p>
              </div>
            </div>
            <div className="px-6 pb-5 flex items-center gap-3">
              {selectedTask.type === "approve_post" && (
                <button
                  onClick={() => handleDelete(selectedTask)}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-red-600 border border-red-300 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              )}
              <button
                onClick={() => handleApprove(selectedTask)}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                <Check size={14} />
                {loading ? "Approving..." : "Approve"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
