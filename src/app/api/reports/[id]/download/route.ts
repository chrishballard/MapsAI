import { NextResponse, NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateReport } from "@/lib/pdf/report-generator";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const report = await prisma.report.findUnique({
    where: { id },
    include: { profile: true },
  });

  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  try {
    // Generate PDF on-demand
    const pdfBuffer = await generateReport(report.profileId, report.month);

    // Format filename
    const monthStr = report.month
      .toISOString()
      .split("T")[0]
      .substring(0, 7); // YYYY-MM
    const safeName = report.profile.name.replace(/[^a-zA-Z0-9-_ ]/g, "");
    const filename = `${safeName}-${monthStr}.pdf`;

    return new NextResponse(Buffer.from(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("PDF generation error:", err);
    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: 500 }
    );
  }
}
