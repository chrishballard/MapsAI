import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get("profileId");

  if (!profileId) {
    return NextResponse.json(
      { error: "profileId is required" },
      { status: 400 }
    );
  }

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: {
      id: true,
      name: true,
      category: true,
      postFrequency: true,
      onboardingProgress: {
        select: { completedSteps: true, isComplete: true, completedAt: true },
      },
      keywords: { select: { keyword: true }, orderBy: { sortOrder: "asc" } },
      cities: { select: { city: true }, orderBy: { sortOrder: "asc" } },
      descriptions: {
        select: { content: true, isApproved: true, isPushed: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      services: {
        select: { serviceName: true, isApproved: true, isPushed: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!profile) {
    return NextResponse.json(
      { error: "Profile not found" },
      { status: 404 }
    );
  }

  const completedSteps =
    profile.onboardingProgress?.completedSteps ?? [];

  const steps = [
    {
      name: "Keywords & Cities",
      stepIndex: 1,
      status:
        profile.keywords.length > 0
          ? "complete"
          : completedSteps.includes(1)
            ? "skipped"
            : "pending",
      detail:
        profile.keywords.length > 0
          ? `${profile.keywords.length} keywords, ${profile.cities.length} cities`
          : undefined,
    },
    {
      name: "Description",
      stepIndex: 2,
      status:
        profile.descriptions.length > 0 && profile.descriptions[0].isApproved
          ? "complete"
          : completedSteps.includes(2)
            ? "skipped"
            : "pending",
      detail: profile.descriptions[0]?.isPushed
        ? "Pushed to Google"
        : undefined,
    },
    {
      name: "Services",
      stepIndex: 3,
      status: profile.services.some((s) => s.isApproved)
        ? "complete"
        : completedSteps.includes(3)
          ? "skipped"
          : "pending",
      detail:
        profile.services.length > 0
          ? `${profile.services.filter((s) => s.isApproved).length} of ${profile.services.length} approved`
          : undefined,
    },
    {
      name: "Attributes",
      stepIndex: 4,
      status: completedSteps.includes(4) ? "complete" : "pending",
      detail: completedSteps.includes(4) ? "Pushed to Google" : undefined,
    },
    {
      name: "Settings",
      stepIndex: 5,
      status: completedSteps.includes(5) ? "complete" : "pending",
      detail: `${profile.postFrequency} posts/month`,
    },
  ];

  return NextResponse.json({
    profile: { name: profile.name, category: profile.category },
    steps,
    isComplete: profile.onboardingProgress?.isComplete ?? false,
    completedAt: profile.onboardingProgress?.completedAt ?? null,
  });
}
