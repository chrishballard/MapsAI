import { createGoogleClient } from "./google";
import { describeGoogleError } from "./google-errors";
import { MAX_SERVICE_AREA_PLACES } from "./gbp-limits";

export interface GBPWriteResult {
  success: boolean;
  error?: string;
  /**
   * True when Google accepted the write but something afterwards went wrong,
   * so the profile HAS changed even though success is false. Only the
   * storefront read-back sets it (see verifyStorefrontSurvived). A caller
   * seeing this must not retry: the edit already landed, and what is needed
   * is a person looking at the listing.
   */
  wrote?: boolean;
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

/**
 * Google's PostalAddress, deliberately opaque. The only thing this file ever
 * does with an address is read one off a profile and echo it straight back in
 * the same shape (see pushServiceAreaToGBP), so naming the fields here would
 * risk silently dropping one Google sent — sublocality, sortingCode, revision,
 * recipients — and rewriting the client's address as a side effect of a
 * service-area write.
 */
export type GBPPostalAddress = Record<string, unknown>;

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

/**
 * Refuse any write that would take the client's address off their map pin.
 *
 * Losing a storefront address is the one unrecoverable mistake in this file:
 * the pin stops showing a location, the business turns into a service-area
 * listing, and getting it back means re-verification by postcard. Google
 * hands out three separate ways to do it by accident, so this runs on the
 * mask and body of EVERY Location write, validateOnly included, before
 * anything leaves the process. Returns the reason to refuse, or null.
 *
 * 1. businessType CUSTOMER_LOCATION_ONLY is the pure-service-area conversion.
 *    It hides the address by definition. Nothing in this codebase has a
 *    reason to send it: a business that is already service-area-only keeps
 *    its type through the serviceArea.places mask, which never names one.
 *
 * 2. The whole-object `serviceArea` mask WITHOUT storefrontAddress alongside
 *    it. This is the quiet one. Probed 2026-09-15 on Badger Gutters Park Rd:
 *    Google answered HTTP 200 to a payload that explicitly said
 *    CUSTOMER_AND_BUSINESS_LOCATION and echoed back CUSTOMER_LOCATION_ONLY,
 *    having overridden it. A caller checking only the status code would read
 *    that as success.
 *
 * 3. storefrontAddress named in the mask but empty, null, or simply absent
 *    from the body. Under a field mask a named-but-missing field means
 *    "clear this", which is exactly the "Storefront_address must be
 *    explicitly set to empty" state Google's own error message describes.
 *
 * If a genuine pure-service-area client ever needs converting, that is a
 * deliberate new function with its own probe and its own confirmation step,
 * not a relaxation of this guard.
 */
export function storefrontRemovalRisk(
  updateMask: string,
  body: Record<string, unknown>
): string | null {
  const fields = updateMask.split(",").map((f) => f.trim());
  const names = (field: string) =>
    fields.some((f) => f === field || f.startsWith(`${field}.`));

  const serviceArea = body.serviceArea as { businessType?: unknown } | undefined;
  if (serviceArea?.businessType === "CUSTOMER_LOCATION_ONLY") {
    return (
      "Refused: writing businessType CUSTOMER_LOCATION_ONLY converts the " +
      "profile to a pure service-area business and takes the address off the " +
      "map pin."
    );
  }

  if (fields.includes("serviceArea") && !names("storefrontAddress")) {
    return (
      "Refused: updateMask=serviceArea without storefrontAddress. Google " +
      "coerces businessType to CUSTOMER_LOCATION_ONLY on this shape and " +
      "answers 200, so it would hide the address while reporting success."
    );
  }

  if (names("storefrontAddress")) {
    const address = body.storefrontAddress;
    const empty =
      address === null ||
      address === undefined ||
      (typeof address === "object" && Object.keys(address).length === 0);
    if (empty) {
      return (
        "Refused: storefrontAddress is named in the update mask with no " +
        "address in the body, which under a field mask clears it."
      );
    }
  }

  return null;
}

/**
 * Single PATCH path for every Location field write. Never throws.
 *
 * Every write goes through storefrontRemovalRisk first. That check lives here
 * rather than in each push helper on purpose: this is the one door, so a push
 * added later is covered without its author having to know to ask.
 */
async function patchLocation(
  params: LocationWriteParams,
  updateMask: string,
  body: Record<string, unknown>,
  fallbackError: string
): Promise<GBPWriteResult> {
  const risk = storefrontRemovalRisk(updateMask, body);
  if (risk) return { success: false, error: risk };

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

/**
 * What Google currently holds for a location's description and service items.
 *
 * One `locations.get` with readMask=profile,serviceItems, so a caller looping
 * over an account spends one request per location instead of two.
 *
 * `description` is "" when Google returns the field empty and `serviceItems`
 * is [] when there are none — the caller distinguishes "Google says nothing
 * is set" from "we never asked", which is the whole point of storing it.
 */
export async function fetchGoogleProfileState(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<{ description: string; serviceItems: unknown[] }> {
  const oauth2Client = await createGoogleClient(params.googleAccountId);

  const response = await oauth2Client.request<{
    profile?: { description?: string };
    serviceItems?: unknown[];
  }>({
    url: `https://mybusinessbusinessinformation.googleapis.com/v1/${params.locationName}?readMask=profile,serviceItems`,
    method: "GET",
  });

  return {
    description: response.data.profile?.description ?? "",
    serviceItems: response.data.serviceItems ?? [],
  };
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
 * The serviceArea and the storefrontAddress in one read.
 *
 * A profile with no service area yet can only be given one by naming
 * storefrontAddress in the same update mask, and the address has to go back
 * byte-for-byte as Google gave it, so both fields are needed before the write
 * is shaped. One GET, because this account is rate-limited hard.
 */
async function fetchServiceAreaContext(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<{
  serviceArea: GBPServiceArea | null;
  storefrontAddress: GBPPostalAddress | null;
}> {
  const data = await getLocationFields<{
    serviceArea?: GBPServiceArea;
    storefrontAddress?: GBPPostalAddress;
  }>(params, "serviceArea,storefrontAddress");
  return {
    serviceArea: data.serviceArea ?? null,
    storefrontAddress: data.storefrontAddress ?? null,
  };
}

/**
 * Read the profile back after a write that named storefrontAddress, and say
 * what is wrong if the address did not come through untouched. Returns null
 * when it did.
 *
 * Three ways this fails, in descending severity: the address is gone, the
 * business type was coerced so Google hides it, or the address came back
 * DIFFERENT from what was sent. The third one is not a loss and it is easy to
 * wave away, which is exactly why it is checked: the standing rule is that we
 * echo the address and never edit it, so a reformat is still a change we
 * caused and a person should see it rather than have this code decide it was
 * harmless.
 *
 * storefrontRemovalRisk stops the shapes we know are dangerous before they
 * are sent. This is the other half: confirming what Google actually did with
 * a shape we believe is safe. The reason for both is shape 2 in
 * pushServiceAreaToGBP's notes — Google answered 200 to a payload while
 * silently overriding the businessType in it, so "Google accepted the write"
 * and "the write did what it said" are not the same claim.
 *
 * It cannot undo anything. What it buys is finding out in the same second
 * rather than whenever someone next looks at the listing.
 *
 * Only the from-zero path calls this, and only on a real write. The
 * serviceArea.places path names neither storefrontAddress nor businessType,
 * so there is nothing there for a read-back to catch, and a validateOnly call
 * changed nothing to check. Both would just spend quota on an account Google
 * rate-limits after about a dozen calls.
 */
async function verifyStorefrontSurvived(
  params: {
    googleAccountId: string;
    locationName: string;
  },
  before: GBPPostalAddress
): Promise<string | null> {
  let after: {
    serviceArea: GBPServiceArea | null;
    storefrontAddress: GBPPostalAddress | null;
  };
  try {
    after = await fetchServiceAreaContext(params);
  } catch (error: unknown) {
    // Unverified is not the same as broken, and must not read as either
    // "fine" or "the write failed".
    return (
      "The service area was written, but reading the profile back to confirm " +
      "the address survived FAILED, so the result is unverified. Check the " +
      "listing by hand. Read error: " +
      describeGoogleError(error, "unknown error")
    );
  }

  const address = after.storefrontAddress;
  if (!address || Object.keys(address).length === 0) {
    return (
      "ADDRESS GONE: the service area was written and the profile now has no " +
      "storefront address. The map pin has lost its location. Restore the " +
      "address in the Google Business Profile UI now."
    );
  }

  if (after.serviceArea?.businessType === "CUSTOMER_LOCATION_ONLY") {
    return (
      "BUSINESS TYPE CHANGED: the service area was written and the profile " +
      "came back as CUSTOMER_LOCATION_ONLY (pure service area) rather than " +
      "CUSTOMER_AND_BUSINESS_LOCATION. The address is still on the record " +
      "but Google hides it at this type. Fix it in the Google Business " +
      "Profile UI now."
    );
  }

  // Standing instruction from the operator, 2026-09-15: the address may be
  // named in a write only to send back exactly what Google already has. It is
  // never ours to edit. So "still present" is not a sufficient check —
  // anything different from what went in is a change we caused, even when
  // Google made it and even when it is only a reformat. Report it and let a
  // person judge it; do not decide for them that a reformat is harmless.
  if (JSON.stringify(sortedEntries(before)) !== JSON.stringify(sortedEntries(address))) {
    return (
      "ADDRESS CHANGED: the service area was written and the storefront " +
      "address came back different from what was sent. Nothing was lost, but " +
      "the listing no longer matches what it had. Before: " +
      `${JSON.stringify(before)} After: ${JSON.stringify(address)}. ` +
      "Google reformats multi-line addresses on this write path. Check the " +
      "listing and correct it by hand if the new form is wrong."
    );
  }

  return null;
}

/** Key-sorted entries, so a reordered object is not read as a change. */
function sortedEntries(value: GBPPostalAddress): Array<[string, unknown]> {
  return Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Replace the places a service-area business serves, or give a storefront
 * profile its first service area.
 *
 * Two different writes, chosen on whether the profile already has a service
 * area, because Google accepts a different mask in each case.
 *
 * PROFILE THAT ALREADY HAS PLACES — mask `serviceArea.places`.
 *
 * Probed against one live profile on 2026-09-14 with validateOnly=true
 * (Badger Gutters Harris Blvd, businessType CUSTOMER_AND_BUSINESS_LOCATION,
 * storefrontAddress set, 20 places): every payload under the whole
 * `serviceArea` mask was rejected 400 INVALID_ARGUMENT with
 *
 *   field: "service_area"
 *   description: "Storefront_address must be explicitly set to empty for
 *                 pure service area business."
 *
 * — a full echo of the current value, placeInfos reduced to placeId, and
 * businessType alone all failed that way, and businessType alone also added
 * `service_area.places: "Field is required"`. `updateMask=serviceArea.places`
 * validated clean, and again on 2026-09-15 when
 * scripts/gbp-validate-writes.ts passed nine of nine push paths against the
 * same profile. Narrowing the mask leaves businessType alone, which is why
 * that path cannot convert the business type or drop the address whatever it
 * is handed.
 *
 * PROFILE WITH NO SERVICE AREA AT ALL — mask `serviceArea,storefrontAddress`.
 *
 * The API can do this; the old guard here was ours, not Google's. Probed
 * 2026-09-15 with validateOnly=true against Badger Gutters Park Rd
 * (cmrmb5ugt008x1bnqoxkofr2h, storefrontAddress "4108 Park Rd"/"Suite 106"
 * Charlotte, `serviceArea` absent from the read entirely), sending one place,
 * Monroe NC. Four shapes, in full:
 *
 * 1. `updateMask=serviceArea.places` — 400 INVALID_ARGUMENT. Not the
 *    businessType complaint the 2026-09-14 run produced, a new one:
 *      field: "service_area"
 *      description: "Can't add an incomplete service area. Specify the whole
 *                    service_area field in the request"
 *    So the narrow mask is specifically a there-is-already-a-service-area
 *    path, and Google names the fix in the violation.
 *
 * 2. `updateMask=serviceArea` with
 *    `{businessType: "CUSTOMER_AND_BUSINESS_LOCATION", places: {...}}` —
 *    HTTP 200, validated. DO NOT USE IT. Google's echo came back
 *    `"businessType": "CUSTOMER_LOCATION_ONLY"`, overriding the hybrid type
 *    that was sent: without storefrontAddress in the mask it reads the write
 *    as "this is a service-area business" and coerces, which is the same
 *    pure-service-area rule the 2026-09-14 run hit as a hard 400. A real
 *    write of this shape would take the client's address off the listing and
 *    report success doing it.
 *
 * 3. `updateMask=serviceArea,storefrontAddress`, same serviceArea payload
 *    plus the storefrontAddress exactly as read back — HTTP 200, validated,
 *    and the echo kept `"businessType": "CUSTOMER_AND_BUSINESS_LOCATION"`.
 *    This is the shape used below. On the address: Google renormalised it in
 *    that echo, `["4108 Park Rd", "Suite 106"]` coming back as
 *    `["4108 Park Road Suite 106"]`. Two lines merged into one, same address.
 *    That looks to be specifically a multi-line merge rather than a rewrite
 *    of everything it is handed — see the live run below, where a
 *    single-line address came back untouched. Either way, naming
 *    storefrontAddress in a mask is not guaranteed to be a no-op, and there
 *    is no mask that adds a service area without naming it (2 is the only
 *    one that omits it, and 2 is the one that hides the address).
 *
 * 4. `updateMask=serviceArea.businessType` alone, as a two-step first half —
 *    400 INVALID_ARGUMENT, both violations at once:
 *      field: "service_area.places"  description: "Field is required"
 *      field: "service_area"         description: "Can't add an incomplete
 *                                     service area. Specify the whole
 *                                     service_area field in the request"
 *    There is no staging the type first; places must arrive in the same call.
 *
 * Still refused below: a profile with neither a service area nor a
 * storefrontAddress. Shape 3 has nothing to echo there, and the only legal
 * type left would be CUSTOMER_LOCATION_ONLY — unprobed, and not something to
 * find out on a client's listing. Converting an existing businessType
 * (storefront <-> pure service area) is likewise still not implemented: it
 * needs storefrontAddress cleared in the same mask, which deletes the
 * client's address.
 *
 * RUN LIVE 2026-09-15, once, on Nelson Roofing Salt Lake City
 * (locations/11997305859127494579, a business the operator owns). Its
 * service area was cleared by hand in the GBP dashboard to produce the
 * from-zero state — address present, `serviceArea` absent from the read
 * entirely — and shape 3 then wrote 14 places back. Afterwards:
 * businessType CUSTOMER_AND_BUSINESS_LOCATION, all 14 places exact, and the
 * storefrontAddress byte-identical to before, `["26 S Rio Grande St #2072"]`
 * unchanged. So a single-line address survived a shape-3 write untouched,
 * where Park Rd's two lines were merged under validateOnly. One live run,
 * one address shape; do not read it as a guarantee for every address.
 *
 * The rest is two profiles' behaviour under validateOnly, not a proven law
 * about the API. Google documents validateOnly as a full validation pass,
 * and shape 2's silent type coercion is a good reminder to read what comes
 * back rather than just the status code.
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

  // Which of the two writes applies depends on what the profile already has,
  // so the current value is read first either way.
  let current: {
    serviceArea: GBPServiceArea | null;
    storefrontAddress: GBPPostalAddress | null;
  };
  try {
    current = await fetchServiceAreaContext(params);
  } catch (error: unknown) {
    return {
      success: false,
      error: describeGoogleError(
        error,
        "Could not read the current service area before writing"
      ),
    };
  }

  const placeInfos = params.places.map((place) =>
    place.placeName
      ? { placeId: place.placeId, placeName: place.placeName }
      : { placeId: place.placeId }
  );

  const businessType = current.serviceArea?.businessType;
  const hasServiceArea =
    Boolean(businessType) && businessType !== "BUSINESS_TYPE_UNSPECIFIED";

  if (hasServiceArea) {
    return patchLocation(
      params,
      "serviceArea.places",
      { serviceArea: { places: { placeInfos } } },
      "Unknown error pushing service area to GBP"
    );
  }

  // From zero. Without an address to echo there is no validated shape left —
  // the mask that omits storefrontAddress is the one that hides it.
  if (!current.storefrontAddress) {
    return {
      success: false,
      error:
        "This location has neither a service area nor a storefront address, " +
        "so there is no address to send back alongside the service area. Set " +
        "the service area in the Google Business Profile UI.",
    };
  }

  const written = await patchLocation(
    params,
    "serviceArea,storefrontAddress",
    {
      serviceArea: {
        // The hybrid type is the whole point: it keeps the storefront on the
        // listing. Never CUSTOMER_LOCATION_ONLY — that is the conversion this
        // function refuses to make, and what Google coerces to when
        // storefrontAddress is left out of the mask.
        businessType: "CUSTOMER_AND_BUSINESS_LOCATION",
        places: { placeInfos },
      },
      // Byte-for-byte what the read returned. Anything reconstructed here
      // would be an edit to the client's address.
      storefrontAddress: current.storefrontAddress,
    },
    "Unknown error adding a service area to GBP"
  );

  // Nothing was sent, or nothing changed: no read-back to do.
  if (!written.success || params.validateOnly) return written;

  const problem = await verifyStorefrontSurvived(params, current.storefrontAddress);
  if (problem) return { success: false, wrote: true, error: problem };

  return written;
}
