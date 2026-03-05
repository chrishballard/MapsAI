import { MessageSquare, Star } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { ReviewFilters } from "./review-filters";
import { ReviewActions, SyncButton, BulkApproveButton } from "./review-actions";

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  DRAFTED: {
    label: "Drafted",
    className: "bg-gray-100 text-gray-700",
  },
  APPROVED: {
    label: "Approved",
    className: "bg-blue-100 text-blue-700",
  },
  PUBLISHED: {
    label: "Published",
    className: "bg-green-100 text-green-700",
  },
  FAILED: {
    label: "Failed",
    className: "bg-red-100 text-red-700",
  },
};

function formatDate(date: Date | null | undefined): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={14}
          className={
            star <= rating
              ? "fill-yellow-400 text-yellow-400"
              : "text-gray-300"
          }
        />
      ))}
    </div>
  );
}

interface ReviewsPageProps {
  searchParams: Promise<{
    profileId?: string;
    rating?: string;
    responseStatus?: string;
  }>;
}

export default async function ReviewsPage({ searchParams }: ReviewsPageProps) {
  const params = await searchParams;
  const { profileId, rating, responseStatus } = params;

  const where: Prisma.ReviewWhereInput = {};
  if (profileId) where.profileId = profileId;
  if (rating) where.rating = parseInt(rating, 10);
  if (responseStatus) {
    where.response = {
      status: responseStatus as Prisma.EnumReviewResponseStatusFilter["equals"],
    };
  }

  const [reviews, profiles] = await Promise.all([
    prisma.review.findMany({
      where,
      include: {
        profile: { select: { id: true, name: true, category: true } },
        response: true,
      },
      orderBy: { reviewDate: "desc" },
    }),
    prisma.profile.findMany({
      where: { isConnected: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Count drafts for bulk approve
  const draftCount = reviews.filter(
    (r) => r.response?.status === "DRAFTED"
  ).length;

  const hasFilters = profileId || rating || responseStatus;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reviews</h1>
          <p className="text-sm text-gray-500 mt-1">
            {reviews.length} review{reviews.length !== 1 ? "s" : ""}
            {hasFilters ? " (filtered)" : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {draftCount > 0 && profileId && (
            <BulkApproveButton profileId={profileId} draftCount={draftCount} />
          )}
          <SyncButton />
        </div>
      </div>

      <ReviewFilters
        profiles={profiles}
        currentProfileId={profileId}
        currentRating={rating}
        currentResponseStatus={responseStatus}
      />

      {reviews.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <MessageSquare size={48} className="text-gray-300 mx-auto mb-4" />
          <h2 className="text-lg font-medium text-gray-900 mb-2">
            No reviews synced
          </h2>
          <p className="text-gray-500 mb-4">
            Sync reviews from your connected Google Business Profiles.
          </p>
          <SyncButton />
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => {
            const statusBadge = review.response
              ? STATUS_BADGES[review.response.status] || STATUS_BADGES.DRAFTED
              : null;

            return (
              <div
                key={review.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-5"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <StarRating rating={review.rating} />
                    <span className="text-sm font-medium text-gray-900">
                      {review.reviewerName || "Anonymous"}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatDate(review.reviewDate)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-600">
                      {review.profile.name}
                    </span>
                    {statusBadge && (
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge.className}`}
                      >
                        {statusBadge.label}
                      </span>
                    )}
                  </div>
                </div>

                <p className="text-sm text-gray-700 mb-4">
                  {review.comment || (
                    <span className="italic text-gray-400">
                      Rating only - no comment
                    </span>
                  )}
                </p>

                {review.response && (
                  <div className="border border-gray-200 rounded-md p-3 bg-gray-50">
                    <p className="text-xs font-medium text-gray-500 mb-1">
                      AI Response Draft
                    </p>
                    <p className="text-sm text-gray-700">
                      {review.response.content}
                    </p>
                    {review.response.status === "FAILED" &&
                      review.response.errorMessage && (
                        <p
                          className="text-xs text-red-600 mt-2 truncate"
                          title={review.response.errorMessage}
                        >
                          Error: {review.response.errorMessage}
                        </p>
                      )}
                  </div>
                )}

                <ReviewActions
                  reviewId={review.id}
                  responseStatus={review.response?.status || null}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
