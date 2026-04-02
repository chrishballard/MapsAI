import { prisma } from "@/lib/prisma";
import { MotionDiv } from "@/components/motion-wrapper";
import { AddBusinessButton } from "./add-business-button";
import { ResyncButton } from "./resync-button";
import { ProfilesGrid } from "./profiles-grid";

export default async function ProfilesPage() {
  const profiles = await prisma.profile.findMany({
    where: { isConnected: true, isOnboarded: true },
    select: {
      id: true,
      name: true,
      address: true,
      reviews: { select: { rating: true, reviewDate: true } },
      posts: { select: { publishedAt: true, status: true } },
      descriptions: { select: { isApproved: true, isPushed: true } },
      services: { select: { isApproved: true, isPushed: true } },
    },
    orderBy: { name: "asc" },
  });

  const availableCount = await prisma.profile.count({
    where: { isConnected: true, isOnboarded: false },
  });

  return (
    <MotionDiv
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 tracking-tight">
            Businesses
          </h1>
          <p className="text-zinc-500 mt-1">
            {profiles.length} onboarded business{profiles.length !== 1 ? "es" : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {profiles.length > 0 && <ResyncButton />}
          <AddBusinessButton availableCount={availableCount} />
        </div>
      </div>

      <ProfilesGrid profiles={profiles} availableCount={availableCount} />
    </MotionDiv>
  );
}
