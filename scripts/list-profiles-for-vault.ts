#!/usr/bin/env tsx
/**
 * Emit a flat list of all Rankmaps profiles for vault registry matching.
 *
 * Usage:
 *   pnpm tsx scripts/list-profiles-for-vault.ts
 *
 * Output: JSON array of { id, name, locationName, websiteUrl, address, category }.
 * Consumed by ~/VineyardGrowth/vault/scripts/link-rankmaps-profiles.sh.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const profiles = await prisma.profile.findMany({
    where: { isConnected: true },
    select: {
      id: true,
      name: true,
      locationName: true,
      websiteUrl: true,
      address: true,
      category: true,
    },
    orderBy: { name: "asc" },
  });

  process.stdout.write(JSON.stringify(profiles, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
