import { z } from "zod";
import { generate } from "./claude";

const ServiceDescriptionSchema = z.object({
  services: z.array(
    z.object({
      serviceName: z.string(),
      description: z.string(),
    })
  ),
});

/** Google's hard limit for a GBP service description. */
export const MAX_SERVICE_DESCRIPTION_LENGTH = 300;

/**
 * Small batches keep each Claude call well under the token budget and keep
 * instruction-following tight — long lists are where names get dropped or
 * rewritten.
 */
const BATCH_SIZE = 10;
const BATCH_CONCURRENCY = 3;

/** Case/whitespace-insensitive key so Claude's name drift still matches. */
function nameKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Cut an overlong description at the last word boundary within the limit. */
export function clampDescription(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_SERVICE_DESCRIPTION_LENGTH) return trimmed;
  const slice = trimmed.slice(0, MAX_SERVICE_DESCRIPTION_LENGTH);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim();
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

interface GenerationContext {
  businessName: string;
  category: string | null;
  address: string | null;
  keywords: string[];
  cities: string[];
  websiteText?: string | null;
}

/**
 * One Claude call for a batch of service names. Returns descriptions keyed by
 * normalized name; a thrown API error is caught by the caller, which routes
 * the batch's names into the retry pass.
 */
async function generateBatch(
  context: GenerationContext,
  serviceNames: string[]
): Promise<Map<string, string>> {
  const systemPrompt = `You are an expert local SEO copywriter specializing in Google Business Profile service descriptions. Write compelling, SEO-optimized descriptions for each service listed below.

IMPORTANT: Only generate descriptions for the exact services provided. Do NOT add, suggest, or invent additional services. Copy each service name EXACTLY as given — same spelling, casing, and punctuation.

Rules:
- Write a unique description for each service provided — no more, no less
- Each description MUST be under 300 characters (this is a hard Google limit)
- Naturally incorporate the provided target keywords where relevant — do NOT force every keyword into every description
- Reference target cities/service areas naturally where appropriate
- Write in third person (use the business name or "the business", never "we" or "our")
- Each description should differentiate itself — avoid repetitive phrasing across descriptions
- Focus on: what the service includes, why customers choose this business for it, and what makes their approach unique
- Do NOT include phone numbers, URLs, or promotional language (e.g. "best", "#1", "call now")
- Do NOT use ALL CAPS for emphasis
- If website content is provided, use it to understand how the business describes its own services and mirror that tone and detail`;

  const userMessage = [
    `Business name: ${context.businessName}`,
    context.category ? `Category: ${context.category}` : null,
    context.address ? `Address: ${context.address}` : null,
    context.keywords.length > 0
      ? `Target keywords: ${context.keywords.join(", ")}`
      : null,
    context.cities.length > 0
      ? `Service areas/cities: ${context.cities.join(", ")}`
      : null,
    context.websiteText
      ? `\nWebsite content (extracted from their site):\n${context.websiteText}`
      : null,
    `\nServices to describe:\n${serviceNames.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const parsed = await generate({
    system: systemPrompt,
    prompt: userMessage,
    schema: ServiceDescriptionSchema,
    maxTokens: 4096,
    errorMessage: "Failed to parse service descriptions from Claude",
  });

  const byKey = new Map<string, string>();
  for (const s of parsed.services) {
    byKey.set(nameKey(s.serviceName), s.description);
  }
  return byKey;
}

/**
 * Generate GBP service descriptions for any number of services.
 *
 * Large lists (service-rich categories expose 30-70 GBP service types) are
 * split into small batches run with limited concurrency. Results are mapped
 * back to the EXACT input names — Claude's output names are only used for
 * matching, never returned — and names Claude drops (or whole failed batches)
 * get one retry pass. Descriptions are clamped to Google's 300-character
 * limit. A service still missing after retry comes back with an empty
 * description rather than failing the whole run; the call only throws if
 * nothing at all could be generated.
 */
export async function generateServiceDescriptions(params: {
  businessName: string;
  category: string | null;
  address: string | null;
  keywords: string[];
  cities: string[];
  serviceNames: string[];
  websiteText?: string | null;
}): Promise<{ serviceName: string; description: string }[]> {
  const context: GenerationContext = {
    businessName: params.businessName,
    category: params.category,
    address: params.address,
    keywords: params.keywords,
    cities: params.cities,
    websiteText: params.websiteText,
  };

  // Dedupe case-insensitively, keeping the first casing and input order
  const canonicalNames: string[] = [];
  const seen = new Set<string>();
  for (const name of params.serviceNames) {
    const key = nameKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    canonicalNames.push(name);
  }

  if (canonicalNames.length === 0) return [];

  const descriptions = new Map<string, string>();
  let lastError: unknown = null;

  const runPass = async (names: string[], concurrency: number) => {
    const batches = chunk(names, BATCH_SIZE);
    await mapWithConcurrency(batches, concurrency, async (batch) => {
      try {
        const generated = await generateBatch(context, batch);
        for (const name of batch) {
          const description = generated.get(nameKey(name));
          if (description !== undefined) {
            descriptions.set(nameKey(name), description);
          }
        }
      } catch (error: unknown) {
        lastError = error;
        console.error(
          `[service-generator] Batch of ${batch.length} failed:`,
          error
        );
      }
    });
  };

  await runPass(canonicalNames, BATCH_CONCURRENCY);

  // One retry for anything a batch dropped or a failed batch lost
  const missing = canonicalNames.filter((n) => !descriptions.has(nameKey(n)));
  if (missing.length > 0) {
    await runPass(missing, 1);
  }

  if (descriptions.size === 0) {
    throw lastError instanceof Error
      ? lastError
      : new Error("Failed to generate any service descriptions");
  }

  const stillMissing = canonicalNames.filter(
    (n) => !descriptions.has(nameKey(n))
  );
  for (const name of stillMissing) {
    console.warn(`[service-generator] Missing description for service: ${name}`);
  }

  return canonicalNames.map((serviceName) => ({
    serviceName,
    description: clampDescription(descriptions.get(nameKey(serviceName)) ?? ""),
  }));
}
