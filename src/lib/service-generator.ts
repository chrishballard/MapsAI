import { z } from "zod";
import { generate } from "./claude";
import { MAX_SERVICE_DESCRIPTION_LENGTH } from "./gbp-limits";

const ServiceDescriptionSchema = z.object({
  services: z.array(
    z.object({
      serviceName: z.string(),
      description: z.string(),
    })
  ),
});

/**
 * Small batches keep each Claude call well under the token budget and keep
 * instruction-following tight — long lists are where names get dropped or
 * rewritten.
 */
const BATCH_SIZE = 10;
const BATCH_CONCURRENCY = 3;

/** Thrown when some services still have no description after the retry pass.
 * Callers replace saved data with the result set, so a partial result must
 * never be returned — it would silently destroy existing descriptions. */
export class ServiceGenerationIncompleteError extends Error {
  constructor(public missingServices: string[]) {
    super(
      `Could not generate descriptions for: ${missingServices.join(", ")}. Please try again.`
    );
    this.name = "ServiceGenerationIncompleteError";
  }
}

/**
 * Matching key tolerant of Claude's name drift: casing, whitespace, and
 * punctuation ("Kitchen & Bath" vs "kitchen and bath", curly apostrophes).
 */
function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Cut an overlong description at the last word boundary within the limit. */
export function clampDescription(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_SERVICE_DESCRIPTION_LENGTH) return trimmed;
  const slice = trimmed.slice(0, MAX_SERVICE_DESCRIPTION_LENGTH);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  // A space-less cut can land mid-surrogate-pair — drop a dangling half
  return cut.replace(/[\uD800-\uDBFF]$/, "").trim();
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
 * the INPUT names' keys: outputs are matched by normalized name, and when
 * Claude answered for every service but rewrote a name beyond recognition,
 * the leftovers are paired up positionally (Claude preserves list order).
 * Blank descriptions count as missing so the retry pass re-asks for them.
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

  const outputs = parsed.services.filter((s) => s.description.trim() !== "");
  const outputByKey = new Map<string, string>();
  for (const s of outputs) {
    outputByKey.set(nameKey(s.serviceName), s.description);
  }

  const matched = new Map<string, string>();
  const consumedKeys = new Set<string>();
  const unmatchedInputs: string[] = [];
  for (const name of serviceNames) {
    const key = nameKey(name);
    const description = outputByKey.get(key);
    if (description !== undefined) {
      matched.set(key, description);
      consumedKeys.add(key);
    } else {
      unmatchedInputs.push(name);
    }
  }

  // Positional fallback: a complete, in-order answer with rewritten names
  if (unmatchedInputs.length > 0 && outputs.length === serviceNames.length) {
    const unconsumedOutputs = outputs.filter(
      (s) => !consumedKeys.has(nameKey(s.serviceName))
    );
    if (unconsumedOutputs.length === unmatchedInputs.length) {
      unmatchedInputs.forEach((name, i) => {
        matched.set(nameKey(name), unconsumedOutputs[i].description);
      });
    }
  }

  return matched;
}

/**
 * Generate GBP service descriptions for any number of services.
 *
 * Large lists (service-rich categories expose 30-70 GBP service types) are
 * split into small batches run with limited concurrency. Results are mapped
 * back to the EXACT input names — Claude's output names are only used for
 * matching, never returned — and names Claude drops (or whole failed batches)
 * get one retry pass. Descriptions are clamped to Google's 300-character
 * limit.
 *
 * All-or-nothing: if any service still has no description after the retry
 * pass, this throws ServiceGenerationIncompleteError instead of returning a
 * partial set — callers replace their saved services with the result, so a
 * partial return would silently destroy existing descriptions.
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
  const { serviceNames, ...context } = params;

  // Dedupe case/punctuation-insensitively, keeping first casing + input order
  const canonicalNames: string[] = [];
  const seen = new Set<string>();
  for (const name of serviceNames) {
    const key = nameKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    canonicalNames.push(name);
  }

  if (canonicalNames.length === 0) return [];

  const descriptions = new Map<string, string>();
  let lastError: unknown = null;

  const runPass = async (names: string[]) => {
    const batches = chunk(names, BATCH_SIZE);
    for (const wave of chunk(batches, BATCH_CONCURRENCY)) {
      await Promise.all(
        wave.map(async (batch) => {
          try {
            const generated = await generateBatch(context, batch);
            for (const [key, description] of generated) {
              descriptions.set(key, description);
            }
          } catch (error: unknown) {
            lastError = error;
            console.error(
              `[service-generator] Batch of ${batch.length} failed:`,
              error
            );
          }
        })
      );
    }
  };

  await runPass(canonicalNames);

  // One retry for anything a batch dropped or a failed batch lost
  const missing = canonicalNames.filter((n) => !descriptions.has(nameKey(n)));
  if (missing.length > 0) {
    await runPass(missing);
  }

  if (descriptions.size === 0) {
    throw lastError instanceof Error
      ? lastError
      : new Error("Failed to generate any service descriptions");
  }

  const stillMissing = canonicalNames.filter(
    (n) => !descriptions.has(nameKey(n))
  );
  if (stillMissing.length > 0) {
    throw new ServiceGenerationIncompleteError(stillMissing);
  }

  return canonicalNames.map((serviceName) => ({
    serviceName,
    description: clampDescription(descriptions.get(nameKey(serviceName))!),
  }));
}
