import { createGoogleClient } from "./google";

export async function fetchCurrentDescription(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<string | null> {
  try {
    const oauth2Client = await createGoogleClient(params.googleAccountId);

    const response = await oauth2Client.request<{
      profile?: { description?: string };
    }>({
      url: `https://mybusinessbusinessinformation.googleapis.com/v1/${params.locationName}?readMask=profile`,
      method: "GET",
    });

    return response.data.profile?.description ?? null;
  } catch {
    return null;
  }
}

export async function pushDescriptionToGBP(params: {
  googleAccountId: string;
  locationName: string;
  description: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const oauth2Client = await createGoogleClient(params.googleAccountId);

    await oauth2Client.request({
      url: `https://mybusinessbusinessinformation.googleapis.com/v1/${params.locationName}?updateMask=profile.description`,
      method: "PATCH",
      data: {
        profile: {
          description: params.description,
        },
      },
    });

    return { success: true };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error pushing to GBP";
    return { success: false, error: message };
  }
}
