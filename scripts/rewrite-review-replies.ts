/**
 * One-off: rewrite the review replies RankMaps already published for one
 * profile so they read as the owner speaking in the first person, signed.
 *
 * Built for Badger Gutters (call of 2026-08-19). Runs in two phases so the
 * exact wording is approved before anything changes in public.
 *
 *   1. Plan — read-only. Verifies each reply is still ours on Google,
 *      generates the replacement, writes plan JSON + a readable .md.
 *
 *        node --env-file=.env --import tsx scripts/rewrite-review-replies.ts \
 *          --profile "Badger Gutters" --plan --out /tmp/badger-replies
 *
 *   2. Apply — publishes exactly the approved text from the plan file.
 *
 *        node --env-file=.env --import tsx scripts/rewrite-review-replies.ts \
 *          --apply --from /tmp/badger-replies.json
 *
 * Options: --since YYYY-MM-DD (default: every published reply), --limit N
 * (plan a sample first), --save-instructions (also save the persona to the
 * profile so future replies are generated this way).
 *
 * Requires DATABASE_URL, ANTHROPIC_API_KEY, and the GOOGLE_* OAuth vars.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import {
  planReplyRewrite,
  applyReplyRewrite,
  OWNER_PERSONA_INSTRUCTIONS,
  type RewritePlan,
} from "../src/lib/rewrite-review-replies";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : "";
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/**
 * A flag that must be a whole number of 1 or more. `--limit abc` used to
 * become NaN and plan nothing, and a bare `--limit` planned every reply.
 */
function positiveIntFlag(name: string): number | undefined {
  if (!has(name)) return undefined;
  const raw = flag(name);
  if (!raw || !/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new Error(`--${name} needs a whole number of 1 or more, got "${raw ?? ""}"`);
  }
  return Number(raw);
}

/**
 * The profile named by --id or --profile, or, when neither is given, the one
 * a plan file belongs to (so `--apply --from plan.json --save-instructions`
 * needs no second way of naming the profile).
 */
