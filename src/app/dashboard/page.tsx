import {
  Building2,
  FileText,
  MessageSquare,
  BarChart3,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Sparkles,
  Plus,
  MoreHorizontal,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { getSelectedProfileId } from "@/lib/selected-profile";
import { TasksTable, type TaskItem } from "./tasks-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { MotionDiv } from "@/components/motion-wrapper";

function timeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24)
    return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

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

export default async function DashboardPage() {
  const selectedProfileId = await getSelectedProfileId();
  const profileFilter = selectedProfileId
    ? { profileId: selectedProfileId }
    : {};

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
      ? prisma.profile.count({
          where: { id: selectedProfileId, isConnected: true },
        })
      : prisma.profile.count({ where: { isConnected: true } }),
    prisma.post.count({
      where: { ...profileFilter, createdAt: { gte: startOfMonth } },
    }),
    prisma.reviewResponse.count({
      where: {
        status: "DRAFTED",
        ...(selectedProfileId
          ? { review: { profileId: selectedProfileId } }
          : {}),
      },
    }),
    prisma.report.count({ where: profileFilter }),
  ]);

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
        ...(selectedProfileId
          ? { review: { profileId: selectedProfileId } }
          : {}),
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
    {
      label: "Posts This Month",
      value: postsThisMonth.toString(),
      icon: FileText,
    },
    {
      label: "Pending Reviews",
      value: pendingReviews.toString(),
      icon: MessageSquare,
    },
    {
      label: "Reports Generated",
      value: reportsGenerated.toString(),
      icon: BarChart3,
    },
  ];

  const hasProfiles = totalProfiles > 0;

  return (
    <MotionDiv
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 tracking-tight">
            {selectedProfile ? selectedProfile.name : "Dashboard"}
          </h1>
          <p className="text-zinc-500 mt-1">
            Welcome back, here&apos;s what&apos;s happening today.
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/dashboard/profiles"
            className={buttonVariants({ variant: "outline" })}
          >
            Export Data
          </Link>
          <Link
            href="/dashboard/profiles"
            className={buttonVariants({ className: "gap-2" })}
          >
            <Plus className="w-4 h-4" />
            New Profile
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <MotionDiv
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <Card className="relative overflow-hidden group hover:border-brand-300 transition-colors">
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Icon size={48} className="text-brand-600" />
                </div>
                <CardHeader className="mb-2">
                  <p className="text-sm font-medium text-zinc-500">
                    {stat.label}
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end justify-between">
                    <h3 className="text-3xl font-bold text-zinc-900">
                      {stat.value}
                    </h3>
                    {parseInt(stat.value) > 0 && (
                      <div className="flex items-center gap-0.5 text-xs font-bold px-2 py-1 rounded-full bg-emerald-50 text-emerald-600">
                        <ArrowUpRight size={12} />
                        Active
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </MotionDiv>
          );
        })}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Tasks / Automations */}
        <div className="lg:col-span-2 space-y-6">
          {automations.length > 0 && (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Recent Activity</CardTitle>
                <Link
                  href="/dashboard/posts"
                  className="text-sm font-bold text-brand-600 hover:text-brand-700"
                >
                  View All
                </Link>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {automations.slice(0, 5).map((item) => (
                    <div
                      key={`${item.type}-${item.id}`}
                      className="flex items-center justify-between p-4 rounded-xl border border-zinc-100 hover:bg-zinc-50 transition-colors group"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-emerald-50 text-emerald-600">
                          <CheckCircle2 size={20} />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-zinc-900">
                            {item.label} for{" "}
                            <span className="text-brand-600">{item.profileName}</span>
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge
                              variant="outline"
                              className="text-[10px] uppercase tracking-wider"
                            >
                              {item.type === "post" ? "Post" : "Review"}
                            </Badge>
                            <span className="text-xs text-zinc-400">
                              {timeAgo(item.time)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <Link
                        href={
                          item.type === "post"
                            ? "/dashboard/posts"
                            : "/dashboard/reviews"
                        }
                        className={buttonVariants({
                          variant: "ghost",
                          size: "icon",
                          className:
                            "opacity-0 group-hover:opacity-100 transition-opacity",
                        })}
                      >
                        <MoreHorizontal size={18} />
                      </Link>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div>
            <h2 className="text-lg font-semibold mb-4">My Tasks</h2>
            <TasksTable tasks={tasks} />
          </div>
        </div>

        {/* AI Insights */}
        <Card className="bg-brand-900 text-white border-none h-fit">
          <CardHeader>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-brand-400" />
              <CardTitle className="text-white">AI Insights</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="p-4 bg-white/10 rounded-xl border border-white/10">
              <p className="text-sm font-medium leading-relaxed">
                You have{" "}
                <span className="text-brand-400 font-bold">
                  {pendingReviews} pending review
                  {pendingReviews !== 1 ? "s" : ""}
                </span>{" "}
                awaiting your approval.
              </p>
            </div>
            <div className="p-4 bg-white/10 rounded-xl border border-white/10">
              <p className="text-sm font-medium leading-relaxed">
                <span className="text-brand-400 font-bold">
                  {postsThisMonth} post{postsThisMonth !== 1 ? "s" : ""}
                </span>{" "}
                created this month across{" "}
                {selectedProfileId ? "this profile" : "all profiles"}.
              </p>
            </div>
            <Link
              href="/dashboard/posts/generate"
              className={buttonVariants({
                className:
                  "w-full bg-white text-zinc-900 hover:bg-zinc-100 border-none",
              })}
            >
              View All Insights
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Get Started / Connect More */}
      {!selectedProfileId && (
        <Card className="hover:border-brand-300 transition-colors">
          <CardContent className="flex flex-col items-center text-center py-10">
            <div className="rounded-full bg-brand-50 p-4 mb-4">
              <Building2 size={32} className="text-brand-600" />
            </div>
            <h2 className="text-lg font-semibold mb-2">
              {hasProfiles
                ? "Connect More Profiles"
                : "Get Started with Rankmaps"}
            </h2>
            <p className="text-zinc-500 mb-6 max-w-md">
              {hasProfiles
                ? `You have ${connectedProfiles} connected profile${connectedProfiles !== 1 ? "s" : ""}. Add more Google accounts to manage additional business profiles.`
                : "Connect your Google Business Profiles to start managing posts, reviews, and analytics."}
            </p>
            <a
              href={hasProfiles ? "/api/auth/google" : "/dashboard/profiles"}
              className={buttonVariants()}
            >
              {hasProfiles
                ? "Connect Another Account"
                : "Connect Your First Profile"}
            </a>
          </CardContent>
        </Card>
      )}
    </MotionDiv>
  );
}
