import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getSelectedProfileId } from '@/lib/selected-profile';

/**
 * /dashboard/optimization — index route.
 *
 * Resolution order (D-13):
 * 1. If the selected-profile cookie points to a valid profile → redirect to it.
 * 2. Otherwise, find the first profile (alphabetical) → redirect to it.
 * 3. No profiles at all → show empty state with link to /dashboard/profiles.
 */
export default async function OptimizationIndexPage() {
  const cookieProfileId = await getSelectedProfileId();

  if (cookieProfileId) {
    const found = await prisma.profile.findUnique({
      where: { id: cookieProfileId },
      select: { id: true },
    });
    if (found) {
      redirect(`/dashboard/optimization/${found.id}`);
    }
  }

  // Cookie missing or stale — fall back to first profile
  const firstProfile = await prisma.profile.findFirst({
    select: { id: true },
    orderBy: { name: 'asc' },
  });

  if (firstProfile) {
    redirect(`/dashboard/optimization/${firstProfile.id}`);
  }

  // No profiles onboarded yet
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-lg font-semibold text-zinc-900 mb-2">
        No business profiles found
      </p>
      <p className="text-zinc-500 mb-6">
        Onboard a Google Business Profile to view its optimization score.
      </p>
      <Link
        href="/dashboard/profiles"
        className="text-brand-600 font-medium hover:text-brand-700 transition-colors"
      >
        Go to Businesses
      </Link>
    </div>
  );
}
