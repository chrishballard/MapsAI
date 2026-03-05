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
        { onboardingProgress: null },
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
        <div className="mb-6 flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
          <p className="text-sm font-medium">
            Onboarding completed successfully!
          </p>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Onboard a Business
        </h1>
        <p className="text-gray-500 mt-1">
          Select a profile to begin the optimization wizard
        </p>
      </div>

      {profiles.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            All profiles have been onboarded
          </h2>
          <p className="text-gray-500 text-sm">
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
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 flex flex-col"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-gray-900 truncate">
                      {profile.name}
                    </h3>
                    {profile.category && (
                      <span className="inline-block mt-1 text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                        {profile.category}
                      </span>
                    )}
                  </div>
                </div>

                {profile.address && (
                  <p className="text-sm text-gray-500 mb-4 truncate">
                    {profile.address}
                  </p>
                )}

                {hasProgress && (
                  <p className="text-xs text-blue-600 font-medium mb-3">
                    Step {currentStep + 1} of {7}
                  </p>
                )}

                <div className="mt-auto">
                  <Link
                    href={`/dashboard/onboarding/${profile.id}`}
                    className="flex items-center justify-center gap-1 w-full bg-blue-600 text-white hover:bg-blue-700 rounded-md px-4 py-2 text-sm font-medium transition-colors"
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
