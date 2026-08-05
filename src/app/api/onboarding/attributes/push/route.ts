import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pushAttributesToGBP } from "@/lib/google-business-info";
import { z } from "zod";
import { idSchema, parseBody } from "@/lib/api-validation";

const pushAttributesSchema = z.object({
  profileId: idSchema,
  attributes: z
    .array(
      z.object({
        attributeId: z.string().min(1).max(200),
        valueType: z.string().min(1).max(50),
        values: z.array(z.unknown()).optional(),
        repeatedEnumValue: z
          .object({
            setValues: z.array(z.string()).optional(),
            unsetValues: z.array(z.string()).optional(),
          })
          .optional(),
        uriValues: z.array(z.object({ uri: z.string().max(2048) })).optional(),
      })
    )
    .min(1)
    .max(200),
});

export async function POST(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(request, pushAttributesSchema);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  const profile = await prisma.profile.findUnique({
    where: { id: body.profileId },
    select: { id: true, googleAccountId: true, locationName: true },
  });

  if (!profile) {
    return NextResponse.json(
      { error: "Profile not found" },
      { status: 404 }
    );
  }

  const result = await pushAttributesToGBP({
    googleAccountId: profile.googleAccountId,
    locationName: profile.locationName,
    attributes: body.attributes,
  });

  if (!result.success) {
    console.error("Attribute push to GBP failed:", result.error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to push attributes to Google Business Profile",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true });
}
