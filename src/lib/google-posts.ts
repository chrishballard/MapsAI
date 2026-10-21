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
  createTime?: string;
  [key: string]: unknown;
}

interface ListGBPPostsParams {
  googleAccountId: string;
  accountResourceName: string; // e.g. "accounts/123"
  locationName: string; // e.g. "locations/456"
}

// Google returns at most 100 posts a page. Five pages covers years of posts
// on one location; the cap keeps a token that never runs out from looping.
const LIST_POSTS_MAX_PAGES = 5;

/**
 * List the live posts on a location (newest first, up to
 * LIST_POSTS_MAX_PAGES pages of 100). Used as a pre-publish safety check so
 * a retried job never creates a duplicate of a post that already made it to
 * Google. A failed page throws rather than return a partial list; past the
 * page cap the oldest posts are simply not read.
 */
export async function listGBPPosts(
  params: ListGBPPostsParams
): Promise<GBPLocalPost[]> {
  const { googleAccountId, accountResourceName, locationName } = params;

  const oauth2Client = await createGoogleClient(googleAccountId);

  const parent = `${accountResourceName}/${locationName}`;
  const posts: GBPLocalPost[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < LIST_POSTS_MAX_PAGES; page++) {
    const url =
      `https://mybusiness.googleapis.com/v4/${parent}/localPosts?pageSize=100` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");

    const response = await oauth2Client.request<{
      localPosts?: GBPLocalPost[];
      nextPageToken?: string;
    }>({
      url,
      method: "GET",
    });

    posts.push(...(response.data.localPosts ?? []));
    pageToken = response.data.nextPageToken || undefined;
    if (!pageToken) break;
  }

  return posts;
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
