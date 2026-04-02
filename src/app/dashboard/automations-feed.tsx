import { prisma } from "@/lib/prisma";
import { getSelectedProfileId } from "@/lib/selected-profile";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export type AutomationItem = {
  id: string;
  label: string;
  profileName: string;
  profileId: string;
  time: Date;
  type: "post" | "review_reply" | "description";
  detailHref: string;
};

type PostInput = {
  id: string;
  status: string;
  updatedAt: Date;
  profile: { name: string; id?: string };
};
type ResponseInput = {
  id: string;
  status: string;
  updatedAt: Date;
  review: { profileId: string; profile: { name: string } };
};
type DescriptionInput = {
  id: string;
  pushedAt: Date | null;
  profile: { id: string; name: string };
};

export function buildAutomationItems(
  posts: PostInput[],
  responses: ResponseInput[],
  descriptions: DescriptionInput[]
): AutomationItem[] {
  const postItems: AutomationItem[] = posts.map((p) => ({
    id: p.id,
    label:
      p.status === "PUBLISHED"
        ? "Published post"
        : p.status === "SCHEDULED"
          ? "Scheduled post"
          : "Approved post",
    profileName: p.profile.name,
    profileId: p.profile.id ?? "",
    time: p.updatedAt,
    type: "post" as const,
    detailHref: "/dashboard/posts",
  }));

  const responseItems: AutomationItem[] = responses.map((r) => ({
    id: r.id,
    label:
      r.status === "PUBLISHED"
        ? "Published review reply"
        : "Approved review reply",
    profileName: r.review.profile.name,
    profileId: r.review.profileId,
    time: r.updatedAt,
    type: "review_reply" as const,
    detailHref: "/dashboard/reviews",
  }));

  const descriptionItems: AutomationItem[] = descriptions
    .filter((d) => d.pushedAt !== null)
    .map((d) => ({
      id: d.id,
      label: "Pushed description",
      profileName: d.profile.name,
      profileId: d.profile.id,
      time: d.pushedAt!,
      type: "description" as const,
      detailHref: `/dashboard/profiles/${d.profile.id}`,
    }));

  return [...postItems, ...responseItems, ...descriptionItems]
    .sort((a, b) => b.time.getTime() - a.time.getTime())
    .slice(0, 20);
}

function timeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export async function AutomationsFeed() {
  const selectedProfileId = await getSelectedProfileId();
  const profileFilter = selectedProfileId ? { profileId: selectedProfileId } : {};

  const [recentPosts, recentResponses, recentDescriptions] = await Promise.all([
    prisma.post.findMany({
      where: { ...profileFilter, status: { in: ["PUBLISHED", "APPROVED", "SCHEDULED"] } },
      take: 20,
      orderBy: { updatedAt: "desc" },
      include: { profile: { select: { id: true, name: true } } },
    }),
    prisma.reviewResponse.findMany({
      where: {
        status: { in: ["PUBLISHED", "APPROVED"] },
        ...(selectedProfileId ? { review: { profileId: selectedProfileId } } : {}),
      },
      take: 20,
      orderBy: { updatedAt: "desc" },
      include: { review: { select: { profileId: true, profile: { select: { name: true } } } } },
    }),
    prisma.profileDescription.findMany({
      where: { ...profileFilter, pushedAt: { not: null } },
      take: 20,
      orderBy: { pushedAt: "desc" },
      include: { profile: { select: { id: true, name: true } } },
    }),
  ]);

  const automations = buildAutomationItems(recentPosts, recentResponses, recentDescriptions);

  if (automations.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {automations.map((item) => (
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
                    {item.label} for <span className="text-brand-600">{item.profileName}</span>
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                      {item.type === "post" ? "Post" : item.type === "review_reply" ? "Review" : "Description"}
                    </Badge>
                    <span className="text-xs text-zinc-400">{timeAgo(item.time)}</span>
                  </div>
                </div>
              </div>
              <Link
                href={item.detailHref}
                className="text-xs font-medium text-brand-600 hover:text-brand-700 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                See details
              </Link>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function AutomationsFeedSkeleton() {
  return (
    <Card>
      <CardHeader><Skeleton className="h-6 w-40" /></CardHeader>
      <CardContent className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </CardContent>
    </Card>
  );
}
