import { Building2, MapPin, Star, Plus } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { MotionDiv } from "@/components/motion-wrapper";
import { AddBusinessButton } from "./add-business-button";
import { ResyncButton } from "./resync-button";

export default async function ProfilesPage() {
  const profiles = await prisma.profile.findMany({
    where: { isConnected: true, isOnboarded: true },
    include: {
      googleAccount: true,
      reviews: true,
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

      {profiles.length === 0 ? (
        <Card className="flex flex-col items-center text-center py-16">
          <div className="w-16 h-16 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-400 mb-4">
            <Building2 size={32} />
          </div>
          <h2 className="text-lg font-semibold text-zinc-900 mb-2">
            No businesses onboarded
          </h2>
          <p className="text-zinc-500 mb-6 max-w-md">
            {availableCount > 0
              ? `You have ${availableCount} profile${availableCount !== 1 ? "s" : ""} available to onboard.`
              : "Connect a Google account to import your business profiles."}
          </p>
          {availableCount > 0 ? (
            <AddBusinessButton availableCount={availableCount} variant="primary" />
          ) : (
            <a
              href="/api/auth/google"
              className={buttonVariants({ className: "gap-2" })}
            >
              <Plus className="w-4 h-4" />
              Connect Google Account
            </a>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {profiles.map((profile, i) => {
            const avgRating =
              profile.reviews.length > 0
                ? (
                    profile.reviews.reduce((sum, r) => sum + r.rating, 0) /
                    profile.reviews.length
                  ).toFixed(1)
                : null;

            return (
              <MotionDiv
                key={profile.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <Card className="p-5 hover:border-brand-300 transition-colors group h-full flex flex-col">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-12 h-12 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-500 group-hover:bg-brand-50 group-hover:text-brand-600 transition-colors shrink-0">
                      <Building2 size={24} />
                    </div>
                    {avgRating && (
                      <div className="flex items-center gap-1 ml-auto">
                        <div className="flex">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              size={14}
                              className={
                                star <= Math.round(Number(avgRating))
                                  ? "text-amber-400 fill-amber-400"
                                  : "text-zinc-200"
                              }
                            />
                          ))}
                        </div>
                        <span className="text-sm font-semibold text-zinc-900 ml-1">
                          {avgRating}
                        </span>
                      </div>
                    )}
                  </div>

                  <h3 className="font-bold text-zinc-900 text-sm leading-tight mb-1">
                    {profile.name}
                  </h3>

                  {profile.address && (
                    <p className="text-xs text-zinc-500 flex items-center gap-1 mb-3">
                      <MapPin size={11} className="shrink-0" />
                      <span className="truncate">{profile.address}</span>
                    </p>
                  )}

                  <div className="mt-auto pt-2">
                    <Link
                      href={`/dashboard/profiles/${profile.id}`}
                      className="text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors"
                    >
                      View details
                    </Link>
                  </div>
                </Card>
              </MotionDiv>
            );
          })}
        </div>
      )}
    </MotionDiv>
  );
}
