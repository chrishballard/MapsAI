import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { generateDashboardReport } from "@/lib/pdf/report-generator";
import { z } from "zod";
import { dateStringSchema, idSchema, parseBody } from "@/lib/api-validation";

const dashboardPdfSchema = z.object({
  profileId: idSchema.nullish(),
  from: dateStringSchema,
  to: dateStringSchema,
  narrativeText: z.string().max(20000).nullish(),
});

export async function POST(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(request, dashboardPdfSchema);
  if (parsed.error) return parsed.error;
  const { profileId, from, to, narrativeText } = parsed.data;

  try {
    const fromDate = new Date(from + "T00:00:00Z");
    const toDate = new Date(to + "T00:00:00Z");
    const pdfBytes = await generateDashboardReport(
      profileId ?? null,
      fromDate,
      toDate,
      narrativeText ?? null
    );

    // from/to are schema-validated to YYYY-MM-DD, but sanitize anyway so the
    // header can never carry attacker-controlled bytes
    const safeFrom = from.replace(/[^a-zA-Z0-9-_ ]/g, "");
    const safeTo = to.replace(/[^a-zA-Z0-9-_ ]/g, "");

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="dashboard-report-${safeFrom}-to-${safeTo}.pdf"`,
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
