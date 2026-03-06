import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pushAttributesToGBP } from "@/lib/google-business-info";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    profileId: string;
    attributes: Array<{
      attributeId: string;
      valueType: string;
      values?: unknown[];
      repeatedEnumValue?: {
        setValues?: string[];
        unsetValues?: string[];
      };
      uriValues?: Array<{ uri: string }>;
    }>;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  if (!body.profileId) {
    return NextResponse.json(
      { error: "profileId is required" },
      { status: 400 }
    );
  }

  if (!Array.isArray(body.attributes) || body.attributes.length === 0) {
    return NextResponse.json(
      { error: "attributes must be a non-empty array" },
      { status: 400 }
    );
  }

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

  return NextResponse.json({
    success: result.success,
    error: result.error,
  });
}
