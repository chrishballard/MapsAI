/**
 * Measures how the description generator's length loop behaves live: the
 * length after every Claude call, how many calls each run took, and whether
 * the final text was truncated or still outside 700-750.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/measure-description-length.ts \
 *     [--model=<model id>] [--out=file.json]
 *
 * Bills real calls: 10 runs, up to 3 calls each; the exact cost is printed
 * at the end (Opus 5.5 bills its thinking as output tokens). A run that
 * errors (a refusal, a 400) is reported and the rest still run.
 * Requires ANTHROPIC_API_KEY only.
 *
 * --model swaps only the model on every request, so a candidate can be
 * measured before a switch. Everything else is what the app sends today
 * (an effort level and no thinking parameter), so the candidate must accept
 * that: Sonnet 4.5, for one, rejects the effort setting.
 *
 * History, measured 2026-10-08 on the generator as it was before the move
 * to Opus 5.5 (#3), which sent no effort setting; this version can't
 * reproduce these exactly:
 * - Sonnet 4.5: first drafts 933-1,224 characters, all 10 runs used 3
 *   calls, 8 of 10 were cut at a sentence by the 750 fallback (ending at
 *   582-699 and losing their closing selling points). $0.18.
 * - Sonnet 5.5 with thinking off ("between_tools"): first drafts 740-802,
 *   1.9 calls a run, none cut, all 10 in range. $0.10.
 * Asking for "90 to 95 words" with an exact word delta on retry fixed 4.5
 * (1.8 calls, none cut) but was no better than this on 5.5, so it was not
 * shipped. Opus 5.5 has not been measured.
 */
import { writeFileSync } from "node:fs";
import { anthropic } from "../src/lib/claude";
import { generateDescription } from "../src/lib/description-generator";

// List prices, dollars per million tokens. Cache writes (5-minute) bill
// 1.25x input.
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-sonnet-4-5": { input: 3, output: 15, cacheRead: 0.3 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};

/** Price of one call, or null when the model has no entry in PRICES. */
function callCost(call: Call): number | null {
  // Responses may name a dated snapshot (claude-sonnet-4-5-20250929).
  const price = PRICES[call.model.replace(/-\d{8}$/, "")];
  if (!price) return null;
  return (
    (call.inputTokens * price.input +
      call.cacheWriteTokens * price.input * 1.25 +
      call.cacheReadTokens * price.cacheRead +
      call.outputTokens * price.output) /
    1_000_000
  );
}

const modelOverride = process.argv
  .find((a) => a.startsWith("--model="))
  ?.slice("--model=".length);

interface Call {
  model: string;
  text: string;
  length: number;
  words: number;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  ms: number;
}

let calls: Call[] = [];
const realParse = anthropic.messages.parse.bind(anthropic.messages);
anthropic.messages.parse = (async (
  params: Parameters<typeof realParse>[0],
  options?: Parameters<typeof realParse>[1]
) => {
  const started = Date.now();
  const body = modelOverride ? { ...params, model: modelOverride } : params;
  const message = await realParse(body, options);
  const text =
    (message.parsed_output as { description?: string } | null)?.description ?? "";
  calls.push({
    model: message.model,
    text,
    length: text.length,
    words: text.split(/\s+/).filter(Boolean).length,
    inputTokens: message.usage.input_tokens,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    outputTokens: message.usage.output_tokens,
    ms: Date.now() - started,
  });
  return message;
}) as unknown as typeof anthropic.messages.parse;

const PLUMBER_SITE = [
  "Harbor Creek Plumbing is a family-owned plumbing company that has served homeowners and small businesses across the Lake Norman region since 1994. Our licensed technicians handle everything from a dripping faucet to a full repipe, and every job starts with an honest, upfront price before any work begins.",
  "Emergency plumbing, 24 hours a day. Burst pipes, overflowing toilets and sewer backups do not wait for business hours, and neither do we. A live dispatcher answers every call, and our trucks are stocked with the parts needed to finish most repairs in a single visit.",
  "Water heater repair and installation. We service tank and tankless water heaters from every major manufacturer, flush sediment, replace anode rods and thermocouples, and install high-efficiency units sized to your household so you never run out of hot water halfway through a shower.",
  "Drain cleaning and sewer line services. Slow sinks and recurring clogs usually point to buildup deeper in the line. We use camera inspection to find the cause, hydro-jetting to clear grease and roots, and trenchless repair options that fix a damaged sewer line without tearing up your yard.",
  "Leak detection and repiping. Hidden leaks waste water and quietly damage floors, walls and foundations. Our acoustic and thermal detection equipment pinpoints the source without guesswork, and when old galvanized or polybutylene pipe is the problem we repipe homes with durable PEX or copper.",
  "Fixture installation and remodel plumbing. From a new kitchen sink and garbage disposal to a complete bathroom remodel, we install faucets, toilets, showers, tubs and water filtration systems, and we coordinate with your contractor so rough-in and finish plumbing stay on schedule.",
  "Why homeowners choose us: licensed and insured technicians, background-checked and drug-tested staff, clean work areas protected with floor covers, a one-year labor warranty on every repair, and financing on larger projects. We are proud members of the local chamber of commerce and sponsor youth soccer every spring.",
  "Service area: Mooresville, Cornelius, Davidson, Huntersville, Denver, Sherrills Ford and the surrounding communities. Call or book online to schedule a visit, and ask about our annual maintenance plan, which includes a whole-home plumbing inspection, a water heater flush and priority scheduling.",
]
  .join(" ")
  .slice(0, 3000);

