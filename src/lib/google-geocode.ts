/**
 * Turn a city name into the Google place id a GBP service area wants.
 *
 * GBP's PlaceInfo needs the place id of the CITY itself, the same thing the
 * dashboard stores when someone types a city into the service area box.
 * Nothing else we already pay for produces one: `localdom places` resolves
 * businesses (asked for "American Fork", it answers with a pediatrics clinic),
 * DataForSEO's location codes are its own taxonomy, and the place id is not
 * in the HTML of a plain Maps URL. The Geocoding API returns it directly.
 *
 * Needs GOOGLE_GEOCODING_API_KEY. That is an API key, not the OAuth client
 * the rest of the Google code uses, and its project needs billing attached.
 */
import { fetchJson } from "./fetch-json";

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

/**
 * Result types that mean "this is a place a service area can name".
 *
 * The check matters more than it looks. Geocoding happily answers a street
 * address or a business with a perfectly valid place id, and a service area
 * built from one of those would cover a single building instead of a town,
 * which is a mistake nobody would notice on the listing until they read the
 * pin coverage closely. Anything outside this set is refused with what Google
 * actually returned, so the caller can see why.
 */
const AREA_TYPES = new Set([
  "locality",
  "postal_town",
  "sublocality",
  "neighborhood",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
]);

export interface GeocodedPlace {
  placeId: string;
  /** Google's own formatted name, e.g. "American Fork, UT, USA". */
  placeName: string;
  types: string[];
}

export type GeocodeOutcome =
  | { ok: true; place: GeocodedPlace }
  | { ok: false; error: string };

interface GeocodeResponse {
  status?: string;
  error_message?: string;
  results?: Array<{
    place_id?: string;
    formatted_address?: string;
    types?: string[];
  }>;
}

/** Look up one city. Never throws; a failure comes back as { ok: false }. */
export async function resolveAreaPlaceId(
  query: string,
  options: { apiKey?: string } = {}
): Promise<GeocodeOutcome> {
  const apiKey = options.apiKey ?? process.env.GOOGLE_GEOCODING_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error:
        "GOOGLE_GEOCODING_API_KEY is not set. Enable the Geocoding API and " +
        "put the key in ~/.config/vineyardgrowth/google-geocoding.env.",
    };
  }
  if (!query.trim()) return { ok: false, error: "Empty search" };

  const url = `${GEOCODE_URL}?address=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}`;

  let data: GeocodeResponse;
  try {
    data = await fetchJson<GeocodeResponse>(url);
  } catch (error: unknown) {
    return {
      ok: false,
      error: `Geocoding request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Geocoding reports its own failures in a 200 body, so the status field is
  // the real result and error_message carries the reason (an unenabled API or
  // a project without billing both land here as REQUEST_DENIED).
  if (data.status !== "OK") {
    const detail = data.error_message ? `: ${data.error_message}` : "";
    return {
      ok: false,
      error: `Geocoding returned ${data.status ?? "no status"}${detail}`,
    };
  }

  const first = data.results?.[0];
  if (!first?.place_id) {
    return { ok: false, error: `No result for "${query}"` };
  }

  const types = first.types ?? [];
  if (!types.some((t) => AREA_TYPES.has(t))) {
    return {
      ok: false,
      error:
        `"${query}" resolved to ${first.formatted_address ?? "a place"} of type ` +
        `[${types.join(", ") || "unknown"}], which is not a city or region. ` +
        "A service area built from that would cover one address, not a town. " +
        "Search for the city on its own, e.g. \"American Fork, UT\".",
    };
  }

  return {
    ok: true,
    place: {
      placeId: first.place_id,
      placeName: first.formatted_address ?? query,
      types,
    },
  };
}
