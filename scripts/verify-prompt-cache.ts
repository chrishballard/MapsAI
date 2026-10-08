/**
 * Live check that prompt caching actually hits on the production model.
 *
 * Each cached call site (review replies in both prompt variants, monthly
 * posts, photo captions) runs twice in a row on the same input. The second
 * call must read the whole cached prefix (system prompt + output schema)
 * the first one wrote, and any write must use the 5-minute TTL.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/verify-prompt-cache.ts
 *
 * Bills real Claude calls on the production model (caches are per model,
 * so a cheaper model would prove nothing; Opus 5.5 thinks on every call):
 * roughly $0.15. Requires ANTHROPIC_API_KEY. The caption check stubs the
 * two database calls captionImage makes, so nothing is read from or written
 * to the database, but the Prisma client still needs DATABASE_URL to load.
 */
import { anthropic } from "../src/lib/claude";
import { prisma } from "../src/lib/prisma";
import { generateReviewResponse } from "../src/lib/review-responder";
import { generateMonthlyPosts } from "../src/lib/post-generator";
import { captionImage } from "../src/lib/image-captioner";

/** Opus 5.5's minimum cacheable prefix. */
const MIN_CACHEABLE = 512;
/** Opus 5.5 bills cache reads at $0.20/MTok against $4 for input. */
const READ_PRICE = 0.05;

interface CallUsage {
  input: number;
  write: number;
  /** Of `write`, tokens written with the 1-hour TTL (none expected). */
  write1h: number;
  read: number;
  output: number;
}

// Record the usage of every response the generators receive.
let calls: CallUsage[] = [];
const realParse = anthropic.messages.parse.bind(anthropic.messages);
anthropic.messages.parse = (async (
  ...args: Parameters<typeof realParse>
) => {
  const message = await realParse(...args);
  calls.push({
    input: message.usage.input_tokens,
    write: message.usage.cache_creation_input_tokens ?? 0,
    write1h: message.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    read: message.usage.cache_read_input_tokens ?? 0,
    output: message.usage.output_tokens,
  });
  return message;
}) as unknown as typeof anthropic.messages.parse;

// captionImage needs an image row, not a real one: serve a 1x1 PNG and
// swallow the caption write.
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64"
);
const imageRows = prisma.profileImage as unknown as Record<string, unknown>;
imageRows.findUnique = async () => ({
  id: "verify-prompt-cache",
  status: "APPROVED",
  data: new Uint8Array(PIXEL_PNG),
  thumbData: null,
  contentType: "image/png",
  googleUrl: null,
  category: null,
  captionedAt: null,
  captionSkipReason: null,
  profile: { name: "Harbor Creek Plumbing", category: "Plumber" },
});
imageRows.update = async () => ({ id: "verify-prompt-cache" });

const review = {
  businessName: "Harbor Creek Plumbing",
  businessCategory: "Plumber",
  reviewerName: "Dana R.",
  starRating: 5,
  reviewComment:
    "Showed up within an hour on a Sunday and fixed our burst pipe for exactly the price quoted.",
};

// A healthcare category switches review replies to their second prompt.
const healthcareReview = {
  businessName: "Lakeside Family Dental",
  businessCategory: "Dentist",
  businessPhone: "(704) 555-0199",
  reviewerName: "Sam P.",
  starRating: 5,
  reviewComment: "Friendly front desk and they got me in the same week.",
};

const postProfile = {
  name: "Harbor Creek Plumbing",
  category: "Plumber",
  address: "120 Marina Way, Mooresville, NC 28117",
  keywords: ["emergency plumber", "water heater repair", "drain cleaning"],
  cities: ["Mooresville, NC", "Cornelius, NC"],
};

/** The first call a generator makes (a healthcare draft may retry once). */
async function firstCall(fn: () => Promise<unknown>): Promise<CallUsage> {
  calls = [];
  await fn();
  return calls[0];
}

/** Input cost of these calls relative to sending them uncached. */
function savings(usage: CallUsage[]): number {
  const uncached = usage.reduce((sum, c) => sum + c.input + c.write + c.read, 0);
  const cached = usage.reduce(
    (sum, c) =>
      sum + c.input + 1.25 * (c.write - c.write1h) + 2 * c.write1h + READ_PRICE * c.read,
    0
  );
  return (1 - cached / uncached) * 100;
}

async function main() {
  const failures: string[] = [];
  const sites: [string, () => Promise<unknown>][] = [
    ["review-response", () => generateReviewResponse(review)],
    ["review-healthcare", () => generateReviewResponse(healthcareReview)],
    ["monthly-posts", () => generateMonthlyPosts(postProfile)],
    ["image-caption", () => captionImage("verify-prompt-cache")],
  ];

  for (const [name, call] of sites) {
    const usage = [await firstCall(call), await firstCall(call)];
    usage.forEach((c, i) =>
      console.log(
        `${name.padEnd(18)} call ${i + 1}: input=${c.input} ` +
          `cache_write=${c.write} cache_read=${c.read} output=${c.output}`
      )
    );

    // The first call may write the prefix or, if this script ran in the last
    // 5 minutes, read it. Either way that is the prefix's full size.
    const prefix = usage[0].write + usage[0].read;
    if (prefix < MIN_CACHEABLE) {
      failures.push(
        `${name}: cached prefix is ${prefix} tokens, under the ${MIN_CACHEABLE}-token minimum`
      );
    } else if (usage[1].read !== prefix || usage[1].write !== 0) {
      failures.push(
        `${name}: second call read ${usage[1].read} / wrote ${usage[1].write}; ` +
          `expected to read all ${prefix} and write 0`
      );
    }
    const written = usage.find((c) => c.write > 0);
    if (written && written.write1h !== 0) {
      failures.push(
        `${name}: wrote ${written.write1h} of ${written.write} tokens with the 1-hour TTL; expected 5 minutes`
      );
    }
    console.log(
      `${name.padEnd(18)} these 2 calls vs uncached: ${savings(usage).toFixed(0)}% lower input cost\n`
    );
  }

  if (failures.length > 0) {
    console.error(`FAIL\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }
  console.log("PASS: every cached call site read its prefix back.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
