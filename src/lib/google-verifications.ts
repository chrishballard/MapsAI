/**
 * Verification state — whether Google trusts the listing's owner. My Business
 * Verifications API, v1.
 *
 * `hasVoiceOfMerchant` is the one that matters for an audit: false means the
 * profile's edits will not stick and the listing is at risk, whatever the
 * verification history says.
 *
 * Status on the Cloud project as of 2026-09-14: DISABLED (403
 * SERVICE_DISABLED for project 25337394982). The host routes — an
 * unauthenticated call answers 401 — so enabling the API is the only blocker.
 */
import { createGoogleClient } from "./google";
import { GBPReadResult, readFailure } from "./google-errors";

const VERIFICATIONS_BASE = "https://mybusinessverifications.googleapis.com/v1";

export interface GBPVoiceOfMerchantState {
  hasVoiceOfMerchant?: boolean;
  hasBusinessAuthority?: boolean;
  waitForVoiceOfMerchant?: Record<string, unknown>;
  resolveOwnershipConflict?: Record<string, unknown>;
  complyWithGuidelines?: Record<string, unknown>;
  verify?: Record<string, unknown>;
}

export interface GBPVerification {
  name?: string;
  method?:
    | "VERIFICATION_METHOD_UNSPECIFIED"
    | "ADDRESS"
    | "EMAIL"
    | "PHONE_CALL"
    | "SMS"
    | "AUTO"
    | "TRUSTED_PARTNER";
  state?: "STATE_UNSPECIFIED" | "PENDING" | "COMPLETED" | "FAILED";
  announcement?: string;
  createTime?: string;
}

/**
 * Whether the location currently has Voice of Merchant, plus the reason when
 * it does not. Note the path segment is capitalised — `VoiceOfMerchantState`,
 * not `voiceOfMerchantState`.
 */
export async function fetchVoiceOfMerchantState(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<GBPReadResult<GBPVoiceOfMerchantState>> {
  try {
    const oauth2Client = await createGoogleClient(params.googleAccountId);
    const response = await oauth2Client.request<GBPVoiceOfMerchantState>({
      url: `${VERIFICATIONS_BASE}/${params.locationName}/VoiceOfMerchantState`,
      method: "GET",
    });
    return { ok: true, data: response.data };
  } catch (error: unknown) {
    return readFailure(error, "Unknown error fetching Voice of Merchant state");
  }
}

/** Verification attempts on the location, newest first per Google. Read-only. */
export async function fetchVerifications(params: {
  googleAccountId: string;
  locationName: string;
}): Promise<GBPReadResult<GBPVerification[]>> {
  try {
    const oauth2Client = await createGoogleClient(params.googleAccountId);

    const verifications: GBPVerification[] = [];
    let pageToken: string | undefined;

    do {
      const url =
        `${VERIFICATIONS_BASE}/${params.locationName}/verifications?pageSize=100` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");

      const response = await oauth2Client.request<{
        verifications?: GBPVerification[];
        nextPageToken?: string;
      }>({ url, method: "GET" });

      verifications.push(...(response.data.verifications ?? []));
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return { ok: true, data: verifications };
  } catch (error: unknown) {
    return readFailure(error, "Unknown error fetching verifications");
  }
}
