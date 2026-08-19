// URL helpers for library images. Two consumers with different needs:
//  - the dashboard/public pages display thumbnails (relative URLs are fine)
//  - the publish worker hands Google a sourceUrl it fetches server-side,
//    which must be an absolute, publicly reachable URL.

export interface ImageUrlFields {
  publicToken: string;
  googleUrl: string | null;
  thumbnailUrl: string | null;
}

export function publicImagePath(publicToken: string): string {
  return `/api/public/images/${publicToken}`;
}

/** Thumbnail variant of the public route (falls back to the original
 * server-side when no thumb was stored). Display-only — Google always gets
 * the full-size publicImagePath. */
export function publicImageThumbPath(publicToken: string): string {
  return `${publicImagePath(publicToken)}?size=thumb`;
}

/** Base URL the app is served from (NEXTAUTH_URL is already required in prod). */
export function appBaseUrl(): string | null {
  const base = process.env.NEXTAUTH_URL;
  if (!base) return null;
  return base.replace(/\/+$/, "");
}

/** Google can only fetch sourceUrls that are https and not local. */
export function isPubliclyReachable(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname;
  return (
    host !== "localhost" &&
    host !== "127.0.0.1" &&
    host !== "::1" &&
    !host.endsWith(".local")
  );
}

/** URL for displaying an image in our own UI (browser fetches it).
 * Prefers lightweight variants: GBP thumbnail, then Google's CDN, then our
 * thumb route for uploaded bytes. */
export function displayImageUrl(image: ImageUrlFields): string {
  return (
    image.thumbnailUrl ??
    image.googleUrl ??
    publicImageThumbPath(image.publicToken)
  );
}

/**
 * Absolute URL Google should fetch the post photo from, or null when the
 * image can't be reached publicly (e.g. uploaded bytes on a localhost dev
 * server) — in that case the post publishes without media rather than fail.
 */
export function resolvePostImageSourceUrl(image: ImageUrlFields): string | null {
  // GBP-synced images: Google already hosts the bytes on its own CDN.
  if (image.googleUrl) return image.googleUrl;

  const base = appBaseUrl();
  if (!base) return null;
  const url = `${base}${publicImagePath(image.publicToken)}`;
  return isPubliclyReachable(url) ? url : null;
}
