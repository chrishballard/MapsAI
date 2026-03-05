import { Building2, FileText, MessageSquare, BarChart3, Star } from "lucide-react";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function DashboardPage() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [totalProfiles, connectedProfiles, postsThisMonth, pendingReviews, reportsGenerated] =
    await Promise.all([
      prisma.profile.count(),
      prisma.profile.count({ where: { isConnected: true } }),
      prisma.post.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.reviewResponse.count({ where: { status: "DRAFTED" } }),
      prisma.report.count(),
    ]);

  const [recentPosts, recentReviews] = await Promise.all([
    prisma.post.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { profile: { select: { name: true } } },
    }),
    prisma.review.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { profile: { select: { name: true } } },
    }),
  ]);

  const stats = [
    { label: "Total Profiles", value: totalProfiles.toString(), icon: Building2 },
    { label: "Posts This Month", value: postsThisMonth.toString(), icon: FileText },
    { label: "Pending Reviews", value: pendingReviews.toString(), icon: MessageSquare },
    { label: "Reports Generated", value: reportsGenerated.toString(), icon: BarChart3 },
  ];

  const hasProfiles = totalProfiles > 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

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

      {/* Recent Activity */}
      {hasProfiles && (recentPosts.length > 0 || recentReviews.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Recent Posts */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">Recent Posts</h2>
            </div>
            {recentPosts.length === 0 ? (
              <div className="px-6 py-4 text-sm text-gray-500">No posts yet.</div>
            ) : (
              <div className="divide-y divide-gray-200">
                {recentPosts.map((post) => (
                  <Link
                    key={post.id}
                    href="/dashboard/posts"
                    className="block px-6 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {post.profile.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {post.type.replace("_", " ")} &middot;{" "}
                          {post.createdAt.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          post.status === "PUBLISHED"
                            ? "bg-green-100 text-green-700"
                            : post.status === "DRAFT"
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {post.status}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Recent Reviews */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">Recent Reviews</h2>
            </div>
            {recentReviews.length === 0 ? (
              <div className="px-6 py-4 text-sm text-gray-500">No reviews yet.</div>
            ) : (
              <div className="divide-y divide-gray-200">
                {recentReviews.map((review) => (
                  <Link
                    key={review.id}
                    href="/dashboard/reviews"
                    className="block px-6 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {review.profile.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {review.reviewerName || "Anonymous"} &middot;{" "}
                          {review.reviewDate.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Star size={14} className="text-yellow-400 fill-yellow-400" />
                        <span className="text-sm font-medium text-gray-700">
                          {review.rating}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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
    </div>
  );
}
