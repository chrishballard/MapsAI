import { createGoogleClient } from "./google";

interface CreateGBPPostParams {
  googleAccountId: string;
  accountResourceName: string; // e.g. "accounts/123"
  locationName: string; // e.g. "locations/456"
  summary: string;
  topicType: "STANDARD" | "EVENT" | "OFFER";
  callToAction?: { actionType: string; url?: string };
}

interface GBPPostResponse {
  name: string; // The resource name of the created post (used as googlePostId)
  [key: string]: unknown;
}

export async function createGBPPost(
  params: CreateGBPPostParams
): Promise<GBPPostResponse> {
  const {
    googleAccountId,
    accountResourceName,
    locationName,
    summary,
    topicType,
    callToAction,
  } = params;

  const oauth2Client = await createGoogleClient(googleAccountId);

  const parent = `${accountResourceName}/${locationName}`;
  const url = `https://mybusiness.googleapis.com/v4/${parent}/localPosts`;

  const body: Record<string, unknown> = {
    languageCode: "en-US",
    summary,
    topicType,
  };

  if (callToAction) {
    body.callToAction = callToAction;
  }

  const response = await oauth2Client.request<GBPPostResponse>({
    url,
    method: "POST",
    data: body,
  });

  return response.data;
}

export interface GBPPostCallToAction {
  actionType: string;
  url?: string;
}

export interface GBPPost {
  name: string; // Full resource name e.g. "accounts/123/locations/456/localPosts/789"
  languageCode?: string;
  summary?: string;
  topicType?: "STANDARD" | "EVENT" | "OFFER" | "ALERT";
  state?: "LOCAL_POST_STATE_UNSPECIFIED" | "REJECTED" | "LIVE" | "PROCESSING";
  callToAction?: GBPPostCallToAction;
  createTime?: string;
  updateTime?: string;
  [key: string]: unknown;
}

interface FetchPostsApiResponse {
  localPosts?: GBPPost[];
  nextPageToken?: string;
}

export interface FetchPostsParams {
  googleAccountId: string;
  accountResourceName: string; // e.g. "accounts/123"
  locationName: string; // e.g. "locations/456"
  pageToken?: string;
  pageSize?: number; // default 50, max per GBP API is 100
}

export interface FetchPostsResult {
  posts: GBPPost[];
  nextPageToken?: string;
}

/**
 * List local posts for a single GBP location. Read-side counterpart to
 * {@link createGBPPost}. Mirrors {@link fetchReviews} in `google-reviews.ts`:
 * single page per call, caller advances via `pageToken`.
 *
 * GBP v4 endpoint:
 *   GET https://mybusiness.googleapis.com/v4/{accountResourceName}/{locationName}/localPosts
 * Reference: https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts/list
 */
export async function fetchPosts(
  params: FetchPostsParams
): Promise<FetchPostsResult> {
  const {
    googleAccountId,
    accountResourceName,
    locationName,
    pageToken,
    pageSize = 50,
  } = params;

  const oauth2Client = await createGoogleClient(googleAccountId);

  const parent = `${accountResourceName}/${locationName}`;
  let url = `https://mybusiness.googleapis.com/v4/${parent}/localPosts?pageSize=${pageSize}`;
  if (pageToken) {
    url += `&pageToken=${encodeURIComponent(pageToken)}`;
  }

  const response = await oauth2Client.request<FetchPostsApiResponse>({
    url,
    method: "GET",
  });

  return {
    posts: response.data.localPosts ?? [],
    nextPageToken: response.data.nextPageToken,
  };
}
