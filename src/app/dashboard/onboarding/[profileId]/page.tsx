import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { WizardShell } from "@/components/onboarding/wizard-shell";

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
    redirect("/dashboard/onboarding?completed=true");
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
