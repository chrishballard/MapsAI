export class FetchError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "FetchError";
  }
}

/**
 * fetch + JSON parse with a status check. Throws a FetchError carrying the
 * server's `error` message when the response is not ok, so failures can't
 * be silently swallowed.
 */
export async function fetchJson<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(input, init);

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body (e.g. empty 204) — leave data null
  }

  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ??
      `Request failed with status ${res.status}`;
    throw new FetchError(res.status, message);
  }

  return data as T;
}

/** Convenience wrapper for JSON request bodies (POST by default). */
export function sendJson<T = unknown>(
  url: string,
  body: unknown,
  method: "POST" | "PATCH" | "PUT" | "DELETE" = "POST"
): Promise<T> {
  return fetchJson<T>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
