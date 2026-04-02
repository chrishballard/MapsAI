import { prisma } from "@/lib/prisma";
import { getSelectedProfileId } from "@/lib/selected-profile";
import { Building2, FileText, MessageSquare, BarChart3, ArrowUpRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button-variants";
import { MotionDiv } from "@/components/motion-wrapper";
import { Skeleton } from "@/components/ui/skeleton";

export async function StatsGrid() {
  const selectedProfileId = await getSelectedProfileId();
  const profileFilter = selectedProfileId ? { profileId: selectedProfileId } : {};
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [totalProfiles, connectedProfiles, postsThisMonth, pendingReviews, reportsGenerated] = await Promise.all([
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

  // Suppress unused variable warning
  void connectedProfiles;

  const stats = [
    { label: selectedProfileId ? "Profile" : "Total Profiles", value: selectedProfileId ? "1" : totalProfiles.toString(), icon: Building2 },
    { label: "Posts This Month", value: postsThisMonth.toString(), icon: FileText },
    { label: "Pending Reviews", value: pendingReviews.toString(), icon: MessageSquare },
    { label: "Reports Generated", value: reportsGenerated.toString(), icon: BarChart3 },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {stats.map((stat, i) => {
        const Icon = stat.icon;
        return (
          <MotionDiv key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
            <Card className="relative overflow-hidden group hover:border-brand-300 transition-colors">
              <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Icon size={48} className="text-brand-600" />
              </div>
              <CardHeader className="mb-2">
                <p className="text-sm font-medium text-zinc-500">{stat.label}</p>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between">
                  <h3 className="text-3xl font-bold text-zinc-900">{stat.value}</h3>
                  {parseInt(stat.value) > 0 && (
                    <div className="flex items-center gap-0.5 text-xs font-bold px-2 py-1 rounded-full bg-emerald-50 text-emerald-600">
                      <ArrowUpRight size={12} />Active
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </MotionDiv>
        );
      })}
    </div>
  );
}

export async function AIInsightsPanel() {
  const selectedProfileId = await getSelectedProfileId();
  const profileFilter = selectedProfileId ? { profileId: selectedProfileId } : {};
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [pendingReviews, postsThisMonth] = await Promise.all([
    prisma.reviewResponse.count({
      where: {
        status: "DRAFTED",
        ...(selectedProfileId ? { review: { profileId: selectedProfileId } } : {}),
      },
    }),
    prisma.post.count({ where: { ...profileFilter, createdAt: { gte: startOfMonth } } }),
  ]);

  return (
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
            You have <span className="text-brand-400 font-bold">{pendingReviews} pending review{pendingReviews !== 1 ? "s" : ""}</span> awaiting your approval.
          </p>
        </div>
        <div className="p-4 bg-white/10 rounded-xl border border-white/10">
          <p className="text-sm font-medium leading-relaxed">
            <span className="text-brand-400 font-bold">{postsThisMonth} post{postsThisMonth !== 1 ? "s" : ""}</span> created this month across {selectedProfileId ? "this profile" : "all profiles"}.
          </p>
        </div>
        <Link href="/dashboard/posts/generate" className={buttonVariants({ className: "w-full bg-white text-zinc-900 hover:bg-zinc-100 border-none" })}>
          View All Insights
        </Link>
      </CardContent>
    </Card>
  );
}

export function StatsGridSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {[...Array(4)].map((_, i) => (
        <Skeleton key={i} className="h-32 w-full rounded-xl" />
      ))}
    </div>
  );
}
