/**
 * Finding the storefront address gbp-audit froze for a profile.
 *
 * The audit writes one `before-<date>.json` per audited profile under
 * ~/VineyardGrowth/vault/clients/<slug>/gbp/[<profileId>/], and holds the
 * address at `fields.address.value` as the full postal-address object Google
 * returned, before any renormalization. That file is the store; nothing here
 * invents a second one, and nothing here rebuilds an address out of parts.
 * The whole value of the snapshot is that it is what Google gave us.
 *
 * Split out of scripts/restore-storefront-address.ts so these parts can be
 * tested: that script calls main() at import time, and the repo compiles to
 * CJS (no `"type": "module"`), so there is no import.meta guard available to
 * make it importable.
 *
 * Every function here is a pure decision or a read. Nothing writes.
 */
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Resolved<T> = { ok: true; value: T } | { ok: false; error: string };

/** Google's PostalAddress, kept opaque for the same reason src does. */
export type PostalAddress = Record<string, unknown>;

/** ~/VineyardGrowth/vault, where the registry and the snapshots live. */
export function defaultVaultRoot(): string {
  return join(homedir(), "VineyardGrowth", "vault");
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && /^['"]/.test(trimmed) && trimmed.endsWith(trimmed[0])) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** A list item at the top level of the document: the start of a new entry. */
const ENTRY_START = /^-\s+(.*\S)\s*$/;
/** `  key: value` inside an entry. The value may be empty. */
const KEY_LINE = /^ {2}([A-Za-z_][\w-]*):\s*(.*?)\s*$/;
/** `  - value`, an item of whichever key was named last. */
const LIST_ITEM = /^ {2}-\s*(.+?)\s*$/;

function splitKey(text: string): { key: string; value: string } | null {
  const match = /^([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(text);
  return match ? { key: match[1], value: match[2] } : null;
}

/**
 * The vault slug that claims a RankMaps profile id, from _clients.yaml.
 *
 * Deliberately a reader for the one shape that file is written in rather than
 * a YAML parser: the registry is rewritten by sync-registry.py through
 * yaml.safe_dump with block style, so an entry opens with `- <key>:` at column
 * zero and a list is `  rankmapsProfileIds:` followed by `  - <id>` lines. An
 * empty list is written inline as `[]` and matches nothing, which is correct.
 *
 * The slug is scoped to its own entry. It is cleared at every new list item
 * and set only when that entry's own `slug:` line is read, wherever in the
 * entry that line sits.
 *
 * All 77 entries do open with `- slug:` today, so this has not yet answered
 * anything wrongly in production. Nothing enforces it, though: sync-registry.py
 * and link-rankmaps-profiles.py both pass sort_keys=False over a mapping that
 * happens to start with slug, and without that argument safe_dump sorts
 * alphabetically, which puts `slug` AFTER `rankmapsProfileIds`. A hand edit
 * moves it just as easily, and the header of that file invites hand edits.
 * Carrying a slug across an entry boundary, which is what this used to do,
 * answers an id in the SECOND entry with the FIRST entry's slug, and that is
 * the one wrong answer this function must never give: the caller opens that
 * client's vault folder and pushes the address it finds there onto a live
 * listing.
 *
 * An id found before its entry has named a slug resolves only if a `slug:`
 * line turns up later in the same entry. Anything outside the shape above
 * returns null rather than a guess, and the caller asks the operator for
 * --snapshot instead.
 */
export function findSlugForProfileId(
  registryYaml: string,
  profileId: string
): string | null {
  let slug: string | null = null;
  let matched = false;
  let inProfileIds = false;

  const readKey = (key: string, value: string): void => {
    if (key === "slug") slug = unquote(value);
    // Only a key with no inline value opens a block list. `[]` is an empty
    // list written inline and holds nothing.
    inProfileIds = key === "rankmapsProfileIds" && value === "";
  };

  for (const line of registryYaml.split("\n")) {
    const entry = ENTRY_START.exec(line);
    if (entry) {
      // The entry that was open has ended. If it listed the id, its own slug
      // is the answer, and a null here means that entry never named one.
      if (matched) return slug;

      slug = null;
      inProfileIds = false;
      const kv = splitKey(entry[1]);
      if (kv) readKey(kv.key, kv.value);
      continue;
    }

    const key = KEY_LINE.exec(line);
    if (key) {
      readKey(key[1], key[2]);
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      if (inProfileIds && unquote(item[1]) === profileId) {
        if (slug !== null) return slug;
        // The slug may still be coming: keep reading this entry.
        matched = true;
      }
      continue;
    }

    inProfileIds = false;
  }

  return matched ? slug : null;
}

/**
 * The newest `before-<date>.json` in a directory listing, or null.
 *
 * The date is taken from the filename, not the file's mtime: a snapshot
 * copied or restored from a backup keeps the day it describes, and that is
 * the day the operator is choosing between. ISO dates sort chronologically as
 * strings.
 */
export function newestBeforeSnapshot(names: string[]): string | null {
  const dated = names.filter((name) => /^before-\d{4}-\d{2}-\d{2}\.json$/.test(name));
  if (dated.length === 0) return null;
  return dated.sort()[dated.length - 1];
}

function listDir(dir: string): string[] | null {
  try {
    return readdirSync(dir);
  } catch {
    return null;
  }
}

/**
 * Path of the snapshot to restore from.
 *
 * A profile that has its own directory is answered from that directory or not
 * at all. Badger Gutters has two locations with a directory each, and reading
 * the shared gbp/ folder because this profile's own directory happens to hold
 * no snapshot is how the OTHER location's address gets pushed onto this
 * listing. An empty per-profile directory means the audit for this profile did
 * not freeze one, which is a thing to go and fix, not a thing to substitute
 * for.
 *
 * The client-level folder is read only when the profile has no directory at
 * all, which is where a single-location client's audit writes. That file can
 * still belong to some other profile, so checkSnapshotIdentity has the last
 * word before anything is sent.
 */
export function findSnapshotPath(params: {
  vaultRoot: string;
  slug: string;
  profileId: string;
}): Resolved<string> {
  const clientGbp = join(params.vaultRoot, "clients", params.slug, "gbp");
  const perProfile = join(clientGbp, params.profileId);

  const own = listDir(perProfile);
  if (own) {
    const newest = newestBeforeSnapshot(own);
    if (newest) return { ok: true, value: join(perProfile, newest) };

    return {
      ok: false,
      error:
        `Profile ${params.profileId} has its own snapshot directory, ${perProfile}, ` +
        `and there is no before-<date>.json in it. Refusing to fall back to ` +
        `${clientGbp}: for a client with more than one location the file there can ` +
        `be a different location's address. Run the gbp-audit skill for this ` +
        `profile, or pass --snapshot <path> to the frozen file.`,
    };
  }

  const shared = listDir(clientGbp);
  if (shared) {
    const newest = newestBeforeSnapshot(shared);
    if (newest) return { ok: true, value: join(clientGbp, newest) };
  }

  return {
    ok: false,
    error:
      `No before-<date>.json snapshot for profile ${params.profileId}. Looked in ` +
      `${perProfile} and ${clientGbp}. Run the gbp-audit skill for this client, ` +
      `or pass --snapshot <path> if the frozen address is somewhere else.`,
  };
}

/**
 * The `profile_id` a snapshot records for itself, or null if it records none.
 *
 * gbp-audit writes this key at the top level of every before-<date>.json.
 */
export function snapshotProfileId(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const value = (snapshot as Record<string, unknown>).profile_id;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export type IdentityVerdict =
  | { verdict: "match" }
  | { verdict: "warn"; message: string }
  | { verdict: "refuse"; message: string };

/**
 * Whether this snapshot is allowed to be restored onto this profile.
 *
 * Every path to a snapshot can reach the wrong one. `--snapshot` takes a path
 * from the operator and asks nothing of it. The client-level fallback in
 * findSnapshotPath reads a shared folder that, for a client who later grew a
 * second location, can hold the first location's frozen address. Both were
 * accepted on the strength of the filename alone until 2026-09-21, and a
 * restore that writes the wrong address is the same unrecoverable loss the
 * whole script exists to undo, one street further along.
 *
 * So the snapshot has to say who it is:
 *
 *   names this profile   restore it
 *   names another        refused, in both modes. Nothing about a rehearsal
 *                        makes validating the wrong client's address useful,
 *                        and a rehearsal that passes is what talks somebody
 *                        into re-running it with --write --yes.
 *   names nobody         refused before a write, warned before a rehearsal.
 *                        Reading an unattributed file is how the operator
 *                        finds out what it holds; writing one is a guess.
 */
export function checkSnapshotIdentity(params: {
  snapshot: unknown;
  profileId: string;
  mode: "rehearse" | "write";
}): IdentityVerdict {
  const found = snapshotProfileId(params.snapshot);

  if (found === null) {
    const situation =
      `this snapshot records no profile_id, so nothing in it ties it to ` +
      `profile ${params.profileId}.`;

    if (params.mode === "write") {
      return {
        verdict: "refuse",
        message:
          `Refusing to write: ${situation} Rehearse it first (drop --write and ` +
          `--yes) to see the address it holds, and confirm it is this listing's ` +
          `before restoring it.`,
      };
    }

    return {
      verdict: "warn",
      message:
        `WARNING: ${situation} The rehearsal below validates whatever the file ` +
        `holds. A real write will refuse until the snapshot names its profile.`,
    };
  }

  if (found !== params.profileId) {
    return {
      verdict: "refuse",
      message:
        `This snapshot was frozen for profile ${found}, not ${params.profileId}. ` +
        `Restoring it would put one location's address on another location's ` +
        `listing. Check the path, or run the gbp-audit skill for ${params.profileId}.`,
    };
  }

  return { verdict: "match" };
}

/**
 * `fields.address.value` out of a parsed snapshot, or the reason to refuse.
 *
 * addressLines carries the street, and Google treats a storefrontAddress
 * without it as no address at all, so an empty one is refused here rather
 * than sent and argued about. The object is returned exactly as it was
 * frozen: no field is added, dropped, or reordered.
 */
export function readSnapshotAddress(snapshot: unknown): Resolved<PostalAddress> {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { ok: false, error: "Snapshot is not a JSON object." };
  }

  const fields = (snapshot as Record<string, unknown>).fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return { ok: false, error: "Snapshot has no `fields` object." };
  }

  const field = (fields as Record<string, unknown>).address;
  if (!field || typeof field !== "object" || Array.isArray(field)) {
    return { ok: false, error: "Snapshot has no `fields.address`." };
  }

  const value = (field as Record<string, unknown>).value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      error:
        "Snapshot `fields.address.value` is not an address object. This " +
        "profile may have been audited with no storefront address to freeze.",
    };
  }

  const address = value as PostalAddress;
  const lines = address.addressLines;
  const usable =
    Array.isArray(lines) &&
    lines.some((line) => typeof line === "string" && line.trim() !== "");
  if (!usable) {
    return {
      ok: false,
      error:
        "Snapshot address has no addressLines, so there is no street address " +
        "to restore. Refusing: Google reads a storefrontAddress without " +
        "addressLines as no address.",
    };
  }

  return { ok: true, value: address };
}

/**
 * Read one snapshot file and parse it, with the path named in any refusal.
 *
 * The restore script wants the parsed object rather than just the address:
 * checkSnapshotIdentity reads `profile_id` off the same parse, and reading
 * the file twice would let the two checks disagree about what is in it.
 */
export function loadSnapshotJson(path: string): Resolved<unknown> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return {
      ok: false,
      error: `Could not read snapshot ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return {
      ok: false,
      error: `Snapshot ${path} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/** Read one snapshot file and pull the address out of it. */
export function loadSnapshotAddress(path: string): Resolved<PostalAddress> {
  const parsed = loadSnapshotJson(path);
  if (!parsed.ok) return parsed;

  const address = readSnapshotAddress(parsed.value);
  if (!address.ok) return { ok: false, error: `${address.error} (${path})` };
  return address;
}
