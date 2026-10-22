#!/usr/bin/env tsx
// Read-only audit: for every Google account that holds a Fusion CPA profile in
// RankMaps, list the Fusion locations Google returns, who has admin access
// (pending invites included), and the Voice-of-Merchant / verification state.
// Read-only against Google. Like the app, createGoogleClient saves refreshed
// OAuth tokens to the database DATABASE_URL points at, and marks a login
// needsReauth when Google answers invalid_grant.
import "dotenv/config";
import {
  google,
  type mybusinessaccountmanagement_v1,
  type mybusinessbusinessinformation_v1,
} from "googleapis";
import { prisma } from "../src/lib/prisma";
import { createGoogleClient } from "../src/lib/google";

const NEEDLE = (process.argv[2] ?? "fusion").toLowerCase();

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function main() {
  const profiles = await prisma.profile.findMany({
    where: { name: { contains: NEEDLE, mode: "insensitive" } },
    select: {
      id: true, name: true, address: true, locationName: true, isConnected: true,
      googleAccount: { select: { id: true, googleEmail: true, needsReauth: true } },
    },
  });
  const byAccount = new Map<string, typeof profiles>();
  for (const p of profiles) {
    const k = p.googleAccount.id;
    if (!byAccount.has(k)) byAccount.set(k, []);
    byAccount.get(k)!.push(p);
  }
  for (const [accId, ps] of byAccount) {
    const ga = ps[0].googleAccount;
    console.log(`\n### Google account ${ga.googleEmail} (needsReauth=${ga.needsReauth}) holds ${ps.length} matching RankMaps profiles`);
    let auth;
    try { auth = await createGoogleClient(accId); }
    catch (e) { console.log("  AUTH ERROR:", (e as Error).message); continue; }
    const am = google.mybusinessaccountmanagement({ version: "v1", auth });
    const bi = google.mybusinessbusinessinformation({ version: "v1", auth });
    const ver = google.mybusinessverifications({ version: "v1", auth });
    // accounts.list pages at 20 (the personal account plus every location
    // group the login belongs to); the first page alone missed every location
    // under account 21 onwards.
    const accounts: mybusinessaccountmanagement_v1.Schema$Account[] = [];
    try {
      let accountsPageToken: string | undefined;
      do {
        const r = await am.accounts.list({ pageSize: 20, pageToken: accountsPageToken });
        accounts.push(...(r.data.accounts ?? []));
        accountsPageToken = r.data.nextPageToken ?? undefined;
      } while (accountsPageToken);
    }
    catch (e) { console.log("  accounts.list error:", message(e)); continue; }
    for (const acct of accounts) {
      const locs: mybusinessbusinessinformation_v1.Schema$Location[] = [];
      let pageToken: string | undefined;
      try {
        do {
          const r = await bi.accounts.locations.list({
            parent: acct.name!, pageSize: 100, pageToken,
            readMask: "name,title,storefrontAddress,phoneNumbers,websiteUri,metadata,openInfo",
          });
          locs.push(...(r.data.locations ?? []));
          pageToken = r.data.nextPageToken ?? undefined;
        } while (pageToken);
      } catch (e) { console.log(`  locations.list error on ${acct.name}:`, message(e)); continue; }
      const hits = locs.filter((l) => (l.title ?? "").toLowerCase().includes(NEEDLE));
      if (!hits.length) continue;
      console.log(`\n  Account ${acct.name} "${acct.accountName}" (${acct.type}): ${hits.length} matching of ${locs.length} locations`);
      for (const l of hits) {
        const a = l.storefrontAddress ?? {};
        const inRm = ps.find((p) => p.locationName === l.name || p.locationName.endsWith("/" + String(l.name).split("/").pop()));
        let vom = "(verifications API not enabled on this project)";
        if (process.env.VOM === "1") try {
          const v = (await ver.locations.getVoiceOfMerchantState({ name: l.name! })).data;
          vom = `hasVoiceOfMerchant=${v.hasVoiceOfMerchant ?? false} hasBusinessAuthority=${v.hasBusinessAuthority ?? false}`
            + (v.verify ? ` NEEDS_VERIFICATION(${v.verify.hasPendingVerification ? "pending" : "not started"})` : "")
            + (v.complyWithGuidelines ? ` GUIDELINES:${v.complyWithGuidelines.recommendationReason}` : "")
            + (v.resolveOwnershipConflict ? " OWNERSHIP_CONFLICT" : "")
            + (v.waitForVoiceOfMerchant ? " WAITING_FOR_REVIEW" : "");
        } catch (e) { vom = "VoM error: " + message(e).slice(0, 90); }
        let admins = "";
        try {
          const r = await am.locations.admins.list({ parent: l.name! });
          admins = (r.data.admins ?? []).map((x) => `${x.admin ?? x.account ?? "?"} [${x.role}${x.pendingInvitation ? ", INVITE PENDING" : ""}]`).join("; ");
        } catch (e) { admins = "admins error: " + message(e).slice(0, 90); }
        console.log(`   - ${l.title} | ${a.locality ?? "?"}, ${a.administrativeArea ?? ""} | ${l.phoneNumbers?.primaryPhone ?? "no phone"} | ${l.name} | in RankMaps: ${inRm ? "yes" : "NO"}`);
        console.log(`       state:  ${vom}`);
        console.log(`       admins: ${admins || "(none returned)"}`);
        console.log(`       site:   ${l.websiteUri ?? "-"}`);
        const m = l.metadata ?? {};
        console.log(`       flags:  live(VoM)=${m.hasVoiceOfMerchant ?? "?"} pendingEdits=${m.hasPendingEdits ?? false} duplicate=${m.duplicateLocation ?? "-"} open=${l.openInfo?.status ?? "?"} placeId=${m.placeId ?? "-"}`);
      }
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
