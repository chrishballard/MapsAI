import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { generateDashboardReport } from "@/lib/pdf/report-generator";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { profileId, from, to, narrativeText } = body as {
    profileId: string | null;
    from: string;
    to: string;
    narrativeText: string | null;
  };

  if (!from || !to) {
    return NextResponse.json(
      { error: "from and to are required" },
      { status: 400 }
    );
  }

  try {
    const fromDate = new Date(from + "T00:00:00Z");
    const toDate = new Date(to + "T00:00:00Z");
    const pdfBytes = await generateDashboardReport(
      profileId ?? null,
      fromDate,
      toDate,
      narrativeText ?? null
    );

    return new NextResponse(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="dashboard-report-${from}-to-${to}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Dashboard PDF generation failed:", error);
    return NextResponse.json(
      { error: "Failed to generate report" },
      { status: 500 }
    );
  }
}
