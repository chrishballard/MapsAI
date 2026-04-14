/**
 * Lightweight website text extractor for onboarding suggestions.
 * Fetches the homepage HTML and strips it down to readable text.
 */
export async function scrapeWebsiteText(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RankmapsBot/1.0)",
        Accept: "text/html",
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

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
