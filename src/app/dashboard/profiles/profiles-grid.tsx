'use client';

import { useState } from 'react';
import { Building2, MapPin, Star, Search, Plus } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { MotionDiv } from '@/components/motion-wrapper';
import { buttonVariants } from '@/components/ui/button-variants';
import { cn } from '@/lib/utils';
import { computeOptimizationScore, type ProfileInput } from '@/lib/optimization-score';
import { filterProfiles, GRADE_CLASSES } from './score-utils';
import { AddBusinessButton } from './add-business-button';

interface ProfileData {
  id: string;
  name: string;
  address: string | null;
  reviews: Array<{ rating: number; reviewDate: Date | string }>;
  posts: Array<{ publishedAt: Date | string | null; status: string }>;
  descriptions: Array<{ isApproved: boolean; isPushed: boolean }>;
  services: Array<{ isApproved: boolean; isPushed: boolean }>;
}

interface ProfilesGridProps {
  profiles: ProfileData[];
  availableCount: number;
}

export function ProfilesGrid({ profiles, availableCount }: ProfilesGridProps) {
  const [search, setSearch] = useState('');
  const filtered = filterProfiles(search, profiles);

  // Empty state: no profiles onboarded at all
  if (profiles.length === 0) {
    return (
      <Card className="flex flex-col items-center text-center py-16">
        <div className="w-16 h-16 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-400 mb-4">
          <Building2 size={32} />
        </div>
        <h2 className="text-lg font-semibold text-zinc-900 mb-2">
          No businesses onboarded
        </h2>
        <p className="text-zinc-500 mb-6 max-w-md">
          {availableCount > 0
            ? `You have ${availableCount} profile${availableCount !== 1 ? 's' : ''} available to onboard.`
            : 'Connect a Google account to import your business profiles.'}
        </p>
        {availableCount > 0 ? (
          <AddBusinessButton availableCount={availableCount} variant="primary" />
        ) : (
          <a
            href="/api/auth/google"
            className={buttonVariants({ className: 'gap-2' })}
          >
            <Plus className="w-4 h-4" />
            Connect Google Account
          </a>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search bar (D-05) */}
      <div className="relative max-w-sm">
        <Search
          size={16}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
        />
        <Input
          placeholder="Search businesses..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      {/* Search empty state (D-06 / Pitfall 4) */}
      {filtered.length === 0 && (
        <p className="text-center text-zinc-500 py-12">
          No businesses match your search
        </p>
      )}

      {/* Card grid (D-10) */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((profile, i) => {
            // Reconstruct Date objects from ISO strings (Pitfall 2)
            const profileInput: ProfileInput = {
              reviews: profile.reviews.map(r => ({
                rating: r.rating,
                reviewDate: new Date(r.reviewDate),
              })),
              posts: profile.posts.map(p => ({
                publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
                status: p.status,
              })),
              descriptions: profile.descriptions,
              services: profile.services,
            };
            const score = computeOptimizationScore(profileInput);

            const reviewCount = profile.reviews.length;
            const avgRating =
              reviewCount > 0
                ? (
                    profile.reviews.reduce((sum, r) => sum + r.rating, 0) /
                    reviewCount
                  ).toFixed(1)
                : null;

            return (
              <MotionDiv
                key={profile.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <Card className="p-5 hover:border-brand-300 transition-colors group h-full flex flex-col relative">
                  {/* Score badge in top-right corner (D-01, D-02) — links to optimization page (D-14) */}
                  <Link href={`/dashboard/optimization/${profile.id}`}>
                    <Badge
                      className={cn(
                        GRADE_CLASSES[score.grade],
                        'font-semibold text-xs absolute top-3 right-3 cursor-pointer hover:opacity-80'
                      )}
                    >
                      {score.total}
                    </Badge>
                  </Link>

                  <div className="flex items-start gap-3 mb-3 pr-12">
                    <div className="w-12 h-12 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-500 group-hover:bg-brand-50 group-hover:text-brand-600 transition-colors shrink-0">
                      <Building2 size={24} />
                    </div>
                    {avgRating && (
                      <div className="flex items-center gap-1 ml-auto mt-1">
                        <div className="flex">
                          {[1, 2, 3, 4, 5].map(star => (
                            <Star
                              key={star}
                              size={14}
                              className={
                                star <= Math.round(Number(avgRating))
                                  ? 'text-amber-400 fill-amber-400'
                                  : 'text-zinc-200'
                              }
                            />
                          ))}
                        </div>
                        <span className="text-sm font-semibold text-zinc-900 ml-1">
                          {avgRating}
                        </span>
                        {/* Review count (D-12) */}
                        <span className="text-xs text-zinc-500 ml-1">
                          ({reviewCount} review{reviewCount !== 1 ? 's' : ''})
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
    </div>
  );
}