const plumber = {
  name: "Harbor Creek Plumbing",
  category: "Plumber",
  address: "120 Marina Way, Mooresville, NC 28117",
  keywords: [
    "emergency plumber",
    "water heater repair",
    "tankless water heater installation",
    "drain cleaning",
    "leak detection",
    "sewer line repair",
    "hydro jetting",
    "repiping",
    "bathroom remodel plumbing",
    "garbage disposal installation",
  ],
  cities: ["Mooresville, NC", "Cornelius, NC", "Davidson, NC", "Huntersville, NC", "Denver, NC"],
  websiteText: PLUMBER_SITE,
};

// A thinner, different-category input: fewer keywords, short site scrape.
const dentist = {
  name: "Summit Ridge Family Dentistry",
  category: "Dentist",
  address: "4410 Alpine Pkwy, Boise, ID 83706",
  keywords: [
    "family dentist",
    "teeth cleaning",
    "dental implants",
    "teeth whitening",
    "emergency dentist",
    "Invisalign",
  ],
  cities: ["Boise, ID", "Meridian, ID", "Eagle, ID"],
  websiteText:
    "Summit Ridge Family Dentistry has cared for Treasure Valley smiles for over 15 years. Dr. Elena Park and Dr. James Whitfield offer preventive cleanings, digital X-rays, tooth-colored fillings, crowns, single-tooth and full-arch dental implants, in-office whitening and Invisalign clear aligners. Same-day emergency appointments for toothaches and broken teeth. Kids welcome from their first tooth, with a gentle approach for anxious patients and sedation options. We accept most PPO insurance and offer an in-house membership plan for patients without coverage. Evening hours on Tuesdays and Thursdays.",
};

const RUNS: { label: string; profile: typeof plumber }[] = [
  ...Array.from({ length: 4 }, () => ({ label: "plumber+site", profile: plumber })),
  ...Array.from({ length: 3 }, () => ({
    label: "plumber/no-site",
    profile: { ...plumber, websiteText: null as unknown as string },
  })),
  ...Array.from({ length: 3 }, () => ({ label: "dentist+site", profile: dentist })),
];

interface Run {
  label: string;
  /** Every call billed, including any made before an error. */
  calls: Call[];
  final: string;
  finalLength: number;
  truncated: boolean;
  inRange: boolean;
}

interface FailedRun {
  label: string;
  calls: Call[];
  error: string;
}

async function main() {
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const results: Run[] = [];
  const failures: FailedRun[] = [];

  for (const [i, { label, profile }] of RUNS.entries()) {
    calls = [];
    let final: string;
    try {
      final = await generateDescription(profile);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failures.push({ label, calls, error });
      console.log(`#${String(i + 1).padStart(2)} ${label.padEnd(16)} ERROR: ${error}`);
      continue;
    }
    const last = calls[calls.length - 1];
    const run: Run = {
      label,
      calls,
      final,
      finalLength: final.length,
      truncated: final !== last.text,
      inRange: final.length >= 700 && final.length <= 750,
    };
    results.push(run);
    console.log(
      `#${String(i + 1).padStart(2)} ${label.padEnd(16)} ` +
        `calls=${calls.length} lengths=${calls.map((c) => c.length).join(" -> ")} ` +
        `words=${calls.map((c) => c.words).join(" -> ")} ` +
        `final=${final.length}${run.truncated ? " TRUNCATED" : ""}${run.inRange ? "" : " OUT-OF-RANGE"} ` +
        `secs=${(calls.reduce((s, c) => s + c.ms, 0) / 1000).toFixed(1)}`
    );
  }

  const all = results.flatMap((r) => r.calls);
  const billed = [...all, ...failures.flatMap((f) => f.calls)];
  const unpriced = [...new Set(billed.filter((c) => callCost(c) === null).map((c) => c.model))];
  const cost = billed.reduce((s, c) => s + (callCost(c) ?? 0), 0);
  const firstTry = results.filter((r) => r.calls.length === 1).length;
  const truncated = results.filter((r) => r.truncated).length;
  const outOfRange = results.filter((r) => !r.inRange).length;
  const charsPerWord = all.map((c) => c.length / c.words);

  const models = [...new Set(billed.map((c) => c.model))].join(", ");
  console.log(`\nModel: ${models}`);
  console.log(
    `Runs: ${results.length} finished, ${failures.length} errored; calls: ${billed.length}; ` +
      (unpriced.length > 0
        ? `cost: unknown (no price for ${unpriced.join(", ")}; add it to PRICES)`
        : `cost: $${cost.toFixed(3)}`)
  );
  console.log(`Accepted on the first call: ${firstTry}/${results.length}`);
  console.log(`Truncated: ${truncated}/${results.length}; final outside 700-750: ${outOfRange}/${results.length}`);
  if (charsPerWord.length > 0) {
    console.log(
      `Chars per word: min ${Math.min(...charsPerWord).toFixed(2)}, ` +
        `max ${Math.max(...charsPerWord).toFixed(2)}`
    );
  }

  if (outArg) {
    writeFileSync(
      outArg.slice("--out=".length),
      JSON.stringify({ results, failures }, null, 2)
    );
    console.log(`Wrote ${outArg.slice("--out=".length)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
