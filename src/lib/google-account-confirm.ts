/**
 * Disconnecting a Google account cascade-deletes every profile under it and
 * all of their history in RankMaps, so the request has to name the account:
 * the operator types its email and the route compares it. Shared by the
 * Settings button (to catch a typo before sending) and the DELETE route
 * (which decides).
 *
 * Case and surrounding spaces don't count, the way Google treats addresses.
 */
export function confirmsGoogleAccount(
  typed: unknown,
  googleEmail: string
): boolean {
  if (typeof typed !== "string") return false;
  const normalized = typed.trim().toLowerCase();
  return normalized.length > 0 && normalized === googleEmail.trim().toLowerCase();
}
