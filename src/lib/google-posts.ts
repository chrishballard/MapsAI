import { createGoogleClient } from "./google";

interface CreateGBPPostParams {
  googleAccountId: string;
  accountResourceName: string; // e.g. "accounts/123"
  locationName: string; // e.g. "locations/456"
  summary: string;
  topicType: "STANDARD" | "EVENT" | "OFFER";
  callToAction?: { actionType: string; url?: string };
  // Google fetches each sourceUrl server-side at creation time, so the URL
  // must be publicly reachable (our public image route, or Google's own CDN
  // for photos synced from the profile).
  media?: Array<{ mediaFormat: "PHOTO"; sourceUrl: string }>;
}

interface GBPPostResponse {
  name: string; // The resource name of the created post (used as googlePostId)
  [key: string]: unknown;
}

export interface GBPLocalPost {
  name: string;
  summary?: string;
  topicType?: string;
  [key: string]: unknown;
}

interface ListGBPPostsParams {
  googleAccountId: string;
  accountResourceName: string; // e.g. "accounts/123"
  locationName: string; // e.g. "locations/456"
}

/**
 * List the live posts on a location (first page, newest first).
 * Used as a pre-publish safety check so a retried job never creates a
 * duplicate of a post that already made it to Google.
 */
export async function listGBPPosts(
  params: ListGBPPostsParams
): Promise<GBPLocalPost[]> {
  const { googleAccountId, accountResourceName, locationName } = params;

  const oauth2Client = await createGoogleClient(googleAccountId);

  const parent = `${accountResourceName}/${locationName}`;
  const url = `https://mybusiness.googleapis.com/v4/${parent}/localPosts?pageSize=100`;

  const response = await oauth2Client.request<{ localPosts?: GBPLocalPost[] }>({
    url,
    method: "GET",
  });

  return response.data.localPosts ?? [];
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
    media,
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

  if (media && media.length > 0) {
    body.media = media;
  }

  const response = await oauth2Client.request<GBPPostResponse>({
    url,
    method: "POST",
    data: body,
  });

  return response.data;
}
