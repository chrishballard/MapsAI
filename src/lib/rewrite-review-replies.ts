import { prisma } from "./prisma";
import { generateReviewResponse } from "./review-responder";
import { fetchSingleReview, publishReviewReply } from "./google-reviews";
import { normalizeReviewKey } from "./review-key";
import { isReviewNotFound } from "./review-removal";
import {
  checkHealthcareReply,
  describeHealthcareIssues,
  isHealthcareCategory,
} from "./healthcare";

export { normalizeReviewKey };

/**
 * One-off rewrite of review replies that are already live on Google.
 *
 * Badger Gutters asked (call of 2026-08-19) that every reply read as Ben, the
 * owner, speaking in the first person, never about Ben in the third person,
 * and signed off with his name. This rewrites the replies RankMaps already
 * published for that profile; the ongoing fix is the same persona text saved
 * to Profile.reviewInstructions.
 *
 * Deliberately kept out of the product surface. The app refuses to regenerate
 * or re-publish a PUBLISHED response (api/reviews/[id]/generate, and the
 * publish worker's overwrite guard) because replies are public and rewriting
 * them is not something an operator should be able to do by accident. This is
 * the escape hatch for a client who explicitly asked, run by hand, in two
 * phases so the exact text is approved before anything goes out.
 */

/** The signature Ben asked for, appended to every reply. */
export const OWNER_SIGNATURE = "— Ben";

/** First name as it appears in reviews — used for the third-person check. */
const OWNER_FIRST_NAME = "Ben";

/** Persona instructions layered on top of the profile's own, at plan time. */
export const OWNER_PERSONA_INSTRUCTIONS = [
  "Write in the first person, as Ben, the owner, speaking directly to the reviewer.",
  'Use "I" for anything Ben did himself, and "my team" or "we" only for work the crew did.',
  "",
  "Never write about Ben in the third person. If the review praises Ben by name, answer as him:",
  'write "I\'m glad I could get that sorted for you", never "We\'re glad your experience with Ben was great."',
  "Do not use the name Ben anywhere in the body of the reply.",
  "",
  "Do not use em dashes or en dashes anywhere in the reply. Use a period, comma, colon, or parentheses.",
  "",
  `End every reply with the signature on its own final line, exactly: ${OWNER_SIGNATURE}`,
  "The signature is added automatically, so do not write it yourself.",
].join("\n");

export type SkipReason =
  | "NO_LIVE_REPLY"
  | "FOREIGN_REPLY"
  | "DUPLICATE_ROW"
  | "THIRD_PERSON_OWNER"
  | "GENERATION_FAILED"
  | "HEALTHCARE_PRIVACY";

export interface RewriteCandidate {
  responseId: string;
  reviewId: string;
  googleReviewId: string;
  rating: number;
  reviewerName: string | null;
  reviewComment: string | null;
  publishedAt: string | null;
  /** The reply currently live on Google — verified, not just what we stored. */
  before: string;
  /** The proposed replacement, signed. */
  after: string;
}

export interface SkippedCandidate {
  responseId: string;
  googleReviewId: string;
  reviewerName: string | null;
  reason: SkipReason;
  detail?: string;
}

export interface RewritePlan {
  profileId: string;
  profileName: string;
  googleAccountId: string;
  candidates: RewriteCandidate[];
  skipped: SkippedCandidate[];
}

export interface ApplyResult {
  rewritten: number;
  skipped: SkippedCandidate[];
  failed: SkippedCandidate[];
  /** Published to Google but the DB row moved underneath us — needs a look. */
  drifted: { responseId: string; googleReviewId: string; after: string }[];
}

/** Strip a trailing sign-off the model may have written on its own. */
function stripSignature(text: string): string {
  return text
    .replace(
      new RegExp(`\\n+\\s*(?:[—–-]\\s*)?${OWNER_FIRST_NAME}\\s*$`, "i"),
      ""
    )
    .trimEnd();
}

/** Ensure the reply ends with exactly one signature, on its own line. */
export function applySignature(text: string): string {
  return `${stripSignature(text.trim())}\n\n${OWNER_SIGNATURE}`;
}

/**
 * True when the body still talks about the owner as a third party. The
 * signature itself is excluded — that mention is the one we want.
 */
export function mentionsOwnerInThirdPerson(text: string): boolean {
  const body = stripSignature(text);
  return new RegExp(`\\b${OWNER_FIRST_NAME}\\b`).test(body);
}

/**
 * The publish worker's last gate for healthcare profiles, on the exact text
 * that would go public: a reply must not confirm a patient or repeat their
 * care. The rewrite publishes without the worker, so it runs the gate itself,
 * at plan time and again at apply time (a plan file can be edited in
 * between). The persona signature has an em dash, which the healthcare rules
 * refuse, so on a healthcare profile every rewrite is held: the persona is
 * not one a healthcare profile can use as written. Null when it passes.
 */
