import { createGoogleClient } from "./google";
import { describeGoogleError } from "./google-errors";
import { MAX_SERVICE_AREA_PLACES } from "./gbp-limits";

export interface GBPWriteResult {
  success: boolean;
  error?: string;
}

interface LocationWriteParams {
  googleAccountId: string;
  locationName: string;
  /**
   * Ask Google to validate the request and return without changing the
   * profile. Google documents this as a full validation pass, so it is the
   * way to exercise a new payload shape against a live client profile
   * safely. Defaults to false.
   */
  validateOnly?: boolean;
}

export interface GBPTimeOfDay {
  hours?: number;
  minutes?: number;
  seconds?: number;
  nanos?: number;
}

export interface GBPTimePeriod {
  openDay: string;
  openTime: GBPTimeOfDay;
  closeDay: string;
  closeTime: GBPTimeOfDay;
}

export interface GBPBusinessHours {
  periods: GBPTimePeriod[];
}

export interface GBPDate {
  year?: number;
  month?: number;
  day?: number;
}

export interface GBPSpecialHourPeriod {
  startDate: GBPDate;
  endDate?: GBPDate;
  openTime?: GBPTimeOfDay;
  closeTime?: GBPTimeOfDay;
  closed?: boolean;
}

export interface GBPSpecialHours {
  specialHourPeriods: GBPSpecialHourPeriod[];
}

export interface GBPCategory {
  name: string;
  displayName?: string;
}

export interface GBPCategories {
  primaryCategory?: GBPCategory;
  additionalCategories?: GBPCategory[];
}

export interface GBPPhoneNumbers {
  primaryPhone: string;
  additionalPhones?: string[];
}

export interface GBPPlaceInfo {
  placeId: string;
  placeName?: string;
}

export interface GBPServiceArea {
  businessType?: string;
  places?: { placeInfos?: GBPPlaceInfo[] };
  regionCode?: string;
}

const BUSINESS_INFO_BASE =
  "https://mybusinessbusinessinformation.googleapis.com/v1";

/**
 * Read any set of Location fields in one call. `readMask` takes the same
 * field paths as updateMask; note that `attributes` is NOT a Location field
 * and 400s here (see fetchAttributes for the endpoints that serve it).
 */
async function getLocationFields<T>(
  params: { googleAccountId: string; locationName: string },
  readMask: string
): Promise<T> {
  const oauth2Client = await createGoogleClient(params.googleAccountId);
  const response = await oauth2Client.request<T>({
    url: `${BUSINESS_INFO_BASE}/${params.locationName}?readMask=${encodeURIComponent(readMask)}`,
    method: "GET",
  });
  return response.data;
}

/** Single PATCH path for every Location field write. Never throws. */
async function patchLocation(
  params: LocationWriteParams,
  updateMask: string,
  body: Record<string, unknown>,
  fallbackError: string
): Promise<GBPWriteResult> {
  try {
    const oauth2Client = await createGoogleClient(params.googleAccountId);
    const validate = params.validateOnly ? "&validateOnly=true" : "";

    await oauth2Client.request({
      url: `${BUSINESS_INFO_BASE}/${params.locationName}?updateMask=${encodeURIComponent(updateMask)}${validate}`,
      method: "PATCH",
      data: body,
    });

    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: describeGoogleError(error, fallbackError) };
  }
}


