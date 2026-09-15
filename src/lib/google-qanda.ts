/**
 * Questions & answers on a listing. My Business Q&A API, v1.
 *
 * Status on 2026-09-14 — and this one is NOT the same story as Place Actions
 * and Verifications, despite all three failing:
 *
 *   mybusinessplaceactions / mybusinessverifications: the host routes. An
 *   unauthenticated request answers 401, and an authenticated one answers a
 *   JSON 403 with ErrorInfo.reason SERVICE_DISABLED and an activation URL.
 *   Enabling the API in the Cloud console is the only blocker.
 *
 *   mybusinessqanda: the host answers Google's HTML 404 page for EVERY path,
 *   including the root and its own discovery document, authenticated or not.
 *   That is not what a disabled API looks like — proven on the same token and
 *   project by the two above. So enabling the API in the console will not by
 *   itself make these calls work; the service is not serving this caller.
 *   The API does exist (mybusinessqanda:v1 is listed in Google's discovery
 *   directory), and its directory entry notes that GBP API access has to be
 *   requested separately, which is the likeliest gate.
 *
 * The call is implemented against Google's documented v1 shape so it starts
 * working the moment the host does. Until then it returns ok:false with
 * unavailable.reason === "NOT_ROUTED" — deliberately distinct from
 * SERVICE_DISABLED, so nobody spends another session enabling an API that was
 * never the problem.
 *
 * Nothing in this repo calls it yet — the GBP audit is a skill that lives
 * outside the app.
 */
import { createGoogleClient } from "./google";
import { GBPReadResult, readFailure } from "./google-errors";

const QANDA_BASE = "https://mybusinessqanda.googleapis.com/v1";

export interface GBPAuthor {
  displayName?: string;
  profilePhotoUri?: string;
  type?: "AUTHOR_TYPE_UNSPECIFIED" | "REGULAR_USER" | "LOCAL_GUIDE" | "MERCHANT";
}

export interface GBPAnswer {
  name?: string;
  author?: GBPAuthor;
  upvoteCount?: number;
  text?: string;
  createTime?: string;
  updateTime?: string;
}

export interface GBPQuestion {
  name?: string;
  author?: GBPAuthor;
  upvoteCount?: number;
  text?: string;
  totalAnswerCount?: number;
  topAnswers?: GBPAnswer[];
  createTime?: string;
  updateTime?: string;
}

/**
 * Every question on a location, each with up to `answersPerQuestion` answers
 * attached. Read-only.
 *
 * For an audit the useful signals are questions with totalAnswerCount 0 (the
 * client is ignoring them) and answers whose author.type is not MERCHANT (the
 * public is answering on the client's behalf).
 */
export async function fetchQuestions(params: {
  googleAccountId: string;
  locationName: string;
  answersPerQuestion?: number;
}): Promise<GBPReadResult<GBPQuestion[]>> {
  try {
    const oauth2Client = await createGoogleClient(params.googleAccountId);

    const questions: GBPQuestion[] = [];
    let pageToken: string | undefined;

    do {
      const url =
        `${QANDA_BASE}/${params.locationName}/questions?pageSize=100` +
        `&answersPerQuestion=${params.answersPerQuestion ?? 10}` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");

      const response = await oauth2Client.request<{
        questions?: GBPQuestion[];
        nextPageToken?: string;
      }>({ url, method: "GET" });

      questions.push(...(response.data.questions ?? []));
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return { ok: true, data: questions };
  } catch (error: unknown) {
    return readFailure(error, "Unknown error fetching questions");
  }
}
