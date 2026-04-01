import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  FileText,
  MessageSquare,
  Star,
  ArrowLeft,
  BarChart3,
  MousePointerClick,
  Phone,
  MapPin,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { ReoptimizeSection } from "./reoptimize-section";
import { OffboardButton } from "./offboard-button";

export default async function ProfileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const profile = await prisma.profile.findUnique({
    where: { id },
    include: { googleAccount: { select: { googleEmail: true } } },
  });

  if (!profile) notFound();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [totalPosts, draftPosts, reviewCount, reviews, recentPosts, recentReviews, metricsAgg, onboardingProgress] =
    await Promise.all([
      prisma.post.count({ where: { profileId: id } }),
      prisma.post.count({ where: { profileId: id, status: "DRAFT" } }),
      prisma.review.count({ where: { profileId: id } }),
      prisma.review.findMany({
        where: { profileId: id },
        select: { rating: true },
      }),
      prisma.post.findMany({
        where: { profileId: id },
        take: 10,
        orderBy: { createdAt: "desc" },
      }),
      prisma.review.findMany({
        where: { profileId: id },
        take: 10,
        orderBy: { createdAt: "desc" },
        include: { response: true },
      }),
      prisma.dailyMetric.aggregate({
        where: { profileId: id, date: { gte: startOfMonth } },
        _sum: {
          impressionsSearchDesktop: true,
          impressionsSearchMobile: true,
          impressionsMapsDesktop: true,
          impressionsMapsMobile: true,
          websiteClicks: true,
          callClicks: true,
          directionRequests: true,
        },
      }),
      prisma.onboardingProgress.findUnique({
        where: { profileId: id },
        select: { isComplete: true },
      }),
    ]);

  const avgRating =
    reviews.length > 0
      ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
      : "N/A";

  const totalImpressions =
    (metricsAgg._sum.impressionsSearchDesktop ?? 0) +
    (metricsAgg._sum.impressionsSearchMobile ?? 0) +
    (metricsAgg._sum.impressionsMapsDesktop ?? 0) +
    (metricsAgg._sum.impressionsMapsMobile ?? 0);
  const totalClicks = metricsAgg._sum.websiteClicks ?? 0;
  const totalCalls = metricsAgg._sum.callClicks ?? 0;
  const totalDirections = metricsAgg._sum.directionRequests ?? 0;
  const hasMetrics = totalImpressions > 0 || totalClicks > 0 || totalCalls > 0 || totalDirections > 0;

  const stats = [
    { label: "Total Posts", value: totalPosts.toString(), icon: FileText },
    { label: "Draft Posts", value: draftPosts.toString(), icon: FileText },
    { label: "Reviews", value: reviewCount.toString(), icon: MessageSquare },
    { label: "Avg Rating", value: avgRating, icon: Star },
  ];

  return (
    <div>
      {/* Back link */}
      <Link
        href="/dashboard/profiles"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft size={14} />
        Back to Profiles
      </Link>

      {/* Header */}
      <div className="bg-white rounded-lg border border-border card-shadow p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{profile.name}</h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {profile.category && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-brand-100 text-primary">
                  {profile.category}
                </span>
              )}
              {profile.address && (
                <span className="text-sm text-muted-foreground">{profile.address}</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {profile.googleAccount.googleEmail}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                profile.isConnected
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-red-100 text-red-700"
              }`}
            >
              {profile.isConnected ? "Connected" : "Disconnected"}
            </span>
            {profile.isOnboarded && <OffboardButton profileId={id} />}
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="bg-white rounded-lg border border-border card-shadow p-4"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-brand-50 rounded-md">
                  <Icon size={18} className="text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className="text-xl font-semibold text-foreground">{stat.value}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Posts Section */}
      <div className="bg-white rounded-lg border border-border card-shadow mb-6">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-medium text-foreground">Posts</h2>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/posts/generate"
              className="text-sm text-primary hover:text-primary/80 font-medium"
            >
              Generate Posts
            </Link>
            <Link
              href={`/dashboard/posts?profileId=${id}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              View All
            </Link>
          </div>
        </div>
        {recentPosts.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">
            No posts yet. Generate your first post!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6">
            {recentPosts.map((post) => (
              <div
                key={post.id}
                className="border border-border rounded-lg p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">
                    {post.type.replace("_", " ")}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      post.status === "PUBLISHED"
                        ? "bg-emerald-50 text-emerald-700"
                        : post.status === "DRAFT"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-zinc-100 text-foreground"
                    }`}
                  >
                    {post.status}
                  </span>
                </div>
                <p className="text-sm text-foreground line-clamp-3">{post.content}</p>
                <p className="text-xs text-zinc-400 mt-2">
                  {post.createdAt.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reviews Section */}
      <div className="bg-white rounded-lg border border-border card-shadow mb-6">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-medium text-foreground">Reviews</h2>
          <Link
            href={`/dashboard/reviews?profileId=${id}`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            View All
          </Link>
        </div>
        {recentReviews.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">
            No reviews synced yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {recentReviews.map((review) => (
              <div key={review.id} className="px-6 py-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {review.reviewerName || "Anonymous"}
                    </span>
                    <div className="flex items-center gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          size={12}
                          className={
                            i < review.rating
                              ? "text-amber-400 fill-amber-400"
                              : "text-zinc-300"
                          }
                        />
                      ))}
                    </div>
                  </div>
                  <span className="text-xs text-zinc-400">
                    {review.reviewDate.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
                {review.comment && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{review.comment}</p>
                )}
                {review.response && (
                  <div className="mt-2 pl-3 border-l-2 border-brand-200">
                    <p className="text-xs text-muted-foreground">
                      AI Response ({review.response.status})
                    </p>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {review.response.content}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Metrics Section */}
      {hasMetrics && (
        <div className="bg-white rounded-lg border border-border card-shadow">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-lg font-medium text-foreground">
              This Month&apos;s Metrics
            </h2>
            <Link
              href="/dashboard/reports"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              View Reports
            </Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-6">
            <div className="text-center">
              <BarChart3 size={20} className="text-primary mx-auto mb-1" />
              <p className="text-xl font-semibold text-foreground">
                {totalImpressions.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">Impressions</p>
            </div>
            <div className="text-center">
              <MousePointerClick size={20} className="text-emerald-500 mx-auto mb-1" />
              <p className="text-xl font-semibold text-foreground">
                {totalClicks.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">Website Clicks</p>
            </div>
            <div className="text-center">
              <Phone size={20} className="text-purple-500 mx-auto mb-1" />
              <p className="text-xl font-semibold text-foreground">
                {totalCalls.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">Calls</p>
            </div>
            <div className="text-center">
              <MapPin size={20} className="text-orange-500 mx-auto mb-1" />
              <p className="text-xl font-semibold text-foreground">
                {totalDirections.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">Directions</p>
            </div>
          </div>
        </div>
      )}

      {/* Re-optimize Section (only for onboarded profiles) */}
      {onboardingProgress?.isComplete && (
        <div className="mt-6">
          <h2 className="text-lg font-medium text-foreground mb-4">Re-optimize</h2>
          <ReoptimizeSection profileId={id} />
        </div>
      )}
    </div>
  );
}