function healthcareHold(
  profile: { category: string | null; phone: string | null },
  reply: string,
  reviewerName: string | null
): string | null {
  if (!isHealthcareCategory(profile.category)) return null;
  const issues = checkHealthcareReply(reply, {
    reviewerName,
    officePhone: profile.phone,
  });
  return issues.length > 0 ? describeHealthcareIssues(issues) : null;
}

function combineInstructions(profileInstructions: string | null): string {
  return [profileInstructions?.trim(), OWNER_PERSONA_INSTRUCTIONS]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Phase one: work out what each reply should become, without touching
 * anything. Strictly read-only against both the database and Google — the
 * only writes in this module happen in applyReplyRewrite.
 */
export async function planReplyRewrite(options: {
  profileId: string;
  /** Only replies published on or after this date. Omit for all of them. */
  since?: Date;
  limit?: number;
  log?: (message: string) => void;
}): Promise<RewritePlan> {
  const { profileId, since, limit } = options;
  const log = options.log ?? console.log;

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: {
      id: true,
      name: true,
      category: true,
      phone: true,
      googleAccountId: true,
      reviewInstructions: true,
    },
  });
  if (!profile) throw new Error(`Profile ${profileId} not found`);

  const rows = await prisma.reviewResponse.findMany({
    where: {
      status: "PUBLISHED",
      // A review Google took down has no public reply left to rewrite.
      review: { profileId, removedAt: null },
      ...(since ? { publishedAt: { gte: since } } : {}),
    },
    orderBy: { publishedAt: "asc" },
    select: {
      id: true,
      content: true,
      publishedAt: true,
      review: {
        select: {
          id: true,
          googleReviewId: true,
          rating: true,
          reviewerName: true,
          comment: true,
          repliedExternally: true,
        },
      },
    },
  });

  const plan: RewritePlan = {
    profileId: profile.id,
    profileName: profile.name,
    googleAccountId: profile.googleAccountId,
    candidates: [],
    skipped: [],
  };

  const customInstructions = combineInstructions(profile.reviewInstructions);

  // Oldest published row wins for a duplicated review: it carries the history
  // the reply was actually posted under. Its twin is reported, never rewritten
  // — two rewrites of one review means two edits to one public reply.
  const seenKeys = new Set<string>();
  const deduped: typeof rows = [];
  for (const row of rows) {
    const key = normalizeReviewKey(row.review.googleReviewId);
    if (seenKeys.has(key)) {
      plan.skipped.push({
        responseId: row.id,
        googleReviewId: row.review.googleReviewId,
        reviewerName: row.review.reviewerName,
        reason: "DUPLICATE_ROW",
        detail: "Same review as an earlier row (duplicate googleReviewId form)",
      });
      continue;
    }
    seenKeys.add(key);
    deduped.push(row);
  }

  const work = typeof limit === "number" ? deduped.slice(0, limit) : deduped;
  log(
    `${plan.profileName}: ${work.length} published repl${work.length === 1 ? "y" : "ies"} to plan` +
      (plan.skipped.length ? ` (${plan.skipped.length} duplicate rows set aside)` : "")
  );

  for (const row of work) {
    const { review } = row;

    // Never plan against what we stored — check what's actually public. A
    // review that's gone on Google is skipped, not fatal: one 404 used to
    // throw out of the whole plan.
    let liveReview;
    try {
      liveReview = await fetchSingleReview(
        profile.googleAccountId,
        review.googleReviewId
      );
    } catch (err) {
      if (!isReviewNotFound(err)) throw err;
      plan.skipped.push({
        responseId: row.id,
        googleReviewId: review.googleReviewId,
        reviewerName: review.reviewerName,
        reason: "NO_LIVE_REPLY",
        detail: "Review is gone on Google (404)",
      });
      continue;
    }
    const liveReply = liveReview?.reviewReply?.comment;

    if (!liveReply) {
      plan.skipped.push({
        responseId: row.id,
        googleReviewId: review.googleReviewId,
        reviewerName: review.reviewerName,
        reason: "NO_LIVE_REPLY",
        detail: "Marked published here but Google shows no reply",
      });
      continue;
    }

    if (liveReply !== row.content) {
      plan.skipped.push({
        responseId: row.id,
        googleReviewId: review.googleReviewId,
        reviewerName: review.reviewerName,
        reason: "FOREIGN_REPLY",
        detail: "Live reply differs from ours — someone edited it by hand",
      });
      continue;
    }

    // One retry: the third-person slip is the specific thing Ben called out,
    // and it's cheap to ask again before giving up on the reply.
    let after: string | null = null;
    let lastAttempt: string | null = null;
    let generationError: string | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const generated = await generateReviewResponse({
          businessName: profile.name,
          businessCategory: profile.category,
          reviewerName: review.reviewerName,
          starRating: review.rating,
          reviewComment: review.comment,
          customInstructions,
          // As the review sync passes it: healthcare replies point an
          // unhappy reviewer at the office phone.
          businessPhone: profile.phone,
        });
        const signed = applySignature(generated.response);
        lastAttempt = signed;
        if (!mentionsOwnerInThirdPerson(signed)) {
          after = signed;
          break;
        }
      } catch (err) {
        generationError = err instanceof Error ? err.message : String(err);
        break;
      }
    }

    if (!after) {
      plan.skipped.push({
        responseId: row.id,
        googleReviewId: review.googleReviewId,
        reviewerName: review.reviewerName,
        reason: generationError ? "GENERATION_FAILED" : "THIRD_PERSON_OWNER",
        detail:
          generationError ??
          `Still referred to ${OWNER_FIRST_NAME} in the third person after a retry: ${lastAttempt}`,
      });
      continue;
    }

    const held = healthcareHold(profile, after, review.reviewerName);
    if (held) {
      plan.skipped.push({
        responseId: row.id,
        googleReviewId: review.googleReviewId,
        reviewerName: review.reviewerName,
        reason: "HEALTHCARE_PRIVACY",
        detail: `Fails the healthcare privacy check: ${held}`,
      });
      continue;
    }

    plan.candidates.push({
      responseId: row.id,
      reviewId: review.id,
      googleReviewId: review.googleReviewId,
      rating: review.rating,
      reviewerName: review.reviewerName,
      reviewComment: review.comment,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      before: row.content,
      after,
    });
  }

  return plan;
}

