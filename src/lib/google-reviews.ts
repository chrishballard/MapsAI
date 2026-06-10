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
  name: string; // Full resource name
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

  // Try multiple URL formats — the GBP Reviews API requires the v4 endpoint
  // with "Google My Business API" enabled. Wildcard account (-) also works.
  const endpoints = [
    `https://mybusiness.googleapis.com/v4/${parent}/reviews`,
    `https://mybusiness.googleapis.com/v4/accounts/-/${locationName}/reviews`,
  ];

  let lastError: unknown;

  for (const baseUrl of endpoints) {
    try {
      let url = `${baseUrl}?pageSize=50&orderBy=updateTime+desc`;
      if (pageToken) {
        url += `&pageToken=${encodeURIComponent(pageToken)}`;
      }

      console.log(`[google-reviews] Trying: ${baseUrl}`);
      const response = await oauth2Client.request<FetchReviewsResponse>({
        url,
        method: "GET",
      });

      console.log(`[google-reviews] Success with: ${baseUrl} — ${response.data.reviews?.length ?? 0} reviews`);
      return {
        reviews: response.data.reviews || [],
        nextPageToken: response.data.nextPageToken,
        totalReviewCount: response.data.totalReviewCount,
        averageRating: response.data.averageRating,
      };
    } catch (err) {
      lastError = err;
      const status = (err as { response?: { status?: number } }).response?.status;
      console.warn(`[google-reviews] Failed with ${baseUrl} (status: ${status}), trying next...`);
    }
  }

  throw lastError;
}

export async function fetchSingleReview(
  googleAccountId: string,
  reviewResourceName: string
): Promise<GBPReview> {
  const oauth2Client = await createGoogleClient(googleAccountId);

  // Try both the exact resource name and the wildcard-account variant,
  // matching the fallback pattern used by fetchReviews.
  const endpoints = [
    `https://mybusiness.googleapis.com/v4/${reviewResourceName}`,
    `https://mybusiness.googleapis.com/v4/${reviewResourceName.replace(/^accounts\/[^/]+\//, "accounts/-/")}`,
  ];

  let lastError: unknown;

  for (const url of endpoints) {
    try {
      const response = await oauth2Client.request<GBPReview>({
        url,
        method: "GET",
      });
      return response.data;
    } catch (err) {
      lastError = err;
      const status = (err as { response?: { status?: number } }).response?.status;
      console.warn(`[google-reviews] fetchSingleReview failed with ${url} (status: ${status}), trying next...`);
    }
  }

  throw lastError;
}

export async function publishReviewReply(
  googleAccountId: string,
  reviewResourceName: string,
  comment: string
): Promise<void> {
  const oauth2Client = await createGoogleClient(googleAccountId);

  // Try both endpoints
  const endpoints = [
    `https://mybusiness.googleapis.com/v4/${reviewResourceName}/reply`,
    `https://mybusinessreviews.googleapis.com/v1/${reviewResourceName}/reply`,
  ];

  let lastError: unknown;

  for (const url of endpoints) {
    try {
      await oauth2Client.request({
        url,
        method: "PUT",
        data: { comment },
      });
      return;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}
