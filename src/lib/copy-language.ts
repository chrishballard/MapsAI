/**
 * The language RankMaps writes Google Business Profile copy in.
 *
 * Every client is a US business, but Google speaks to us in the location's
 * own languageCode: an es-419 profile gets Spanish service type and category
 * names. The service generator, given Spanish names and no language rule,
 * wrote Spanish descriptions that were pushed to Google (Bees Friends
 * Cleaners Portland, 2026-06-30). A location's languageCode cannot be changed
 * through the API, so every generator says the output language outright.
 *
 * Kept out of src/lib/claude.ts for the same reason as pasted-content.ts:
 * the generator tests mock that module wholesale.
 */

/** Appended to the system prompt of every generator whose output reaches a
 * Google profile, or feeds one (keywords, cities). It governs the copy the
 * model writes; a prompt that echoes input back verbatim (the service
 * generator's names) states that exception right after it. */
export const US_ENGLISH_RULE =
  "Language: write all the copy you produce in US English (American spelling and usage), even when the business name, category, service names, keywords, website text or anything else you are given is in another language. Every business we write for is a US business. Never write that copy in another language.";

/**
 * True for a language code that is set and is not English ("es-419", "fr").
 * Null, undefined and "" mean we have not read it, which is not a reason to
 * warn anyone.
 */
export function isNonEnglishLanguageCode(
  code: string | null | undefined
): code is string {
  if (!code) return false;
  return !/^en(?:[-_]|$)/i.test(code);
}
