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
