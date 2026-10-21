import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fetchCurrentDescription } from "@/lib/google-business-info";
import { saveProfileDescription } from "@/lib/profile-description";
import {
  descriptionContentSchema,
  idSchema,
  parseBody,
} from "@/lib/api-validation";

export async function GET(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get("profileId");

  if (!profileId) {
    return NextResponse.json(
      { error: "profileId is required" },
      { status: 400 }
    );
  }

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: {
      id: true,
      googleAccountId: true,
      locationName: true,
    },
  });

  if (!profile) {
    return NextResponse.json(
      { error: "Profile not found" },
      { status: 404 }
    );
  }

  // GBP read failure shouldn't hide the saved description — degrade to null
  // but tell the client the live value is unknown rather than empty.
  const [description, gbpResult] = await Promise.all([
    prisma.profileDescription.findFirst({
      where: { profileId },
      orderBy: { updatedAt: "desc" },
    }),
    fetchCurrentDescription({
      googleAccountId: profile.googleAccountId,
      locationName: profile.locationName,
    }).then(
      (value) => ({ value, error: null as string | null }),
      (error: unknown) => {
        console.error("Failed to fetch current GBP description:", error);
        return {
          value: null,
          error: "Failed to fetch current GBP description",
        };
      }
    ),
  ]);

  return NextResponse.json({
    description,
    currentGBPDescription: gbpResult.value,
    gbpError: gbpResult.error,
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(
    request,
    z.object({
      profileId: idSchema,
      content: descriptionContentSchema,
      isApproved: z.boolean().optional(),
    })
  );
  if (parsed.error) return parsed.error;
  const { profileId, content, isApproved } = parsed.data;

  // Look the profile up first: for a missing one the insert below would
  // break its foreign key and answer 500 instead of 404.
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { id: true },
  });

  if (!profile) {
    return NextResponse.json(
      { error: "Profile not found" },
      { status: 404 }
    );
  }

  const description = await saveProfileDescription(
    profileId,
    content,
    isApproved ?? false
  );

  return NextResponse.json({ description });
}
