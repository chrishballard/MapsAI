/**
 * Place action links — the "Book online" / "Order online" buttons on a
 * listing. My Business Place Actions API, v1.
 *
 * Status on the Cloud project as of 2026-09-14: DISABLED. Every call comes
 * back 403 SERVICE_DISABLED for project 25337394982; the host itself routes
 * fine (an unauthenticated request answers 401), so enabling the API in the
 * console is the only thing standing in the way. Until then this returns ok:false
 * with unavailable.reason === "SERVICE_DISABLED" and the activation URL
 * Google supplies, so a caller can distinguish "cannot check" from "none set"
 * rather than reporting an outage as an empty result.
 *
 * Nothing in this repo calls it yet — the GBP audit is a skill that lives
 * outside the app.
 */
import { createGoogleClient } from "./google";
import { GBPReadResult, readFailure } from "./google-errors";

const PLACE_ACTIONS_BASE = "https://mybusinessplaceactions.googleapis.com/v1";

export type GBPPlaceActionType =
  | "PLACE_ACTION_TYPE_UNSPECIFIED"
  | "APPOINTMENT"
  | "ONLINE_APPOINTMENT"
  | "DINING_RESERVATION"
  | "FOOD_ORDERING"
  | "FOOD_DELIVERY"
  | "FOOD_TAKEOUT"
  | "SHOP_ONLINE"
  | "SOLOPRENEUR_APPOINTMENT";

export interface GBPPlaceActionLink {
  name?: string;
  placeActionType?: GBPPlaceActionType;
  uri?: string;
  /** MERCHANT links were added by the owner; AGGREGATOR_3P by a booking partner. */
  providerType?: "PROVIDER_TYPE_UNSPECIFIED" | "MERCHANT" | "AGGREGATOR_3P";
  isEditable?: boolean;
  isPreferred?: boolean;
  createTime?: string;
  updateTime?: string;
}

/** Every place action link on a location (paginated). Read-only. */
export async function fetchPlaceActionLinks(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<GBPReadResult<GBPPlaceActionLink[]>> {
  try {
    const oauth2Client = await createGoogleClient(params.googleAccountId);

    const links: GBPPlaceActionLink[] = [];
    let pageToken: string | undefined;

    do {
      const url =
        `${PLACE_ACTIONS_BASE}/${params.locationName}/placeActionLinks?pageSize=100` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");

      const response = await oauth2Client.request<{
        placeActionLinks?: GBPPlaceActionLink[];
        nextPageToken?: string;
      }>({ url, method: "GET" });

      links.push(...(response.data.placeActionLinks ?? []));
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return { ok: true, data: links };
  } catch (error: unknown) {
    return readFailure(error, "Unknown error fetching place action links");
  }
}
