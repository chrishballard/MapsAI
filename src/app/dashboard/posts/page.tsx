import { FileText, Sparkles } from "lucide-react";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { PostFilters } from "./post-filters";
import { PostActions, BulkApproveButton } from "./post-actions";
import { getSelectedProfileId } from "@/lib/selected-profile";

const TYPE_BADGES: Record<string, { label: string; className: string }> = {
  WHATS_NEW: {
    label: "What's New",
    className: "bg-blue-100 text-blue-700",
  },
  EVENT: {
    label: "Event",
    className: "bg-purple-100 text-purple-700",
  },
  OFFER: {
    label: "Offer",
    className: "bg-green-100 text-green-700",
  },
};

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  DRAFT: {
    label: "Draft",
    className: "bg-gray-100 text-gray-700",
  },
  APPROVED: {
    label: "Approved",
    className: "bg-blue-100 text-blue-700",
  },
  SCHEDULED: {
    label: "Scheduled",
    className: "bg-yellow-100 text-yellow-700",
  },
  PUBLISHED: {
    label: "Published",
    className: "bg-green-100 text-green-700",
  },
  FAILED: {
    label: "Failed",
    className: "bg-red-100 text-red-700",
  },
};

function formatDate(date: Date | null | undefined): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
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
  const { profileId: filterProfileId, status, type } = params;

  // Use the global business selector, but allow page-level filter to override
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
      orderBy: { createdAt: "desc" },
    }),
    prisma.profile.findMany({
      where: { isConnected: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Count drafts per profile for bulk approve
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

  const totalDrafts = posts.filter((p) => p.status === "DRAFT").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Posts</h1>
          <p className="text-sm text-gray-500 mt-1">
            {posts.length} post{posts.length !== 1 ? "s" : ""}
            {profileId || status || type ? " (filtered)" : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
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
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors"
          >
            <Sparkles size={16} />
            Generate Posts
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
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <FileText size={48} className="text-gray-300 mx-auto mb-4" />
          <h2 className="text-lg font-medium text-gray-900 mb-2">
            No posts yet
          </h2>
          <p className="text-gray-500 mb-4">
            Generate AI-powered posts for your business profiles.
          </p>
          <Link
            href="/dashboard/posts/generate"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors"
          >
            <Sparkles size={16} />
            Generate Posts
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {posts.map((post) => {
            const typeBadge = TYPE_BADGES[post.type] || TYPE_BADGES.WHATS_NEW;
            const statusBadge =
              STATUS_BADGES[post.status] || STATUS_BADGES.DRAFT;
            const isFailed = post.status === "FAILED";

            return (
              <div
                key={post.id}
                className={`bg-white rounded-lg shadow-sm border p-4 flex flex-col ${
                  isFailed
                    ? "border-red-300 bg-red-50"
                    : "border-gray-200"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${typeBadge.className}`}
                  >
                    {typeBadge.label}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge.className}`}
                  >
                    {statusBadge.label}
                  </span>
                </div>

                <p className="text-sm text-gray-900 mb-3 flex-1">
                  {post.content.length > 150
                    ? `${post.content.slice(0, 150)}...`
                    : post.content}
                </p>

                {/* Status-specific info */}
                {post.status === "SCHEDULED" && post.scheduledAt && (
                  <p className="text-xs text-yellow-700 mb-2">
                    Scheduled for {formatDate(post.scheduledAt)}
                  </p>
                )}
                {post.status === "PUBLISHED" && post.publishedAt && (
                  <p className="text-xs text-green-700 mb-2">
                    Published on {formatDate(post.publishedAt)}
                  </p>
                )}
                {post.status === "FAILED" && post.errorMessage && (
                  <p
                    className="text-xs text-red-600 mb-2 truncate"
                    title={post.errorMessage}
                  >
                    Error: {post.errorMessage}
                  </p>
                )}

                <div className="flex items-center justify-between text-xs text-gray-500 pt-3 border-t border-gray-100">
                  <span>{post.profile.name}</span>
                  <span>
                    {new Date(post.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <PostActions postId={post.id} status={post.status} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
