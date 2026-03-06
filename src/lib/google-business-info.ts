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

// --- Attribute functions ---

interface GBPAttributeValue {
  attributeId: string;
  valueType: "BOOL" | "ENUM" | "REPEATED_ENUM" | "URL";
  values?: unknown[];
  repeatedEnumValue?: {
    setValues?: string[];
    unsetValues?: string[];
  };
  uriValues?: Array<{ uri: string }>;
}

interface GBPAttributeMetadata {
  attributeId: string;
  valueType: "BOOL" | "ENUM" | "REPEATED_ENUM" | "URL";
  displayName?: string;
  groupDisplayName?: string;
  valueMetadata?: Array<{
    value: string;
    displayName?: string;
  }>;
}

export interface GBPAttribute {
  attributeId: string;
  displayName: string;
  groupDisplayName: string;
  valueType: "BOOL" | "ENUM" | "REPEATED_ENUM" | "URL";
  currentValue: unknown;
  valueMetadata?: Array<{ value: string; displayName?: string }>;
}

export async function fetchAttributes(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<{ attributes: GBPAttribute[]; error?: string }> {
  try {
    const oauth2Client = await createGoogleClient(params.googleAccountId);

    const response = await oauth2Client.request<{
      attributes?: Array<GBPAttributeValue & GBPAttributeMetadata>;
    }>({
      url: `https://mybusinessbusinessinformation.googleapis.com/v1/${params.locationName}/attributes`,
      method: "GET",
    });

    const rawAttributes = response.data.attributes || [];

    if (rawAttributes.length === 0) {
      return { attributes: [] };
    }

    const attributes: GBPAttribute[] = rawAttributes.map((attr) => {
      let currentValue: unknown = null;

      switch (attr.valueType) {
        case "BOOL":
          currentValue = attr.values?.[0] ?? null;
          break;
        case "ENUM":
          currentValue = attr.values?.[0] ?? null;
          break;
        case "REPEATED_ENUM":
          currentValue = attr.repeatedEnumValue ?? {
            setValues: [],
            unsetValues: [],
          };
          break;
        case "URL":
          currentValue = attr.uriValues?.[0]?.uri ?? null;
          break;
      }

      return {
        attributeId: attr.attributeId,
        displayName: attr.displayName || titleCase(attr.attributeId),
        groupDisplayName: attr.groupDisplayName || "Other",
        valueType: attr.valueType,
        currentValue,
        valueMetadata: attr.valueMetadata,
      };
    });

    return { attributes };
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error fetching attributes";
    return { attributes: [], error: message };
  }
}

export async function pushAttributesToGBP(params: {
  googleAccountId: string;
  locationName: string;
  attributes: Array<{
    attributeId: string;
    valueType: string;
    values?: unknown[];
    repeatedEnumValue?: {
      setValues?: string[];
      unsetValues?: string[];
    };
    uriValues?: Array<{ uri: string }>;
  }>;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const oauth2Client = await createGoogleClient(params.googleAccountId);

    const body = {
      attributes: params.attributes.map((attr) => {
        const base: Record<string, unknown> = {
          attributeId: attr.attributeId,
          valueType: attr.valueType,
        };
        if (attr.valueType === "BOOL" || attr.valueType === "ENUM") {
          base.values = attr.values;
        } else if (attr.valueType === "REPEATED_ENUM") {
          base.repeatedEnumValue = attr.repeatedEnumValue;
        } else if (attr.valueType === "URL") {
          base.uriValues = attr.uriValues;
        }
        return base;
      }),
    };

    await oauth2Client.request({
      url: `https://mybusinessbusinessinformation.googleapis.com/v1/${params.locationName}/attributes`,
      method: "PATCH",
      data: body,
    });

    return { success: true };
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error pushing attributes to GBP";
    return { success: false, error: message };
  }
}
