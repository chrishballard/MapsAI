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

// --- Service functions ---

interface StructuredServiceInfo {
  serviceTypeId: string;
  displayName: string;
}

function titleCase(str: string): string {
  return str
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export async function fetchStructuredServices(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<StructuredServiceInfo[]> {
  try {
    const oauth2Client = await createGoogleClient(params.googleAccountId);

    const response = await oauth2Client.request<{
      serviceItems?: Array<{
        structuredServiceItem?: {
          serviceTypeId: string;
          description?: string;
        };
        freeFormServiceItem?: unknown;
      }>;
    }>({
      url: `https://mybusinessbusinessinformation.googleapis.com/v1/${params.locationName}?readMask=serviceItems`,
      method: "GET",
    });

    const serviceItems = response.data.serviceItems || [];

    return serviceItems
      .filter((item) => item.structuredServiceItem)
      .map((item) => ({
        serviceTypeId: item.structuredServiceItem!.serviceTypeId,
        displayName: titleCase(item.structuredServiceItem!.serviceTypeId),
      }));
  } catch {
    return [];
  }
}

export async function fetchCurrentServices(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<{ serviceItems: unknown[] }> {
  try {
    const oauth2Client = await createGoogleClient(params.googleAccountId);

    const response = await oauth2Client.request<{
      serviceItems?: unknown[];
    }>({
      url: `https://mybusinessbusinessinformation.googleapis.com/v1/${params.locationName}?readMask=serviceItems`,
      method: "GET",
    });

    return { serviceItems: response.data.serviceItems || [] };
  } catch {
    return { serviceItems: [] };
  }
}

export async function pushServicesToGBP(params: {
  googleAccountId: string;
  locationName: string;
  serviceItems: unknown[];
}): Promise<{ success: boolean; error?: string }> {
  try {
    const oauth2Client = await createGoogleClient(params.googleAccountId);

    await oauth2Client.request({
      url: `https://mybusinessbusinessinformation.googleapis.com/v1/${params.locationName}?updateMask=serviceItems`,
      method: "PATCH",
      data: {
        serviceItems: params.serviceItems,
      },
    });

    return { success: true };
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error pushing services to GBP";
    return { success: false, error: message };
  }
}
