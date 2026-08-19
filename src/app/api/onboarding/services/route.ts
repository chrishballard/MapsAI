import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { fetchStructuredServices } from "@/lib/google-business-info";
import { saveProfileServices } from "@/lib/profile-services";
import { idSchema, parseBody } from "@/lib/api-validation";

export async function GET(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const profileId = request.nextUrl.searchParams.get("profileId");
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

  try {
    // GBP read failure shouldn't hide the saved services — degrade to null
    // but tell the client the live values are unknown rather than empty.
    const [savedServices, gbpResult] = await Promise.all([
      prisma.profileService.findMany({
        where: { profileId },
        orderBy: { createdAt: "asc" },
      }),
      fetchStructuredServices({
        googleAccountId: profile.googleAccountId,
        locationName: profile.locationName,
      }).then(
        (value) => ({ value, error: null as string | null }),
        (error: unknown) => {
          console.error("Failed to fetch current GBP services:", error);
          return {
            value: null,
            error: "Failed to fetch current GBP services",
          };
        }
      ),
    ]);

    // Only use actual GBP structured services — no fake serviceTypeIds
    return NextResponse.json({
      services: savedServices,
      availableServices: gbpResult.value,
      gbpError: gbpResult.error,
    });
  } catch (error: unknown) {
    console.error("Failed to fetch services data:", error);
    return NextResponse.json(
      { error: "Failed to fetch services data" },
      { status: 500 }
    );
  }
}

const saveServicesSchema = z.object({
  profileId: idSchema,
  services: z
    .array(
      z.object({
        serviceName: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        isStructured: z.boolean(),
        isApproved: z.boolean().optional(),
      })
    )
    .min(1)
    .max(100),
});

export async function POST(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(request, saveServicesSchema);
  if (parsed.error) return parsed.error;
  const { profileId, services } = parsed.data;

  // The wizard always sends its complete list — deselected services must be
  // removed or their stale approved rows get pushed back to Google
  const updatedServices = await saveProfileServices(profileId, services, {
    replace: true,
  });

  return NextResponse.json({ services: updatedServices });
}
