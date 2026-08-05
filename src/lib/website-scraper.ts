import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Lightweight website text extractor for onboarding suggestions.
 * Fetches the homepage HTML and strips it down to readable text.
 *
 * The URL comes from profile.websiteUrl (GBP data / user input), so treat it
 * as untrusted: only http/https, no private or link-local destinations, and
 * redirects are followed manually so every hop is re-checked.
 */

const MAX_REDIRECTS = 3;

function isBlockedIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || // 0.0.0.0/8 "this network"
    a === 10 || // 10.0.0.0/8
    a === 127 || // 127.0.0.0/8 loopback
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) // 192.168.0.0/16
  );
}

function isBlockedIP(address: string): boolean {
  let ip = address.toLowerCase();
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) — check the embedded IPv4
  if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) {
    ip = ip.slice(7);
  }
  const version = isIP(ip);
  if (version === 4) return isBlockedIPv4(ip);
  if (version === 6) {
    return (
      ip === "::" ||
      ip === "::1" || // loopback
      ip.startsWith("fc") ||
      ip.startsWith("fd") || // fc00::/7 unique local
      ip.startsWith("fe8") ||
      ip.startsWith("fe9") ||
      ip.startsWith("fea") ||
      ip.startsWith("feb") // fe80::/10 link-local
    );
  }
  // Not a parseable IP — refuse rather than guess
  return true;
}

/**
 * Validates that a URL is http/https and does not resolve to a private,
 * loopback, or link-local address. Returns the parsed URL or null.
 */
async function toSafeUrl(raw: string): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  // IPv6 literals come back bracketed from URL.hostname
  const host = url.hostname.replace(/^\[|\]$/g, "");

  if (isIP(host)) {
    return isBlockedIP(host) ? null : url;
  }

  try {
    const addresses = await lookup(host, { all: true });
    if (addresses.length === 0) return null;
    if (addresses.some((a) => isBlockedIP(a.address))) return null;
  } catch {
    return null;
  }

  return url;
}

export async function scrapeWebsiteText(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    let currentUrl = await toSafeUrl(url);
    let res: Response | null = null;

    // Follow redirects manually so each destination is re-validated
    for (let hop = 0; currentUrl && hop <= MAX_REDIRECTS; hop++) {
      res = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; RankmapsBot/1.0)",
          Accept: "text/html",
        },
      });

      if (res.status < 300 || res.status >= 400) break;

      const location = res.headers.get("location");
      if (!location) break;
      currentUrl = await toSafeUrl(new URL(location, currentUrl).toString());
      res = null;
    }
    clearTimeout(timeout);

    if (!res || !res.ok) return null;

    const html = await res.text();

    // Strip scripts, styles, and HTML tags — keep text content
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Return first ~3000 chars to stay within reasonable token limits
    return text.slice(0, 3000) || null;
  } catch {
    return null;
  }
}
