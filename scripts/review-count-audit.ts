/**
 * One-off read-only audit: DB review rows vs distinct Google reviews vs GBP
 * API totalReviewCount, per profile.
 *
 *   set -a; . ~/.config/vineyardgrowth/rankmaps-prod.env; set +a
 *   npx tsx scripts/review-count-audit.ts [apiSampleSize] [nameFilter]
 *   npx tsx scripts/review-count-audit.ts --plan
 *
 * --plan previews what the review-identity migration
 * (20260903000000_review_identity_and_google_counts) will merge: duplicate
 * groups, how many rows go, and whether any group holds two replies.
 */
import { prisma } from "../src/lib/prisma";
import { fetchReviews } from "../src/lib/google-reviews";

function suffix(id: string) {
  const i = id.indexOf("/locations/");
  return i >= 0 ? id.slice(i) : id;
}

async function plan() {
  const rows = await prisma.$queryRaw<
    {
      groups: bigint;
      rowsToDelete: bigint;
      groupsWithTwoResponses: bigint;
      groupsWithTwoPublished: bigint;
      deletedRowsWithPublished: bigint;
    }[]
  >`
    WITH keyed AS (
      SELECT r.id, r."profileId",
        regexp_replace(r."googleReviewId", '^accounts/[^/]+/', '') AS key,
        rr.status, rr."publishedAt"
      FROM "Review" r LEFT JOIN "ReviewResponse" rr ON rr."reviewId" = r.id
    ),
    grp AS (
      SELECT "profileId", key,
        COUNT(*) AS n,
        COUNT(status) AS with_resp,
        COUNT(*) FILTER (WHERE status = 'PUBLISHED') AS published
      FROM keyed GROUP BY "profileId", key HAVING COUNT(*) > 1
    ),
    ranked AS (
      SELECT k.*, ROW_NUMBER() OVER (
        PARTITION BY k."profileId", k.key
        ORDER BY CASE k.status WHEN 'PUBLISHED' THEN 0 WHEN 'APPROVED' THEN 1
          WHEN 'DRAFTED' THEN 2 WHEN 'PENDING' THEN 3 WHEN 'FAILED' THEN 4
          WHEN 'SKIPPED' THEN 5 ELSE 6 END,
        k."publishedAt" DESC NULLS LAST
      ) AS rn
      FROM keyed k JOIN grp g ON g."profileId" = k."profileId" AND g.key = k.key
    )
    SELECT
      (SELECT COUNT(*) FROM grp) AS "groups",
      (SELECT COALESCE(SUM(n - 1), 0) FROM grp) AS "rowsToDelete",
      (SELECT COUNT(*) FROM grp WHERE with_resp > 1) AS "groupsWithTwoResponses",
      (SELECT COUNT(*) FROM grp WHERE published > 1) AS "groupsWithTwoPublished",
      (SELECT COUNT(*) FROM ranked WHERE rn > 1 AND status = 'PUBLISHED') AS "deletedRowsWithPublished"
  `;
  const r = rows[0];
  console.log(
    JSON.stringify(
      {
        duplicateGroups: Number(r.groups),
        rowsToDelete: Number(r.rowsToDelete),
        groupsWhereBothTwinsHaveAResponse: Number(r.groupsWithTwoResponses),
        groupsWhereBothTwinsPublished: Number(r.groupsWithTwoPublished),
        deletedRowsCarryingAPublishedReply: Number(r.deletedRowsWithPublished),
      },
      null,
      2
    )
  );
  await prisma.$disconnect();
}

async function main() {
  if (process.argv[2] === "--plan") return plan();
  const limit = Number(process.argv[2] ?? 0);
  const nameFilter = process.argv[3]?.toLowerCase();
  const profiles = await prisma.profile.findMany({
    where: { reviewsEnabled: true, accountResourceName: { not: null } },
    select: {
      id: true,
      name: true,
      googleAccountId: true,
      accountResourceName: true,
      locationName: true,
    },
    orderBy: { name: "asc" },
  });
  interface Row {
    name: string;
    dbRows: number;
    distinct: number;
    dupes: number;
    apiTotal: number | string;
  }
  const rows: Row[] = [];
  let n = 0;
  for (const p of profiles) {
    if (nameFilter && !p.name.toLowerCase().includes(nameFilter)) continue;
    const reviews = await prisma.review.findMany({
      where: { profileId: p.id },
      select: { googleReviewId: true },
    });
    const dbRows = reviews.length;
    const distinct = new Set(reviews.map((r) => suffix(r.googleReviewId))).size;
    let apiTotal: number | string = "-";
    if (limit && n < limit) {
      n++;
      try {
        const r = await fetchReviews(
          p.googleAccountId,
          p.accountResourceName!,
          p.locationName
        );
        apiTotal = r.totalReviewCount ?? "null";
      } catch (e) {
        apiTotal =
          "ERR " +
          ((e as { response?: { status?: number } }).response?.status ??
            String(e).slice(0, 40));
      }
    }
    rows.push({
      name: p.name.slice(0, 40),
      dbRows,
      distinct,
      dupes: dbRows - distinct,
      apiTotal,
    });
  }
  console.table(rows);
  const tot = rows.reduce(
    (a, r) => ({ db: a.db + r.dbRows, d: a.d + r.distinct }),
    { db: 0, d: 0 }
  );
  console.log(
    `TOTAL dbRows=${tot.db} distinct=${tot.d} dupes=${tot.db - tot.d} profiles=${rows.length}`
  );
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
