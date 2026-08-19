import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_SERVICES_PER_GENERATE } from "@/lib/gbp-limits";

/**
 * Parse and validate a JSON request body against a zod schema.
 * Returns either the parsed data or a ready-to-return 400 response.
 *
 * Usage:
 *   const parsed = await parseBody(request, schema);
 *   if (parsed.error) return parsed.error;
 *   const { profileId } = parsed.data;
 */
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T
): Promise<
  | { data: z.output<T>; error: null }
  | { data: null; error: NextResponse }
> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return {
      data: null,
      error: NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      ),
    };
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    const details = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "body"}: ${issue.message}`
    );
    return {
      data: null,
      error: NextResponse.json(
        { error: "Invalid request body", details },
        { status: 400 }
      ),
    };
  }

  return { data: result.data, error: null };
}

/** Non-empty cuid-ish identifier — length-bounded to keep junk out of queries. */
export const idSchema = z.string().min(1).max(64);

/** Body shape shared by the many routes that only take a profileId. */
export const profileIdBodySchema = z.object({ profileId: idSchema });

/** "YYYY-MM-DD" string that parses to a real UTC date. */
export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .refine((s) => {
    // Round-trip: V8 rolls over out-of-range days (2026-02-31 → Mar 3)
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "must be a valid date");

/** "YYYY-MM" string that parses to a real UTC month. */
export const monthStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "must be YYYY-MM")
  .refine((s) => {
    const d = new Date(`${s}-01T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 7) === s;
  }, "must be a valid month");

/**
 * Service names for description generation. Shared by the onboarding and
 * reoptimize generate routes; the cap matches the save endpoints — the UI
 * pre-checks every GBP service type and service-rich categories expose 30-70.
 */
export const serviceNamesSchema = z
  .array(z.string().min(1).max(200))
  .min(1)
  .max(MAX_SERVICES_PER_GENERATE);

/** GBP description content: non-blank, 750 char max. */
export const descriptionContentSchema = z
  .string()
  .max(750, "content must be 750 characters or less")
  .refine((s) => s.trim().length > 0, "content is required and must be non-empty");
