import crypto from "crypto";

/** Unguessable token for public image URLs and client upload links. */
export function newImageToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Shape check for tokens minted by newImageToken. The single source of
 * truth for the format — the public image route, the public upload route,
 * and the /u/[token] page all gate on this before touching the database.
 */
export function isValidImageToken(token: string): boolean {
  return /^[a-f0-9]{32}$/.test(token);
}
