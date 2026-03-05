import { NextResponse, NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateReport } from "@/lib/pdf/report-generator";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { profileId, month: monthStr } = body as {
      profileId?: string;
      month?: string;
    };

    // Parse month or default to current month
    const month = monthStr
      ? new Date(monthStr + "-01T00:00:00Z")
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

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

        // Find existing or create new Report record
        let report = await prisma.report.findFirst({
          where: { profileId: profile.id, month },
        });

        if (!report) {
          report = await prisma.report.create({
            data: {
              profileId: profile.id,
              month,
            },
          });
        }

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
