import type { TaskItem } from "./tasks-table";

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
  incompleteProfiles: Array<{ id: string; name: string; createdAt: Date }>
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

  const onboardingTasks: TaskItem[] = incompleteProfiles.map((profile) => ({
    id: profile.id,
    type: "start_onboarding" as const,
    profileName: profile.name,
    dueDate: formatDueDate(profile.createdAt),
  }));

  return [...postTasks, ...reviewTasks, ...onboardingTasks];
}
