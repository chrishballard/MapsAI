import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { KeywordsCitiesStep } from "@/components/onboarding/steps/keywords-cities-step";
import { AttributesStep } from "@/components/onboarding/steps/attributes-step";
import { SettingsStep } from "@/components/onboarding/steps/settings-step";
import { ReoptimizeSection } from "../reoptimize-section";
import { resolveSettingsAccess } from "./access";

export default async function ProfileSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const profile = await prisma.profile.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      address: true,
      onboardingProgress: { select: { isComplete: true } },
    },
  });

  const access = resolveSettingsAccess(profile);
  if (access === "not-found") notFound();
  if (access === "onboarding") redirect(`/dashboard/onboarding/${id}`);

  return (
    <div>
      {/* Back link */}
      <Link
        href={`/dashboard/profiles/${id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft size={14} />
        Back to {profile!.name}
      </Link>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Profile Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {profile!.name}
          {profile!.address ? ` · ${profile!.address}` : ""}
        </p>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          Everything set during onboarding stays editable here. Keyword, city,
          and automation changes apply to all AI content generated from now
          on. Description, services, and attributes update on Google when you
          push them.
        </p>
      </div>

      {/* Keywords & Cities */}
      <div className="mb-8">
        <h2 className="text-lg font-medium text-foreground mb-4">
          Keywords &amp; Cities
        </h2>
        <div className="bg-white rounded-lg border border-border card-shadow p-6">
          <KeywordsCitiesStep profileId={id} standalone />
        </div>
      </div>

      {/* Description & Services */}
      <div className="mb-8">
        <h2 className="text-lg font-medium text-foreground mb-4">
          Description &amp; Services
        </h2>
        <ReoptimizeSection profileId={id} />
      </div>

      {/* Attributes — the step renders its own group cards, so no wrapper */}
      <div className="mb-8">
        <h2 className="text-lg font-medium text-foreground mb-4">Attributes</h2>
        <AttributesStep profileId={id} standalone />
      </div>

      {/* Automation */}
      <div className="mb-8">
        <h2 className="text-lg font-medium text-foreground mb-4">Automation</h2>
        <div className="bg-white rounded-lg border border-border card-shadow p-6">
          <SettingsStep profileId={id} standalone />
        </div>
      </div>
    </div>
  );
}
