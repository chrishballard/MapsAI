import { Building2, FileText, MessageSquare, BarChart3, CheckCircle2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { getSelectedProfileId } from "@/lib/selected-profile";
import { TasksTable, type TaskItem } from "./tasks-table";

function timeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
}

function formatDueDate(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const taskDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor(
    (taskDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function DashboardPage() {
  const selectedProfileId = await getSelectedProfileId();
  const profileFilter = selectedProfileId ? { profileId: selectedProfileId } : {};

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalProfiles,
    connectedProfiles,
    postsThisMonth,
    pendingReviews,
    reportsGenerated,
  ] = await Promise.all([
    selectedProfileId ? 1 : prisma.profile.count(),
    selectedProfileId
      ? prisma.profile.count({ where: { id: selectedProfileId, isConnected: true } })
      : prisma.profile.count({ where: { isConnected: true } }),
    prisma.post.count({ where: { ...profileFilter, createdAt: { gte: startOfMonth } } }),
    prisma.reviewResponse.count({
      where: {
        status: "DRAFTED",
        ...(selectedProfileId ? { review: { profileId: selectedProfileId } } : {}),
      },
    }),
    prisma.report.count({ where: profileFilter }),
  ]);

  // Recent automations: published posts + published review responses
  const [recentPublishedPosts, recentPublishedResponses] = await Promise.all([
    prisma.post.findMany({
      where: {
        ...profileFilter,
        status: { in: ["PUBLISHED", "APPROVED", "SCHEDULED"] },
      },
      take: 5,
      orderBy: { updatedAt: "desc" },
      include: { profile: { select: { name: true } } },
    }),
    prisma.reviewResponse.findMany({
      where: {
        status: { in: ["PUBLISHED", "APPROVED"] },
        ...(selectedProfileId ? { review: { profileId: selectedProfileId } } : {}),
      },
      take: 5,
      orderBy: { updatedAt: "desc" },
      include: {
        review: {
          select: {
            profileId: true,
            profile: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  // Build recent automations list
  type AutomationItem = {
    id: string;
    label: string;
    profileName: string;
    time: Date;
    type: "post" | "review_reply";
  };

  const automations: AutomationItem[] = [
    ...recentPublishedPosts.map((p) => ({
      id: p.id,
      label:
        p.status === "PUBLISHED"
          ? "Published post"
          : p.status === "SCHEDULED"
          ? "Scheduled post"
          : "Approved post",
      profileName: p.profile.name,
      time: p.updatedAt,
      type: "post" as const,
    })),
    ...recentPublishedResponses.map((r) => ({
      id: r.id,
      label:
        r.status === "PUBLISHED"
          ? "Published review reply"
          : "Approved review reply",
      profileName: r.review.profile.name,
      time: r.updatedAt,
      type: "review_reply" as const,
    })),
  ]
    .sort((a, b) => b.time.getTime() - a.time.getTime())
    .slice(0, 10);

  // My Tasks: draft posts + drafted review responses
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

  const tasks: TaskItem[] = [
    ...draftPosts.map((post) => ({
      id: post.id,
      type: "approve_post" as const,
      profileName: post.profile.name,
      dueDate: formatDueDate(post.createdAt),
      postContent: post.content,
      postType: post.type,
      callToAction: post.callToAction || undefined,
    })),
    ...draftedResponses
      .filter((r) => r.response)
      .map((review) => ({
        id: review.id,
        type: "approve_review_reply" as const,
        profileName: review.profile.name,
        dueDate: formatDueDate(review.createdAt),
        reviewerName: review.reviewerName || undefined,
        rating: review.rating,
        comment: review.comment || undefined,
        responseContent: review.response!.content,
      })),
  ];

  const selectedProfile = selectedProfileId
    ? await prisma.profile.findUnique({
        where: { id: selectedProfileId },
        select: { name: true },
      })
    : null;

  const stats = [
    {
      label: selectedProfileId ? "Profile" : "Total Profiles",
      value: selectedProfileId ? "1" : totalProfiles.toString(),
      icon: Building2,
    },
    { label: "Posts This Month", value: postsThisMonth.toString(), icon: FileText },
    { label: "Pending Reviews", value: pendingReviews.toString(), icon: MessageSquare },
    { label: "Reports Generated", value: reportsGenerated.toString(), icon: BarChart3 },
  ];

  const hasProfiles = totalProfiles > 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {selectedProfile ? selectedProfile.name : "Dashboard"}
      </h1>

      {/* Stats */}
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

      {/* Recent Automations */}
      {automations.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Recent Automations
          </h2>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100">
              {automations.map((item) => (
                <div
                  key={`${item.type}-${item.id}`}
                  className="flex items-center gap-3 px-5 py-3.5"
                >
                  <CheckCircle2 size={20} className="text-green-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900 truncate">
                      {item.label} for{" "}
                      <span className="font-medium">{item.profileName}</span>
                    </p>
                    {item.type === "review_reply" && (
                      <Link
                        href="/dashboard/reviews"
                        className="text-xs text-blue-600 hover:underline"
                      >
                        See details
                      </Link>
                    )}
                    {item.type === "post" && (
                      <Link
                        href="/dashboard/posts"
                        className="text-xs text-blue-600 hover:underline"
                      >
                        See details
                      </Link>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 shrink-0 whitespace-nowrap">
                    {timeAgo(item.time)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* My Tasks */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">My Tasks</h2>
        <TasksTable tasks={tasks} />
      </div>

      {/* Get Started / Connect More */}
      {!selectedProfileId && (
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
      )}
    </div>
  );
}