export async function fetchCurrentDescription(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<string | null> {
  const data = await getLocationFields<{ profile?: { description?: string } }>(
    params,
    "profile"
  );
  return data.profile?.description ?? null;
}

export async function pushDescriptionToGBP(
  params: LocationWriteParams & { description: string }
): Promise<GBPWriteResult> {
  return patchLocation(
    params,
    "profile.description",
    { profile: { description: params.description } },
    "Unknown error pushing to GBP"
  );
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

export async function fetchCategoryId(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<string | null> {
  const data = await getLocationFields<{
    categories?: { primaryCategory?: { name?: string } };
  }>(params, "categories");
  return data.categories?.primaryCategory?.name ?? null;
}

export async function fetchStructuredServices(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<StructuredServiceInfo[]> {
  const oauth2Client = await createGoogleClient(params.googleAccountId);

  // First: get the location's primary category
  const locationResponse = await oauth2Client.request<{
    categories?: {
      primaryCategory?: {
        name?: string;
        displayName?: string;
        serviceTypes?: Array<{
          serviceTypeId: string;
          displayName: string;
        }>;
      };
    };
  }>({
    url: `${BUSINESS_INFO_BASE}/${params.locationName}?readMask=categories`,
    method: "GET",
  });

  const primaryCategory = locationResponse.data.categories?.primaryCategory;

  // If category has serviceTypes directly, use those
  if (primaryCategory?.serviceTypes && primaryCategory.serviceTypes.length > 0) {
    return primaryCategory.serviceTypes.map((st) => ({
      serviceTypeId: st.serviceTypeId,
      displayName: st.displayName,
    }));
  }

  // Fallback: try to get service types from categories batchGet
  if (primaryCategory?.name) {
    try {
      const catResponse = await oauth2Client.request<{
        categories?: Array<{
          name: string;
          displayName: string;
          serviceTypes?: Array<{
            serviceTypeId: string;
            displayName: string;
          }>;
        }>;
      }>({
        url: `${BUSINESS_INFO_BASE}/categories:batchGet?names=${encodeURIComponent(primaryCategory.name)}&languageCode=en`,
        method: "GET",
      });

      const category = catResponse.data.categories?.[0];
      if (category?.serviceTypes && category.serviceTypes.length > 0) {
        return category.serviceTypes.map((st) => ({
          serviceTypeId: st.serviceTypeId,
          displayName: st.displayName,
        }));
      }
    } catch {
      // batchGet failed, continue to fallback
    }
  }

  // Final fallback: read currently set services
  const response = await oauth2Client.request<{
    serviceItems?: Array<{
      structuredServiceItem?: {
        serviceTypeId: string;
        description?: string;
      };
      freeFormServiceItem?: unknown;
    }>;
  }>({
    url: `${BUSINESS_INFO_BASE}/${params.locationName}?readMask=serviceItems`,
    method: "GET",
  });

  const serviceItems = response.data.serviceItems || [];

  return serviceItems
    .filter((item) => item.structuredServiceItem)
    .map((item) => {
      const rawId = item.structuredServiceItem!.serviceTypeId;
      const lastSegment = rawId.includes("/") ? rawId.split("/").pop()! : rawId;
      const displayName = lastSegment.replace(/_/g, " ");
      return {
        serviceTypeId: rawId,
        displayName,
      };
    });
}

export async function fetchCurrentServices(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<{ serviceItems: unknown[] }> {
  const data = await getLocationFields<{ serviceItems?: unknown[] }>(
    params,
    "serviceItems"
  );
  return { serviceItems: data.serviceItems || [] };
}

export async function pushServicesToGBP(
  params: LocationWriteParams & { serviceItems: unknown[] }
): Promise<GBPWriteResult> {
  return patchLocation(
    params,
    "serviceItems",
    { serviceItems: params.serviceItems },
    "Unknown error pushing services to GBP"
  );
}

// --- Attribute functions ---
//
// Attributes are NOT a field on the Location resource: `?readMask=attributes`
// answers 400 `read_mask: "Invalid field mask provided"`. They live behind two
// endpoints, and both are needed — the first says what is set, the second says
// what could be set, which is what turns "not set" into a recommendation:
//
//   GET  {location}/attributes          the attributes currently set
//   GET  /v1/attributes?parent={location}
//        the catalog available for this location's primary category
//
// On the catalog call, `parent` is mutually exclusive with categoryName,
// regionCode, languageCode and showAll — sending languageCode alongside it
// fails with `language_code: "Field must not be set when parent is set."`
//
// Google identifies an attribute by resource name (`attributes/{id}`), in
// `name` on the set-attributes response and in `parent` on the catalog
// response. This module exposes the bare id as `attributeId` (the shape the
// app's API and onboarding UI already use) and re-adds the prefix on write.

/** One attribute as returned by GET {location}/attributes. */
interface GBPAttributeValue {
  /** Resource name, e.g. "attributes/has_wheelchair_accessible_entrance". */
  name: string;
  valueType: GBPAttributeValueType;
  values?: unknown[];
  repeatedEnumValue?: {
    setValues?: string[];
    unsetValues?: string[];
  };
  uriValues?: Array<{ uri: string }>;
}

/** One entry of the catalog returned by GET /v1/attributes?parent=. */
interface GBPAttributeMetadata {
  /** Resource name of the attribute — the catalog's id field is `parent`. */
  parent: string;
  valueType: GBPAttributeValueType;
  displayName?: string;
  groupDisplayName?: string;
  repeatable?: boolean;
  deprecated?: boolean;
  valueMetadata?: Array<{
    value: unknown;
    displayName?: string;
  }>;
}

export type GBPAttributeValueType = "BOOL" | "ENUM" | "REPEATED_ENUM" | "URL";

export interface GBPAttribute {
  /** Bare id, without the "attributes/" prefix. */
  attributeId: string;
  displayName: string;
  groupDisplayName: string;
  valueType: GBPAttributeValueType;
  currentValue: unknown;
  valueMetadata?: Array<{ value: unknown; displayName?: string }>;
}

/** "attributes/has_parking_lot_free" -> "has_parking_lot_free" (idempotent). */
function bareAttributeId(resourceName: string): string {
  return resourceName.startsWith("attributes/")
    ? resourceName.slice("attributes/".length)
    : resourceName;
}

/** Inverse of bareAttributeId; accepts either form. */
function attributeResourceName(attributeId: string): string {
  return attributeId.startsWith("attributes/")
    ? attributeId
    : `attributes/${attributeId}`;
}

export async function fetchAttributes(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<{ attributes: GBPAttribute[]; error?: string }> {
  try {
    const oauth2Client = await createGoogleClient(params.googleAccountId);

    // What is set on the location right now.
    const setResponse = await oauth2Client.request<{
      attributes?: GBPAttributeValue[];
    }>({
      url: `${BUSINESS_INFO_BASE}/${params.locationName}/attributes`,
      method: "GET",
    });
    const setAttributes = setResponse.data.attributes ?? [];

    // What Google offers for this location's primary category. A failure here
    // is not fatal: the caller still gets the attributes that are set, just
    // without the unset ones to recommend.
    const catalog: GBPAttributeMetadata[] = [];
    try {
      let pageToken: string | undefined;
      do {
        const url =
          `${BUSINESS_INFO_BASE}/attributes` +
          `?parent=${encodeURIComponent(params.locationName)}&pageSize=200` +
          (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
        const page = await oauth2Client.request<{
          attributeMetadata?: GBPAttributeMetadata[];
          nextPageToken?: string;
        }>({ url, method: "GET" });
        catalog.push(...(page.data.attributeMetadata ?? []));
        pageToken = page.data.nextPageToken;
      } while (pageToken);
    } catch {
      // Catalog unavailable — fall through with the set attributes only.
    }

    const setById = new Map(
      setAttributes.map((a) => [bareAttributeId(a.name), a])
    );

    const merged = new Map<string, GBPAttribute>();

    // Catalog first so unset attributes are offered. Deprecated ones are
    // dropped: Google accepts updates to them without saving anything.
    for (const meta of catalog) {
      if (meta.deprecated) continue;
      const attributeId = bareAttributeId(meta.parent);
      merged.set(attributeId, {
        attributeId,
        displayName: meta.displayName || titleCase(attributeId),
        groupDisplayName: meta.groupDisplayName || "Other",
        valueType: meta.valueType,
        currentValue: readCurrentValue(meta.valueType, setById.get(attributeId)),
        valueMetadata: meta.valueMetadata,
      });
    }

    // Anything set but absent from the catalog still has to be shown, or the
    // next push would silently drop it from the mask.
    for (const attr of setAttributes) {
      const attributeId = bareAttributeId(attr.name);
      if (merged.has(attributeId)) continue;
      merged.set(attributeId, {
        attributeId,
        displayName: titleCase(attributeId),
        groupDisplayName: "Other",
        valueType: attr.valueType,
        currentValue: readCurrentValue(attr.valueType, attr),
      });
    }

    return { attributes: Array.from(merged.values()) };
  } catch (error: unknown) {
    return {
      attributes: [],
      error: describeGoogleError(error, "Unknown error fetching attributes"),
    };
  }
}

function readCurrentValue(
  valueType: GBPAttributeValueType,
  attr: GBPAttributeValue | undefined
): unknown {
  if (!attr) {
    return valueType === "REPEATED_ENUM"
      ? { setValues: [], unsetValues: [] }
      : null;
  }
  switch (valueType) {
    case "BOOL":
    case "ENUM":
      return attr.values?.[0] ?? null;
    case "REPEATED_ENUM":
      return attr.repeatedEnumValue ?? { setValues: [], unsetValues: [] };
    case "URL":
      return attr.uriValues?.[0]?.uri ?? null;
    default:
      // ATTRIBUTE_VALUE_TYPE_UNSPECIFIED, or a type Google adds later. Not
      // the same as "not set", but there is no value to read either.
      return null;
  }
}

export interface GBPAttributeWrite {
  /** Bare id or full resource name — both are accepted. */
  attributeId: string;
  valueType: GBPAttributeValueType;
  values?: unknown[];
  repeatedEnumValue?: {
    setValues?: string[];
    unsetValues?: string[];
  };
  uriValues?: Array<{ uri: string }>;
}

/**
 * Write attributes through locations.updateAttributes.
 *
 * Three things this endpoint needs that are easy to get wrong:
 *
 *  - `attributeMask` is a REQUIRED query parameter. It is built here from the
 *    attributes being sent, so attributes not in the payload are left exactly
 *    as they are. (An absent or empty mask means "all attributes", which would
 *    delete everything not included.)
 *  - each attribute is keyed by `name` ("attributes/{id}"), not `attributeId`.
 *  - `Attribute.valueType` is output-only. It is taken here to pick the right
 *    value field and then left out of the request.
 *
 * `removeAttributeIds` covers the delete case Google documents: an id in the
 * mask with no matching entry in the attributes list is removed.
 *
 * Unlike locations.patch, this method does NOT support validateOnly — the
 * discovery document lists only `name` and `attributeMask` — so there is no
 * way to dry-run it against a live profile.
 */
export async function pushAttributesToGBP(params: {
  googleAccountId: string;
  locationName: string;
  attributes: GBPAttributeWrite[];
  removeAttributeIds?: string[];
}): Promise<GBPWriteResult> {
  const maskIds = [
    ...params.attributes.map((a) => attributeResourceName(a.attributeId)),
    ...(params.removeAttributeIds ?? []).map(attributeResourceName),
  ];

  if (maskIds.length === 0) {
    return { success: false, error: "No attributes to update" };
  }

  try {
    const oauth2Client = await createGoogleClient(params.googleAccountId);

    const attributes = params.attributes.map((attr) => {
      const base: Record<string, unknown> = {
        name: attributeResourceName(attr.attributeId),
      };
      if (attr.valueType === "BOOL" || attr.valueType === "ENUM") {
        base.values = attr.values;
      } else if (attr.valueType === "REPEATED_ENUM") {
        base.repeatedEnumValue = attr.repeatedEnumValue;
      } else if (attr.valueType === "URL") {
        base.uriValues = attr.uriValues;
      }
      return base;
    });

    await oauth2Client.request({
      url:
        `${BUSINESS_INFO_BASE}/${params.locationName}/attributes` +
        `?attributeMask=${encodeURIComponent(maskIds.join(","))}`,
      method: "PATCH",
      data: {
        name: `${params.locationName}/attributes`,
        attributes,
      },
    });

    return { success: true };
  } catch (error: unknown) {
    return {
      success: false,
      error: describeGoogleError(
        error,
        "Unknown error pushing attributes to GBP"
      ),
    };
  }
}

// --- Location field writes -------------------------------------------------
//
// Everything below PATCHes the Location resource through one helper. Each
// field has a fetch/push pair so a caller can read the current value, show it
// to a person, and push the edited version back.
//
// Policy (unchanged by this module): only description and services are ever
// pushed unattended. Hours, categories, service areas, attributes, website,
// name and phone get a person's eye before they go up.

// --- Regular hours ---

export async function fetchCurrentHours(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<GBPBusinessHours | null> {
  const data = await getLocationFields<{ regularHours?: GBPBusinessHours }>(
    params,
    "regularHours"
  );
  return data.regularHours ?? null;
}

export async function pushHoursToGBP(
  params: LocationWriteParams & { regularHours: GBPBusinessHours }
): Promise<GBPWriteResult> {
  return patchLocation(
    params,
    "regularHours",
    { regularHours: params.regularHours },
    "Unknown error pushing hours to GBP"
  );
}

// --- Special hours ---

export async function fetchCurrentSpecialHours(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<GBPSpecialHours | null> {
  const data = await getLocationFields<{ specialHours?: GBPSpecialHours }>(
    params,
    "specialHours"
  );
  return data.specialHours ?? null;
}

export async function pushSpecialHoursToGBP(
  params: LocationWriteParams & { specialHours: GBPSpecialHours }
): Promise<GBPWriteResult> {
  return patchLocation(
    params,
    "specialHours",
    { specialHours: params.specialHours },
    "Unknown error pushing special hours to GBP"
  );
}

// --- Website ---

export async function fetchCurrentWebsiteUri(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<string | null> {
  const data = await getLocationFields<{ websiteUri?: string }>(
    params,
    "websiteUri"
  );
  return data.websiteUri ?? null;
}

export async function pushWebsiteToGBP(
  params: LocationWriteParams & { websiteUri: string }
): Promise<GBPWriteResult> {
  return patchLocation(
    params,
    "websiteUri",
    { websiteUri: params.websiteUri },
    "Unknown error pushing website to GBP"
  );
}

// --- Categories ---

export async function fetchCurrentCategories(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<GBPCategories | null> {
  const data = await getLocationFields<{ categories?: GBPCategories }>(
    params,
    "categories"
  );
  return data.categories ?? null;
}

/**
 * Replace the primary and additional categories in one write.
 *
 * The Categories schema says: "During updates, both fields must be set.
 * Clients are prohibited from individually updating the primary or additional
 * categories using the update mask." So both fields always go, and
 * additionalCategories is sent as an explicit [] rather than omitted when
 * there are none — omitting a field is not the same as sending it empty, and
 * clearing the additional categories has to actually clear them.
 *
 * Only `name` is sent: `displayName`, `serviceTypes` and `moreHoursTypes` are
 * output-only on Category and are ignored on write.
 */
export async function pushCategoriesToGBP(
  params: LocationWriteParams & {
    primaryCategoryId: string;
    additionalCategoryIds?: string[];
  }
): Promise<GBPWriteResult> {
  const categories: GBPCategories = {
    primaryCategory: { name: params.primaryCategoryId },
    additionalCategories: (params.additionalCategoryIds ?? []).map((name) => ({
      name,
    })),
  };

  return patchLocation(
    params,
    "categories",
    { categories },
    "Unknown error pushing categories to GBP"
  );
}

// --- Business name ---

export async function fetchCurrentTitle(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<string | null> {
  const data = await getLocationFields<{ title?: string }>(params, "title");
  return data.title ?? null;
}

export async function pushTitleToGBP(
  params: LocationWriteParams & { title: string }
): Promise<GBPWriteResult> {
  return patchLocation(
    params,
    "title",
    { title: params.title },
    "Unknown error pushing business name to GBP"
  );
}

// --- Phone numbers ---

export async function fetchCurrentPhoneNumbers(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<GBPPhoneNumbers | null> {
  const data = await getLocationFields<{ phoneNumbers?: GBPPhoneNumbers }>(
    params,
    "phoneNumbers"
  );
  return data.phoneNumbers ?? null;
}

/**
 * Replace the phone numbers.
 *
 * The PhoneNumbers schema says: "During updates, both fields must be set.
 * Clients may not update just the primary or additional phone numbers using
 * the update mask." So additionalPhones is sent as an explicit [] rather than
 * omitted when there are none, which is what actually clears the secondary
 * numbers on the profile.
 */
export async function pushPhoneNumbersToGBP(
  params: LocationWriteParams & {
    primaryPhone: string;
    additionalPhones?: string[];
  }
): Promise<GBPWriteResult> {
  const phoneNumbers: GBPPhoneNumbers = {
    primaryPhone: params.primaryPhone,
    additionalPhones: params.additionalPhones ?? [],
  };

  return patchLocation(
    params,
    "phoneNumbers",
    { phoneNumbers },
    "Unknown error pushing phone numbers to GBP"
  );
}

// --- Service area ---

export async function fetchCurrentServiceArea(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<GBPServiceArea | null> {
  const data = await getLocationFields<{ serviceArea?: GBPServiceArea }>(
    params,
    "serviceArea"
  );
  return data.serviceArea ?? null;
}

/**
 * Replace the places a service-area business serves.
 *
 * The mask is `serviceArea.places`, NOT `serviceArea`.
 *
 * What was observed, probed against one live profile on 2026-09-14 with
 * validateOnly=true (Badger Gutters Harris Blvd, businessType
 * CUSTOMER_AND_BUSINESS_LOCATION, storefrontAddress set, 20 places): every
 * payload under the whole `serviceArea` mask was rejected 400
 * INVALID_ARGUMENT with
 *
 *   field: "service_area"
 *   description: "Storefront_address must be explicitly set to empty for
 *                 pure service area business."
 *
 * — a full echo of the current value, placeInfos reduced to placeId, and
 * businessType alone all failed that way, and businessType alone also added
 * `service_area.places: "Field is required"`. `updateMask=serviceArea.places`
 * validated clean. That is one profile's result, not a proven law about the
 * API; the likely mechanism is that ServiceAreaBusiness.businessType is a
 * required field, so a whole-object write is evaluated as a business-type
 * transition and Google applies the CUSTOMER_LOCATION_ONLY rule that the
 * storefront address be cleared in the same call. Narrowing the mask leaves
 * businessType alone, which is why this function cannot convert the business
 * type or drop the address whatever it is handed.
 *
 * Changing businessType itself (storefront <-> pure service area) is
 * deliberately not implemented: it needs `storefrontAddress` in the same
 * update mask and would delete the client's address.
 *
 * On placeName: the PlaceInfo schema marks it Required, and a placeId-only
 * payload validated clean anyway. Do not read that as "placeName is
 * optional" — validateOnly does enforce required fields here (the same probe
 * run returned `service_area.places: "Field is required"`), but it is one
 * observation and a real write may differ. So placeName is accepted and
 * passed through whenever the caller has it, which it does when the places
 * came from fetchCurrentServiceArea.
 *
 * Google caps the list at 20 (TOO_MANY_ENTRIES, max_count: 20); that is
 * checked here first so the caller gets a readable error.
 */
export async function pushServiceAreaToGBP(
  params: LocationWriteParams & {
    places: Array<{ placeId: string; placeName?: string }>;
  }
): Promise<GBPWriteResult> {
  if (params.places.length === 0) {
    return {
      success: false,
      error: "At least one place is required to set a service area",
    };
  }
  if (params.places.length > MAX_SERVICE_AREA_PLACES) {
    return {
      success: false,
      error: `Google allows at most ${MAX_SERVICE_AREA_PLACES} service-area places (got ${params.places.length})`,
    };
  }

  // A location that is not a service-area business has no businessType, and
  // the narrow mask cannot supply one — the write would leave a serviceArea
  // with places and no required businessType. Only profiles that already had
  // places were ever probed, so refuse the untested case rather than find out
  // on a client's listing.
  let current: GBPServiceArea | null;
  try {
    current = await fetchCurrentServiceArea(params);
  } catch (error: unknown) {
    return {
      success: false,
      error: describeGoogleError(
        error,
        "Could not read the current service area before writing"
      ),
    };
  }

  const businessType = current?.businessType;
  if (!businessType || businessType === "BUSINESS_TYPE_UNSPECIFIED") {
    return {
      success: false,
      error:
        "This location is not set up as a service-area business, and the " +
        "serviceArea.places mask cannot set the required businessType. Set " +
        "the business type in the Google Business Profile UI first.",
    };
  }

  return patchLocation(
    params,
    "serviceArea.places",
    {
      serviceArea: {
        places: {
          placeInfos: params.places.map((place) =>
            place.placeName
              ? { placeId: place.placeId, placeName: place.placeName }
              : { placeId: place.placeId }
          ),
        },
      },
    },
    "Unknown error pushing service area to GBP"
  );
}
