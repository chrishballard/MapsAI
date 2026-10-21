import { requireSession } from "@/lib/auth/require-session";
import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateReport } from "@/lib/pdf/report-generator";
import { getMonthStart, formatMonthISO } from "@/lib/dates";
import { z } from "zod";
import { idSchema, monthStringSchema, parseBody } from "@/lib/api-validation";

const generateReportSchema = z.object({
  profileId: idSchema.optional(),
  month: monthStringSchema.optional(),
});

export async function POST(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(request, generateReportSchema);
  if (parsed.error) return parsed.error;
  const { profileId, month: monthStr } = parsed.data;

  try {
    // Parse month or default to the last complete month (UTC). The month in
    // progress would compare month-to-date against a whole month; it can
    // still be asked for, and the PDF labels it partial.
    const month = monthStr
      ? new Date(monthStr + "-01T00:00:00Z")
      : getMonthStart(new Date(), -1);

    let profiles: Array<{ id: string; name: string }>;

    if (profileId) {
      // Single profile
      const profile = await prisma.profile.findUnique({
        where: { id: profileId },
        select: { id: true, name: true },
      });
      if (!profile) {
        return NextResponse.json(
          { error: "Profile not found" },
          { status: 404 }
        );
      }
      profiles = [profile];
    } else {
      // Bulk: all connected profiles
      profiles = await prisma.profile.findMany({
        where: { isConnected: true },
        select: { id: true, name: true },
      });
    }

    const results: Array<{
      profileId: string;
      profileName: string;
      reportId: string;
      status: string;
    }> = [];

    // Process sequentially to avoid overwhelming resources
    for (const profile of profiles) {
      try {
        // Generate PDF to verify it works (on-demand generation on download)
        await generateReport(profile.id, month);

        // Find existing or create new Report record. Report has no unique
        // on (profileId, month), so two concurrent requests could both miss
        // the find and create twins. The advisory lock serialises them per
        // profile and month and releases with the transaction. $executeRaw,
        // not $queryRaw: the lock function returns void, which Prisma cannot
        // deserialize as a result column.
        const lockKey = `report:${profile.id}:${formatMonthISO(month)}`;
        const report = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
          const existing = await tx.report.findFirst({
            where: { profileId: profile.id, month },
          });
          if (existing) return existing;
          return tx.report.create({
            data: {
              profileId: profile.id,
              month,
            },
          });
        });

        results.push({
          profileId: profile.id,
          profileName: profile.name,
          reportId: report.id,
          status: "success",
        });
      } catch (err) {
        console.error(
          `Failed to generate report for profile ${profile.name}:`,
          err
        );
        results.push({
          profileId: profile.id,
          profileName: profile.name,
          reportId: "",
          status: "error",
        });
      }
    }

    return NextResponse.json({ reports: results });
  } catch (err) {
    console.error("Report generation error:", err);
    return NextResponse.json(
      { error: "Failed to generate reports" },
      { status: 500 }
    );
  }
}
