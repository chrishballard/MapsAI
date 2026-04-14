import { prisma } from "@/lib/prisma";
import { getSelectedProfileId } from "@/lib/selected-profile";
import { TasksTable, type TaskItem } from "./tasks-table";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

function formatDueDate(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const taskDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
  const diffDays = Math.floor(
    (taskDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function buildTaskItems(
  draftPosts: Array<{ id: string; createdAt: Date; content: string; type: string; callToAction: string | null; profile: { name: string } }>,
  draftedReviews: Array<{ id: string; createdAt: Date; reviewerName: string | null; rating: number; comment: string | null; profile: { name: string }; response: { content: string } | null }>,
): TaskItem[] {
  const postTasks: TaskItem[] = draftPosts.map((post) => ({
    id: post.id,
    type: "approve_post" as const,
    profileName: post.profile.name,
    dueDate: formatDueDate(post.createdAt),
    postContent: post.content,
    postType: post.type,
    callToAction: post.callToAction || undefined,
  }));

  const reviewTasks: TaskItem[] = draftedReviews
    .filter((r) => r.response !== null)
    .map((review) => ({
      id: review.id,
      type: "approve_review_reply" as const,
      profileName: review.profile.name,
      dueDate: formatDueDate(review.createdAt),
      reviewerName: review.reviewerName || undefined,
      rating: review.rating,
      comment: review.comment || undefined,
      responseContent: review.response!.content,
    }));

  return [...postTasks, ...reviewTasks];
}

export async function TasksSection() {
  const selectedProfileId = await getSelectedProfileId();
  const profileFilter = selectedProfileId ? { profileId: selectedProfileId } : {};

  const [draftPosts, draftedResponses] = await Promise.all([
    prisma.post.findMany({
      where: { ...profileFilter, status: "DRAFT" },
      orderBy: { createdAt: "desc" },
      include: { profile: { select: { name: true } } },
    }),
    prisma.review.findMany({
      where: {
        ...profileFilter,
        response: { status: "DRAFTED" },
      },
      orderBy: { createdAt: "desc" },
      include: {
        profile: { select: { name: true } },
        response: true,
      },
    }),
  ]);

  const tasks = buildTaskItems(draftPosts, draftedResponses);

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">My Tasks</h2>
      <TasksTable tasks={tasks} />
    </div>
  );
}

export function TasksSectionSkeleton() {
  return (
    <div>
      <Skeleton className="h-6 w-24 mb-4" />
      <Card>
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-none border-b last:border-b-0" />
        ))}
      </Card>
    </div>
  );
}
