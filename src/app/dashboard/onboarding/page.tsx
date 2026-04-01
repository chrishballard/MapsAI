import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Building2, CheckCircle2, ArrowRight } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ completed?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  const params = await searchParams;

  const profiles = await prisma.profile.findMany({
    where: {
      isConnected: true,
      OR: [
        { onboardingProgress: { is: null } },
        { onboardingProgress: { isComplete: false } },
      ],
    },
    select: {
      id: true,
      name: true,
      address: true,
      category: true,
      onboardingProgress: {
        select: { currentStep: true, completedSteps: true },
      },
    },
    orderBy: { name: "asc" },
  });

  const showCompletedBanner = params.completed === "true";

  return (
    <div>
      {showCompletedBanner && (
        <div className="mb-6 flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-4 py-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <p className="text-sm font-medium">
            Onboarding completed successfully!
          </p>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-3xl font-bold text-zinc-900 tracking-tight">
          Onboard a Business
        </h1>
        <p className="text-zinc-500 mt-1">
          Select a profile to begin the optimization wizard
        </p>
      </div>

      {profiles.length === 0 ? (
        <div className="bg-white rounded-lg border border-border card-shadow p-12 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-1">
            All profiles have been onboarded
          </h2>
          <p className="text-muted-foreground text-sm">
            Every connected profile has completed the onboarding process.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {profiles.map((profile) => {
            const hasProgress = profile.onboardingProgress !== null;
            const currentStep =
              profile.onboardingProgress?.currentStep ?? 0;

            return (
              <div
                key={profile.id}
                className="bg-white rounded-lg border border-border card-shadow p-5 flex flex-col"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 bg-brand-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-5 h-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-foreground truncate">
                      {profile.name}
                    </h3>
                    {profile.category && (
                      <span className="inline-block mt-1 text-xs bg-zinc-100 text-muted-foreground rounded-full px-2 py-0.5">
                        {profile.category}
                      </span>
                    )}
                  </div>
                </div>

                {profile.address && (
                  <p className="text-sm text-muted-foreground mb-4 truncate">
                    {profile.address}
                  </p>
                )}

                {hasProgress && (
                  <p className="text-xs text-primary font-medium mb-3">
                    Step {currentStep + 1} of {7}
                  </p>
                )}

                <div className="mt-auto">
                  <Link
                    href={`/dashboard/onboarding/${profile.id}`}
                    className="flex items-center justify-center gap-1 w-full bg-primary text-white hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium transition-colors"
                  >
                    {hasProgress ? "Resume" : "Start Onboarding"}
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
