import {
  FileText,
  Sparkles,
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle,
  MoreHorizontal,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { PostFilters } from "./post-filters";
import { PostActions, BulkApproveButton } from "./post-actions";
import { getSelectedProfileId } from "@/lib/selected-profile";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { MotionDiv } from "@/components/motion-wrapper";

const TYPE_BADGES: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  WHATS_NEW: { label: "What's New", variant: "default" },
  EVENT: { label: "Event", variant: "secondary" },
  OFFER: { label: "Offer", variant: "outline" },
};

const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    variant: "secondary" | "default" | "warning" | "success" | "error";
    icon: typeof CheckCircle2;
    color: string;
  }
> = {
  DRAFT: { label: "Draft", variant: "secondary", icon: Clock, color: "text-zinc-500" },
  APPROVED: { label: "Approved", variant: "default", icon: CheckCircle2, color: "text-blue-500" },
  SCHEDULED: { label: "Scheduled", variant: "warning", icon: Clock, color: "text-amber-500" },
  PUBLISHED: { label: "Published", variant: "success", icon: CheckCircle2, color: "text-emerald-500" },
  FAILED: { label: "Failed", variant: "error", icon: AlertCircle, color: "text-red-500" },
};

function formatDate(date: Date | null | undefined): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface PostsPageProps {
  searchParams: Promise<{
    profileId?: string;
    status?: string;
    type?: string;
  }>;
}

export default async function PostsPage({ searchParams }: PostsPageProps) {
  const params = await searchParams;
  const selectedProfileId = await getSelectedProfileId();
  const { profileId: filterProfileId, status: statusParam, type } = params;

  // Default to showing SCHEDULED posts; use "all" to show everything
  const status = statusParam === "all" ? undefined : (statusParam || "SCHEDULED");

  const profileId = filterProfileId || selectedProfileId;

  const where: Record<string, string> = {};
  if (profileId) where.profileId = profileId;
  if (status) where.status = status;
  if (type) where.type = type;

  const [posts, profiles] = await Promise.all([
    prisma.post.findMany({
      where,
      include: {
        profile: { select: { id: true, name: true, category: true } },
      },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    }),
    prisma.profile.findMany({
      where: { isConnected: true, isOnboarded: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const draftCounts = posts
    .filter((p) => p.status === "DRAFT")
    .reduce<Record<string, { count: number; name: string }>>(
      (acc, post) => {
        if (!acc[post.profileId]) {
          acc[post.profileId] = { count: 0, name: post.profile.name };
        }
        acc[post.profileId].count++;
        return acc;
      },
      {}
    );

  return (
    <MotionDiv
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-8"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 tracking-tight">
            Posts
          </h1>
          <p className="text-zinc-500 mt-1">
            Create and manage your Google Business Profile posts.
          </p>
        </div>
        <div className="flex gap-3">
          {Object.entries(draftCounts).map(([pId, { count, name }]) => (
            <BulkApproveButton
              key={pId}
              profileId={pId}
              profileName={name}
              draftCount={count}
            />
          ))}
          <Link
            href="/dashboard/posts/generate"
            className={buttonVariants({ className: "gap-2" })}
          >
            <Sparkles className="w-4 h-4" />
            AI Generate
          </Link>
        </div>
      </div>

      <PostFilters
        profiles={profiles}
        currentProfileId={profileId || undefined}
        currentStatus={status}
        currentType={type}
      />

      {posts.length === 0 ? (
        <Card className="flex flex-col items-center text-center py-16">
          <div className="w-16 h-16 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-400 mb-4">
            <FileText size={32} />
          </div>
          <h2 className="text-lg font-semibold text-zinc-900 mb-2">
            No posts yet
          </h2>
          <p className="text-zinc-500 mb-6 max-w-md">
            Generate AI-powered posts for your business profiles.
          </p>
          <Link
            href="/dashboard/posts/generate"
            className={buttonVariants({ className: "gap-2" })}
          >
            <Sparkles className="w-4 h-4" />
            Generate Posts
          </Link>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {posts.map((post, i) => {
            const typeBadge = TYPE_BADGES[post.type] || TYPE_BADGES.WHATS_NEW;
            const statusConfig =
              STATUS_CONFIG[post.status] || STATUS_CONFIG.DRAFT;
            const StatusIcon = statusConfig.icon;
            const isFailed = post.status === "FAILED";

            return (
              <MotionDiv
                key={post.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
              >
                <Card
                  className={`h-full flex flex-col hover:border-brand-300 transition-colors group ${
                    isFailed ? "border-red-300 bg-red-50/50" : ""
                  }`}
                >
                  <CardHeader className="flex-row items-center justify-between">
                    <Badge
                      variant={typeBadge.variant}
                      className="text-[10px] uppercase tracking-wider font-bold"
                    >
                      {typeBadge.label}
                    </Badge>
                    <div className="flex items-center gap-1.5">
                      <StatusIcon size={14} className={statusConfig.color} />
                      <span
                        className={`text-xs font-bold ${statusConfig.color}`}
                      >
                        {statusConfig.label}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1">
                    <p className="text-sm text-zinc-600 leading-relaxed line-clamp-4 italic">
                      &ldquo;{post.content.length > 150
                        ? `${post.content.slice(0, 150)}...`
                        : post.content}&rdquo;
                    </p>

                    {post.status === "SCHEDULED" && post.scheduledAt && (
                      <p className="text-xs text-amber-700 mt-2">
                        Scheduled for {formatDate(post.scheduledAt)}
                      </p>
                    )}
                    {post.status === "FAILED" && post.errorMessage && (
                      <p
                        className="text-xs text-red-600 mt-2 truncate"
                        title={post.errorMessage}
                      >
                        Error: {post.errorMessage}
                      </p>
                    )}
                  </CardContent>
                  <div className="px-6 py-4 mt-auto border-t border-zinc-100 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-zinc-900">
                        {post.profile.name}
                      </p>
                      <p className="text-[10px] text-zinc-400 mt-0.5">
                        {formatDate(post.createdAt)}
                      </p>
                    </div>
                    <PostActions postId={post.id} status={post.status} />
                  </div>
                </Card>
              </MotionDiv>
            );
          })}
        </div>
      )}
    </MotionDiv>
  );
}
