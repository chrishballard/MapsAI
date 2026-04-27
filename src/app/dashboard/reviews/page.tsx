import { MessageSquare, Star, ThumbsUp, Reply, Sparkles } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { ReviewFilters } from "./review-filters";
import {
  ReviewActions,
  SyncButton,
  BulkApproveButton,
} from "./review-actions";
import { getSelectedProfileId } from "@/lib/selected-profile";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { MotionDiv } from "@/components/motion-wrapper";
import { cn } from "@/lib/utils";

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={14}
          className={
            star <= rating
              ? "fill-amber-400 text-amber-400"
              : "text-zinc-200"
          }
        />
      ))}
    </div>
  );
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return "";
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATUS_VARIANT: Record<string, "secondary" | "default" | "success" | "warning" | "error"> = {
  DRAFTED: "warning",
  APPROVED: "default",
  PUBLISHED: "success",
  FAILED: "error",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFTED: "Pending",
  APPROVED: "Approved",
  PUBLISHED: "Replied",
  FAILED: "Failed",
};

interface ReviewsPageProps {
  searchParams: Promise<{
    rating?: string;
    responseStatus?: string;
  }>;
}

export default async function ReviewsPage({ searchParams }: ReviewsPageProps) {
  const params = await searchParams;
  const profileId = await getSelectedProfileId();
  const { rating, responseStatus } = params;

  const where: Prisma.ReviewWhereInput = {};
  if (profileId) where.profileId = profileId;
  if (rating) where.rating = parseInt(rating, 10);
  if (responseStatus) {
    where.response = {
      status:
        responseStatus as Prisma.EnumReviewResponseStatusFilter["equals"],
    };
  }

  const reviews = await prisma.review.findMany({
    where,
    include: {
      profile: { select: { id: true, name: true, category: true } },
      response: true,
    },
    orderBy: { reviewDate: "desc" },
  });

  const draftCount = reviews.filter(
    (r) => r.response?.status === "DRAFTED"
  ).length;

  const hasFilters = rating || responseStatus;

  return (
    <MotionDiv
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-8"
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-4 mb-1">
            <h1 className="text-3xl font-bold text-zinc-900 tracking-tight">
              Reviews
            </h1>
            <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
              <span className="px-3 py-1.5 rounded-md text-sm font-medium bg-white text-zinc-900 shadow-sm">
                All
              </span>
              <Link
                href="/dashboard/reviews/metrics"
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  "text-zinc-500 hover:text-zinc-700"
                )}
              >
                Metrics
              </Link>
            </div>
          </div>
          <p className="text-zinc-500 mt-1">
            Monitor and respond to your customer reviews.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {draftCount > 0 && profileId && (
            <BulkApproveButton
              profileId={profileId}
              draftCount={draftCount}
            />
          )}
          <SyncButton />
        </div>
      </div>

      <ReviewFilters
        currentRating={rating}
        currentResponseStatus={responseStatus}
      />

      {reviews.length === 0 ? (
        <Card className="flex flex-col items-center text-center py-16">
          <div className="w-16 h-16 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-400 mb-4">
            <MessageSquare size={32} />
          </div>
          <h2 className="text-lg font-semibold text-zinc-900 mb-2">
            No reviews synced
          </h2>
          <p className="text-zinc-500 mb-6 max-w-md">
            Sync reviews from your connected Google Business Profiles.
          </p>
          <SyncButton />
        </Card>
      ) : (
        <div className="space-y-4">
          {reviews.map((review, i) => {
            const responseStatus = review.response?.status;
            const badgeVariant = responseStatus
              ? STATUS_VARIANT[responseStatus] || "secondary"
              : null;
            const badgeLabel = responseStatus
              ? STATUS_LABEL[responseStatus] || responseStatus
              : null;

            return (
              <MotionDiv
                key={review.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Card className="hover:border-brand-300 transition-colors group">
                  <div className="flex items-start justify-between">
                    <div className="flex gap-4">
                      <div className="w-10 h-10 bg-zinc-100 rounded-full flex items-center justify-center text-zinc-500 font-bold shrink-0">
                        {(review.reviewerName || "A")[0].toUpperCase()}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-zinc-900">
                            {review.reviewerName || "Anonymous"}
                          </span>
                          <StarRating rating={review.rating} />
                          <span className="text-xs text-zinc-400">
                            {formatDate(review.reviewDate)}
                          </span>
                        </div>
                        <p className="text-sm text-zinc-600 leading-relaxed max-w-2xl">
                          {review.comment ? (
                            <>&ldquo;{review.comment}&rdquo;</>
                          ) : (
                            <span className="italic text-zinc-400">
                              Rating only - no comment
                            </span>
                          )}
                        </p>
                        <div className="flex items-center gap-4 mt-3">
                          <span className="text-xs font-bold text-brand-600 uppercase tracking-wider">
                            {review.profile.name}
                          </span>
                          {badgeVariant && badgeLabel && (
                            <Badge variant={badgeVariant}>{badgeLabel}</Badge>
                          )}
                        </div>

                        {review.response && (
                          <div className="mt-3 p-3 bg-zinc-50 rounded-xl border border-zinc-100">
                            <p className="text-xs font-medium text-zinc-400 mb-1">
                              AI Response
                            </p>
                            <p className="text-sm text-zinc-600">
                              {review.response.content}
                            </p>
                            {review.response.status === "FAILED" &&
                              review.response.errorMessage && (
                                <p className="text-xs text-red-600 mt-2 truncate">
                                  Error: {review.response.errorMessage}
                                </p>
                              )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <ReviewActions
                        reviewId={review.id}
                        responseStatus={review.response?.status || null}
                      />
                    </div>
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
