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