async function resolveProfile(fallbackId?: string): Promise<{ id: string; name: string }> {
  const id = flag("id") || (flag("profile") ? undefined : fallbackId);
  if (id) {
    const profile = await prisma.profile.findUniqueOrThrow({
      where: { id },
      select: { id: true, name: true },
    });
    return profile;
  }

  const name = flag("profile");
  if (!name) throw new Error("Pass --profile \"<name>\" or --id <profileId>");

  const matches = await prisma.profile.findMany({
    where: { name: { contains: name, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (matches.length === 0) throw new Error(`No profile matching "${name}"`);
  if (matches.length > 1) {
    throw new Error(
      `"${name}" matches ${matches.length} profiles — rerun with --id:\n` +
        matches.map((m) => `  ${m.id}  ${m.name}`).join("\n")
    );
  }
  return matches[0];
}

function renderMarkdown(plan: RewritePlan): string {
  const lines = [
    `# Reply rewrites — ${plan.profileName}`,
    "",
    `${plan.candidates.length} repl${plan.candidates.length === 1 ? "y" : "ies"} to rewrite, ` +
      `${plan.skipped.length} skipped.`,
    "",
    "Nothing has been published. Read the AFTER text, then run the apply step.",
    "",
  ];

  for (const [index, c] of plan.candidates.entries()) {
    lines.push(
      `## ${index + 1}. ${c.reviewerName ?? "Anonymous"} — ${c.rating} star${c.rating === 1 ? "" : "s"}` +
        (c.publishedAt ? ` (replied ${c.publishedAt.slice(0, 10)})` : ""),
      "",
      c.reviewComment ? `> ${c.reviewComment.replace(/\n/g, "\n> ")}` : "> (rating only, no comment)",
      "",
      "**Currently live:**",
      "",
      c.before.replace(/^/gm, "    "),
      "",
      "**Proposed:**",
      "",
      c.after.replace(/^/gm, "    "),
      ""
    );
  }

  if (plan.skipped.length > 0) {
    lines.push("## Skipped", "");
    for (const s of plan.skipped) {
      lines.push(`- ${s.reviewerName ?? "Anonymous"} — ${s.reason}: ${s.detail ?? ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function runPlan() {
  const profile = await resolveProfile();
  const sinceRaw = flag("since");
  const since = sinceRaw ? new Date(sinceRaw) : undefined;
  if (since && Number.isNaN(since.getTime())) {
    throw new Error(`--since "${sinceRaw}" is not a date (use YYYY-MM-DD)`);
  }
  const limit = positiveIntFlag("limit");

  const plan = await planReplyRewrite({
    profileId: profile.id,
    since,
    limit,
  });

  const out = flag("out") || `./reply-rewrites-${profile.id}`;
  writeFileSync(`${out}.json`, JSON.stringify(plan, null, 2));
  writeFileSync(`${out}.md`, renderMarkdown(plan));

  console.log("");
  console.log(`Planned ${plan.candidates.length} rewrite(s), skipped ${plan.skipped.length}.`);
  for (const s of plan.skipped) {
    console.log(`  skipped ${s.reviewerName ?? "anonymous"}: ${s.reason}`);
  }
  console.log("");
  console.log(`Read:  ${out}.md`);
  console.log(`Apply: node --env-file=.env --import tsx scripts/rewrite-review-replies.ts --apply --from ${out}.json`);
}

/** Returns the plan's profile id, for --save-instructions. */
async function runApply(): Promise<string> {
  const from = flag("from");
  if (!from) throw new Error("Pass --from <plan.json> (produced by --plan)");

  const plan = JSON.parse(readFileSync(from, "utf8")) as RewritePlan;
  if (!plan.candidates?.length) {
    console.log("Plan has no candidates — nothing to do.");
    return plan.profileId;
  }

  console.log(
    `Publishing ${plan.candidates.length} rewritten repl${plan.candidates.length === 1 ? "y" : "ies"} ` +
      `for ${plan.profileName}, paced under the GBP edit limit...`
  );

  const result = await applyReplyRewrite({ plan });

  console.log("");
  console.log(`Rewrote ${result.rewritten} of ${plan.candidates.length}.`);
  for (const s of result.skipped) {
    console.log(`  skipped ${s.reviewerName ?? "anonymous"}: ${s.reason} — ${s.detail ?? ""}`);
  }
  for (const f of result.failed) {
    console.log(`  FAILED ${f.reviewerName ?? "anonymous"}: ${f.detail ?? ""}`);
  }
  if (result.drifted.length > 0) {
    console.log("");
    console.log(
      `${result.drifted.length} repl${result.drifted.length === 1 ? "y is" : "ies are"} live on Google ` +
        `but did not update in the database (the row changed mid-run). Response ids:`
    );
    for (const d of result.drifted) console.log(`  ${d.responseId}`);
  }
  if (result.failed.length > 0) process.exitCode = 1;
  return plan.profileId;
}

async function saveInstructions(fallbackProfileId?: string) {
  const profile = await resolveProfile(fallbackProfileId);
  const existing = await prisma.profile.findUniqueOrThrow({
    where: { id: profile.id },
    select: { reviewInstructions: true },
  });

  if (existing.reviewInstructions?.includes(OWNER_PERSONA_INSTRUCTIONS)) {
    console.log(`${profile.name}: persona instructions already saved.`);
    return;
  }

  const merged = [existing.reviewInstructions?.trim(), OWNER_PERSONA_INSTRUCTIONS]
    .filter(Boolean)
    .join("\n\n");

  await prisma.profile.update({
    where: { id: profile.id },
    data: { reviewInstructions: merged },
  });
  console.log(`${profile.name}: saved persona to Train RankMaps — future replies use it.`);
}

async function main() {
  // Instructions are saved after the plan or apply step, not before: saved
  // first, they would reach the planner twice (from the profile and from
  // the persona this script adds), and resolving the profile for them up
  // front broke `--apply --from`, which names no profile.
  let planProfileId: string | undefined;
  if (has("plan")) await runPlan();
  else if (has("apply")) planProfileId = await runApply();
  else if (!has("save-instructions")) {
    throw new Error("Pass --plan or --apply (see the header of this file)");
  }

  if (has("save-instructions")) await saveInstructions(planProfileId);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
