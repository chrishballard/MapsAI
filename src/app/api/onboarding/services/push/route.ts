import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { pushApprovedServices } from "@/lib/profile-services";
import { parseBody, profileIdBodySchema } from "@/lib/api-validation";

export async function POST(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(request, profileIdBodySchema);
  if (parsed.error) return parsed.error;
  const { profileId } = parsed.data;

  // Replace the live GBP list — the onboarding wizard owns the full set
  const result = await pushApprovedServices(profileId, { merge: false });

  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json({
    success: true,
    pushedCount: result.pushedCount,
  });
}
