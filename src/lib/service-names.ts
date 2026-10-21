/**
 * Service-name matching shared by the description generator and the routes
 * that save its output. Dependency-free so a route can use it without
 * pulling in the Claude client.
 */

/**
 * Matching key tolerant of Claude's name drift: casing, whitespace,
 * punctuation ("Kitchen & Bath" vs "kitchen and bath", curly apostrophes),
 * and diacritics. Letters in any script are preserved — stripping to ASCII
 * would collapse non-Latin names to "" and dedupe would destroy the list.
 */
export function serviceNameKey(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  // A name made purely of symbols still needs a non-empty, distinct key
  return normalized || name.toLowerCase().trim();
}
