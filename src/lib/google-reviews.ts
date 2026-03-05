import { createGoogleClient } from "./google";

export const STAR_RATING_MAP: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

export interface GBPReviewer {
  displayName: string;
  isAnonymous: boolean;
}

export interface GBPReviewReply {
  comment: string;
  updateTime: string;
}

export interface GBPReview {
  name: string; // Full resource name: accounts/.../locations/.../reviews/...
  reviewId: string;
  reviewer: GBPReviewer;
  starRating: string; // "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE"
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: GBPReviewReply;
}

interface FetchReviewsResponse {
  reviews: GBPReview[];
  nextPageToken?: string;
  totalReviewCount?: number;
  averageRating?: number;
}

export async function fetchReviews(
  googleAccountId: string,
  accountResourceName: string,
  locationName: string,
  pageToken?: string
): Promise<FetchReviewsResponse> {
  const oauth2Client = await createGoogleClient(googleAccountId);

  const parent = `${accountResourceName}/${locationName}`;
  let url = `https://mybusiness.googleapis.com/v4/${parent}/reviews?pageSize=50&orderBy=updateTime+desc`;

  if (pageToken) {
    url += `&pageToken=${encodeURIComponent(pageToken)}`;
  }

  const response = await oauth2Client.request<FetchReviewsResponse>({
    url,
    method: "GET",
  });

  return {
    reviews: response.data.reviews || [],
    nextPageToken: response.data.nextPageToken,
    totalReviewCount: response.data.totalReviewCount,
    averageRating: response.data.averageRating,
  };
}

export async function publishReviewReply(
  googleAccountId: string,
  reviewResourceName: string,
  comment: string
): Promise<void> {
  const oauth2Client = await createGoogleClient(googleAccountId);

  const url = `https://mybusiness.googleapis.com/v4/${reviewResourceName}/reply`;

  await oauth2Client.request({
    url,
    method: "PUT",
    data: { comment },
  });
}