/**
 * Phase two: publish the approved rewrites.
 *
 * Every reply is re-verified against Google immediately before the write, so
 * an edit made between planning and applying wins. Google is updated first
 * and the row second: if the row write loses a race the reply is still
 * correct in public, and the drift is reported rather than swallowed.
 */
export async function applyReplyRewrite(options: {
  plan: RewritePlan;
  /** Pause between publishes. GBP allows ~10 edits/min/profile. */
  throttleMs?: number;
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ApplyResult> {
  const { plan } = options;
  const throttleMs = options.throttleMs ?? 8_000;
  const log = options.log ?? console.log;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const result: ApplyResult = {
    rewritten: 0,
    skipped: [],
    failed: [],
    drifted: [],
  };

  // The category and phone the gate needs come from the database, not the
  // plan file, which a person may have edited.
  const profile = await prisma.profile.findUnique({
    where: { id: plan.profileId },
    select: { category: true, phone: true },
  });
  if (!profile) throw new Error(`Profile ${plan.profileId} not found`);

  for (const [index, candidate] of plan.candidates.entries()) {
    const held = healthcareHold(profile, candidate.after, candidate.reviewerName);
    if (held) {
      result.skipped.push({
        responseId: candidate.responseId,
        googleReviewId: candidate.googleReviewId,
        reviewerName: candidate.reviewerName,
        reason: "HEALTHCARE_PRIVACY",
        detail: `Fails the healthcare privacy check: ${held}`,
      });
      continue;
    }

    if (index > 0) await sleep(throttleMs);

    try {
      const liveReview = await fetchSingleReview(
        plan.googleAccountId,
        candidate.googleReviewId
      );
      const liveReply = liveReview?.reviewReply?.comment;

      if (liveReply !== candidate.before) {
        result.skipped.push({
          responseId: candidate.responseId,
          googleReviewId: candidate.googleReviewId,
          reviewerName: candidate.reviewerName,
          reason: liveReply ? "FOREIGN_REPLY" : "NO_LIVE_REPLY",
          detail: "Live reply changed between planning and publishing",
        });
        continue;
      }

      await publishReviewReply(
        plan.googleAccountId,
        candidate.googleReviewId,
        candidate.after
      );
      result.rewritten++;

      const updated = await prisma.reviewResponse.updateMany({
        where: {
          id: candidate.responseId,
          status: "PUBLISHED",
          content: candidate.before,
        },
        data: { content: candidate.after },
      });

      if (updated.count === 0) {
        result.drifted.push({
          responseId: candidate.responseId,
          googleReviewId: candidate.googleReviewId,
          after: candidate.after,
        });
      }

      log(
        `Rewrote reply for ${candidate.reviewerName ?? "anonymous"} (${candidate.rating}★)`
      );
    } catch (err) {
      if (isReviewNotFound(err)) {
        result.skipped.push({
          responseId: candidate.responseId,
          googleReviewId: candidate.googleReviewId,
          reviewerName: candidate.reviewerName,
          reason: "NO_LIVE_REPLY",
          detail: "Review is gone on Google (404)",
        });
        continue;
      }
      result.failed.push({
        responseId: candidate.responseId,
        googleReviewId: candidate.googleReviewId,
        reviewerName: candidate.reviewerName,
        reason: "GENERATION_FAILED",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
