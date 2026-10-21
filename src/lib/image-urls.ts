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
  return !isNonPublicHost(parsed.hostname);
}

/**
 * Local names and private, loopback, link-local and unspecified addresses:
 * hosts Google's fetchers can never reach. URL has already lowercased the
 * name and normalized any IPv4 spelling (2130706433, 0x7f.1) to dotted form.
 */
function isNonPublicHost(hostname: string): boolean {
  const host = hostname.replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }

  // IPv6 literals keep their brackets in URL.hostname.
  if (host.startsWith("[")) {
    const ip = host.slice(1, -1);
    if (ip === "::1" || ip === "::") return true;
    // An IPv4-mapped address (::ffff:a.b.c.d) is written as two hex groups.
    const mapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) {
      const hi = parseInt(mapped[1], 16);
      const lo = parseInt(mapped[2], 16);
      return isPrivateIPv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
    }
    // fc00::/7 unique local, fe80::/10 link-local. URL drops leading zeros,
    // so a first group in those ranges is always four digits.
    return /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
  }

  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  return v4 ? isPrivateIPv4(v4.slice(1).map(Number)) : false;
}

/** 0/8, 10/8, 127/8, 169.254/16, 172.16/12 and 192.168/16. */
function isPrivateIPv4([a, b]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
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
