"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2, Star, Building2 } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export interface TaskItem {
  id: string;
  type: "approve_post" | "approve_review_reply" | "start_onboarding";
  profileName: string;
  dueDate: string;
  postContent?: string;
  postType?: string;
  callToAction?: string;
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
              ? "fill-amber-400 text-amber-400"
              : "text-zinc-200"
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
    case "start_onboarding":
      return "Start Onboarding";
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
      <Card>
        <CardContent className="flex flex-col items-center py-10">
          <div className="rounded-full bg-emerald-50 p-3 mb-3">
            <Check size={24} className="text-emerald-500" />
          </div>
          <h3 className="text-lg font-semibold mb-1">All caught up!</h3>
          <p className="text-sm text-muted-foreground">No pending tasks across your businesses.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Due Date</TableHead>
              <TableHead>Business</TableHead>
              <TableHead>Task</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TableRow key={`${task.type}-${task.id}`}>
                <TableCell className="text-muted-foreground">
                  {task.dueDate}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center shrink-0">
                      <Building2 size={14} className="text-muted-foreground" />
                    </div>
                    <span className="font-medium">{task.profileName}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{taskLabel(task.type)}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  {task.type === "start_onboarding" ? (
                    <Link
                      href={`/dashboard/onboarding/${task.id}`}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      Start
                    </Link>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedTask(task)}
                    >
                      Review
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Review Dialog */}
      <Dialog open={!!selectedTask} onOpenChange={(open) => !loading && !open && setSelectedTask(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedTask?.type === "approve_post"
                ? `Approve post for ${selectedTask?.profileName}`
                : `Approve review reply for ${selectedTask?.profileName}`}
            </DialogTitle>
            <DialogDescription>{selectedTask?.dueDate}</DialogDescription>
          </DialogHeader>

          {selectedTask?.type === "approve_post" ? (
            <div className="space-y-3">
              {selectedTask.postType && (
                <Badge variant="secondary">
                  {selectedTask.postType.replace("_", " ")}
                </Badge>
              )}
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {selectedTask.postContent}
              </p>
              {selectedTask.callToAction && (
                <div className="pt-3 border-t">
                  <p className="text-xs text-muted-foreground">Call to Action</p>
                  <p className="text-sm font-medium mt-0.5">
                    {selectedTask.callToAction}
                  </p>
                </div>
              )}
            </div>
          ) : selectedTask ? (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  {selectedTask.rating && (
                    <StarRating rating={selectedTask.rating} />
                  )}
                  <span className="text-sm font-medium">
                    {selectedTask.reviewerName || "Anonymous"}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {selectedTask.comment || (
                    <span className="italic">Rating only - no comment</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">
                  AI-Generated Reply
                </p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {selectedTask.responseContent}
                </p>
              </div>
            </div>
          ) : null}

          <DialogFooter className="gap-2 sm:gap-0">
            {selectedTask?.type === "approve_post" && (
              <Button
                variant="destructive"
                onClick={() => selectedTask && handleDelete(selectedTask)}
                disabled={loading}
              >
                <Trash2 size={14} className="mr-1.5" />
                Delete
              </Button>
            )}
            <Button
              onClick={() => selectedTask && handleApprove(selectedTask)}
              disabled={loading}
            >
              <Check size={14} className="mr-1.5" />
              {loading ? "Approving..." : "Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
