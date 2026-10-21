import { requireSession, requireProfile } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchStructuredServices } from "@/lib/google-business-info";
import {
  generateServiceDescriptions,
  ServiceGenerationIncompleteError,
} from "@/lib/service-generator";
import { serviceNameKey } from "@/lib/service-names";
import {
  resolveServiceTypeId,
  saveProfileServices,
  typeIdSlugMap,
} from "@/lib/profile-services";
import { z } from "zod";
import { idSchema, parseBody, serviceNamesSchema } from "@/lib/api-validation";

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
        select: {
          id: true,
          serviceName: true,
          description: true,
          isStructured: true,
          isApproved: true,
          isPushed: true,
          pushedAt: true,
        },
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

    return NextResponse.json({
      currentGBPServices: gbpResult.value,
      savedServices,
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

export async function POST(request: NextRequest) {
  const parsed = await parseBody(
    request,
    z.object({
      profileId: idSchema,
      serviceNames: serviceNamesSchema,
    })
  );
  if (parsed.error) return parsed.error;
  const { profileId, serviceNames } = parsed.data;

  const profile = await requireProfile(profileId);
  if (profile instanceof NextResponse) return profile;

  // Rows are keyed by name and the generator matches names ignoring case
  // and punctuation, so a name listed twice would come back as one service
  // (one row silently missing) or fail the save below
  const spellingsByName = new Map<string, string[]>();
  for (const name of serviceNames) {
    const key = serviceNameKey(name);
    spellingsByName.set(key, [...(spellingsByName.get(key) ?? []), name]);
  }
  const duplicates = [...spellingsByName.values()]
    .filter((spellings) => spellings.length > 1)
    .map((spellings) => [...new Set(spellings)].join(" / "));
  if (duplicates.length > 0) {
    return NextResponse.json(
      { error: `Each service can only be listed once: ${duplicates.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const [keywordRecords, cityRecords, structuredServices, existingServices] =
      await Promise.all([
        prisma.profileKeyword.findMany({
          where: { profileId },
          orderBy: { sortOrder: "asc" },
        }),
        prisma.profileCity.findMany({
          where: { profileId },
          orderBy: { sortOrder: "asc" },
        }),
        fetchStructuredServices({
          googleAccountId: profile.googleAccountId,
          locationName: profile.locationName,
        }),
        prisma.profileService.findMany({
          where: { profileId },
          select: { id: true, serviceName: true, serviceTypeId: true },
        }),
      ]);

    const result = await generateServiceDescriptions({
      businessName: profile.name,
      category: profile.category,
      address: profile.address,
      keywords: keywordRecords.map((k) => k.keyword),
      cities: cityRecords.map((c) => c.city),
      serviceNames,
    });

    // A service is structured only if GBP has a matching serviceTypeId;
    // everything else must be pushed as a free-form item. The replace below
    // deletes every row, so a surviving name (compared case-insensitively, as
    // the push does) keeps the id it already had: on a non-English profile an
    // English title only resolves through it, and an id from an additional
    // category is not in this catalog at all (the push checks it is still
    // valid). Other names resolve the way the push resolves them.
    const typeIdByDisplayName = new Map(
      structuredServices.map((s) => [s.displayName.toLowerCase(), s.serviceTypeId])
    );
    const catalogTypeIds = new Set(structuredServices.map((s) => s.serviceTypeId));
    const storedTypeIds = new Map<string, string>();
    for (const s of existingServices) {
      const key = s.serviceName.toLowerCase();
      if (s.serviceTypeId && !storedTypeIds.has(key)) {
        storedTypeIds.set(key, s.serviceTypeId);
      }
    }
    const keptTypeIds = new Set([...catalogTypeIds, ...storedTypeIds.values()]);
    const typeIdBySlug = typeIdSlugMap(profile.googleLanguageCode, catalogTypeIds);

    // Save generated services to DB (replace full set, matching onboarding
    // pattern). The editor pre-checks every saved service and sends every one
    // still checked, so a saved row left out is one the user unchecked.
    const savedServices = await prisma.$transaction(async (tx) => {
      await tx.profileService.deleteMany({ where: { profileId } });
      await tx.profileService.createMany({
        data: result.map((s) => {
          const serviceTypeId =
            resolveServiceTypeId(
              {
                serviceName: s.serviceName,
                serviceTypeId: storedTypeIds.get(s.serviceName.toLowerCase()),
              },
              typeIdByDisplayName,
              keptTypeIds,
              typeIdBySlug
            )?.serviceTypeId ?? null;
          return {
            profileId,
            serviceName: s.serviceName,
            description: s.description,
            serviceTypeId,
            // What the page shows; the push decides for itself
            isStructured:
              serviceTypeId !== null && catalogTypeIds.has(serviceTypeId),
            isApproved: false,
            isPushed: false,
          };
        }),
      });
      return tx.profileService.findMany({
        where: { profileId },
        orderBy: { createdAt: "asc" },
      });
    });

    return NextResponse.json({ services: savedServices });
  } catch (error: unknown) {
    console.error("Service description generation failed:", error);
    if (error instanceof ServiceGenerationIncompleteError) {
      // Actionable and safe to surface: names the services that need a retry.
      // The saved set is untouched — the replace transaction only runs on a
      // complete generation result.
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Failed to generate service descriptions" },
      { status: 500 }
    );
  }
}

// Persist edits and approval state for saved services (called before push)
export async function PUT(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(
    request,
    z.object({
      profileId: idSchema,
      services: z
        .array(
          z.object({
            serviceName: z.string().min(1).max(200),
            description: z.string().max(1000).optional(),
            isStructured: z.boolean(),
            isApproved: z.boolean().optional(),
            // Google's type id, when the row was picked from its catalog
            serviceTypeId: z.string().max(200).nullish(),
          })
        )
        .min(1)
        .max(100),
      // true when the caller sends its complete list (reoptimize editor);
      // partial savers (suggestions panel) omit it
      replace: z.boolean().optional(),
    })
  );
  if (parsed.error) return parsed.error;
  const { profileId, services, replace } = parsed.data;

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

  const updatedServices = await saveProfileServices(profileId, services, {
    replace: replace ?? false,
  });

  return NextResponse.json({ services: updatedServices });
}
