import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { WizardShell } from "@/components/onboarding/wizard-shell";
import { activeCopyOf, activeCopyMessage } from "@/lib/location-copies";

export default async function OnboardingWizardPage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  const { profileId } = await params;

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: {
      id: true,
      name: true,
      onboardingProgress: {
        select: {
          currentStep: true,
          completedSteps: true,
          isComplete: true,
        },
      },
    },
  });

  if (!profile) {
    redirect("/dashboard/onboarding");
  }

  if (profile.onboardingProgress?.isComplete) {
    // Onboarding fields stay editable forever — a completed profile's wizard
    // URL lands on its Profile Settings page instead of a dead end.
    redirect(`/dashboard/profiles/${profile.id}/settings`);
  }

  // The wizard's steps push descriptions, services and attributes to Google
  // as they go, so a second copy of a location already managed under another
  // login's row is stopped here, not only at the final step.
  const copy = await activeCopyOf(profile.id);
  if (copy) {
    return (
      <div className="max-w-2xl mx-auto rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h1 className="text-lg font-semibold text-zinc-900">{profile.name}</h1>
        <p className="mt-2 text-sm text-zinc-700">{activeCopyMessage(copy)}</p>
        {copy.isConnected && (
          <Link
            href={`/dashboard/profiles/${copy.id}/settings`}
            className="mt-4 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            Open {copy.name}
          </Link>
        )}
      </div>
    );
  }

  const initialProgress = profile.onboardingProgress
    ? {
        currentStep: profile.onboardingProgress.currentStep,
        completedSteps: profile.onboardingProgress.completedSteps,
        isComplete: profile.onboardingProgress.isComplete,
      }
    : null;

  return (
    <div className="max-w-4xl mx-auto">
      <WizardShell
        profileId={profile.id}
        profileName={profile.name}
        initialProgress={initialProgress}
      />
    </div>
  );
}
