import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseBody } from "@/lib/api-validation";
import { confirmsGoogleAccount } from "@/lib/google-account-confirm";
import { isPrismaError } from "@/lib/prisma-errors";

// The body must name the account being disconnected. One request deletes
// every profile under the login and all of their RankMaps history (posts,
// reviews and replies, metrics, reports, photos), so a bare DELETE, a stray
// script or a confirm dialog clicked through too fast must not be enough.
const disconnectSchema = z.object({ confirmEmail: z.string().max(320) });

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;

  const parsed = await parseBody(request, disconnectSchema);
  if (parsed.error) return parsed.error;

  const account = await prisma.googleAccount.findUnique({
    where: { id },
    select: { googleEmail: true },
  });
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  if (!confirmsGoogleAccount(parsed.data.confirmEmail, account.googleEmail)) {
    return NextResponse.json(
      {
        error:
          "The email typed does not match this account. Nothing was disconnected.",
      },
      { status: 400 }
    );
  }

  try {
    // Cascade delete will remove associated profiles
    await prisma.googleAccount.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isPrismaError(error, "P2025")) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    console.error("Disconnect account error:", error);
    return NextResponse.json(
      { error: "Failed to disconnect account" },
      { status: 500 }
    );
  }
}
