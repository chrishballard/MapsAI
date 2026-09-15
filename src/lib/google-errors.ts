/**
 * Shared decoding for Google Business Profile API errors.
 *
 * A GBP 400 carries nothing useful in `error.message` — it is always
 * "Request contains an invalid argument." The actionable part lives in
 * `error.details[]`: BadRequest.fieldViolations naming the field and the
 * rule it broke, or an ErrorInfo with a machine-readable `reason`. Every
 * push helper runs its failure through `describeGoogleError` so the string
 * that reaches a caller (and the operator reading the log) says which field
 * Google rejected and why.
 */

interface FieldViolation {
  field?: string;
  description?: string;
}

interface ErrorDetail {
  "@type"?: string;
  fieldViolations?: FieldViolation[];
  reason?: string;
  domain?: string;
  metadata?: Record<string, string>;
}

interface GoogleApiErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: ErrorDetail[];
  };
}

interface GaxiosLikeError {
  response?: { status?: number; data?: unknown };
  code?: string | number;
  message?: string;
}

function errorBody(error: unknown): GoogleApiErrorBody["error"] | undefined {
  const data = (error as GaxiosLikeError)?.response?.data;
  if (!data || typeof data !== "object") return undefined;
  return (data as GoogleApiErrorBody).error;
}

/** HTTP status of a failed Google call, when there was a response at all. */
export function googleErrorStatus(error: unknown): number | undefined {
  return (error as GaxiosLikeError)?.response?.status;
}

/**
 * True when the call failed only because the API is switched off for the
 * Cloud project — a 403 whose details carry ErrorInfo.reason SERVICE_DISABLED.
 * Distinct from a permissions or quota problem: the fix is one click in the
 * console, and `serviceDisabledActivationUrl` returns that link.
 */
export function isServiceDisabled(error: unknown): boolean {
  return (errorBody(error)?.details ?? []).some(
    (d) => d.reason === "SERVICE_DISABLED"
  );
}

/** Console link Google supplies with a SERVICE_DISABLED error, if present. */
export function serviceDisabledActivationUrl(error: unknown): string | null {
  for (const detail of errorBody(error)?.details ?? []) {
    if (detail.reason === "SERVICE_DISABLED" && detail.metadata?.activationUrl) {
      return detail.metadata.activationUrl;
    }
  }
  return null;
}

/**
 * True when the host answered with the web console's HTML 404 shell instead
 * of a JSON error. That is not a disabled API — a disabled API returns a JSON
 * 403 (see isServiceDisabled) — it means nothing is routed at that path, so
 * retrying or enabling anything in the console will not change the answer.
 */
export function isUnroutedHost(error: unknown): boolean {
  const e = error as GaxiosLikeError;
  if (e?.response?.status !== 404) return false;
  const data = e.response?.data;
  if (typeof data === "string") return data.trimStart().startsWith("<");
  // Gaxios only parses JSON; an HTML body arrives as a string, and a JSON 404
  // (a genuinely missing resource) has an `error` object instead.
  return data != null && typeof data === "object" && !("error" in data);
}

/**
 * One-line, operator-readable description of a failed Google call: the field
 * violations when Google named them, otherwise the status and message.
 */
export function describeGoogleError(error: unknown, fallback: string): string {
  if (isUnroutedHost(error)) {
    return "Google returned a 404 HTML page — that endpoint is not routed (this is not a disabled-API error, which returns a JSON 403).";
  }

  const body = errorBody(error);
  if (!body) {
    if (error instanceof Error) return error.message;
    return fallback;
  }

  const violations = (body.details ?? []).flatMap((d) => d.fieldViolations ?? []);
  if (violations.length > 0) {
    const parts = violations.map((v) =>
      v.field ? `${v.field}: ${v.description ?? "invalid"}` : (v.description ?? "invalid")
    );
    return `${body.status ?? body.code ?? "error"} — ${parts.join("; ")}`;
  }

  const info = (body.details ?? []).find((d) => d.reason);
  if (info) {
    const meta = info.metadata
      ? ` (${Object.entries(info.metadata)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")})`
      : "";
    return `${info.reason}${meta}`;
  }

  return body.message ?? fallback;
}

/**
 * Why a GBP API could not be reached at all, as opposed to a call that
 * reached it and failed. The audit needs the difference: "the client has no
 * booking link" and "we cannot see whether the client has a booking link"
 * are not the same finding.
 */
export type GBPApiUnavailableReason = "SERVICE_DISABLED" | "NOT_ROUTED";

export interface GBPReadResult<T> {
  ok: boolean;
  data?: T;
  unavailable?: { reason: GBPApiUnavailableReason; activationUrl?: string };
  error?: string;
}

/** Turn a thrown Google error into the failure half of a GBPReadResult. */
export function readFailure<T>(
  error: unknown,
  fallback: string
): GBPReadResult<T> {
  if (isServiceDisabled(error)) {
    return {
      ok: false,
      unavailable: {
        reason: "SERVICE_DISABLED",
        activationUrl: serviceDisabledActivationUrl(error) ?? undefined,
      },
      error: describeGoogleError(error, fallback),
    };
  }
  if (isUnroutedHost(error)) {
    return {
      ok: false,
      unavailable: { reason: "NOT_ROUTED" },
      error: describeGoogleError(error, fallback),
    };
  }
  return { ok: false, error: describeGoogleError(error, fallback) };
}
