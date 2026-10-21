/**
 * Prisma's known-request error codes the API routes answer on. Matched on the
 * code alone so a test can throw a plain `{ code }` object.
 *
 *   P2002  unique constraint violated (a duplicate)
 *   P2003  foreign key violated (the parent row doesn't exist)
 *   P2025  the row to update or delete wasn't found
 */
export type PrismaErrorCode = "P2002" | "P2003" | "P2025";

export function isPrismaError(err: unknown, code: PrismaErrorCode): boolean {
  return (err as { code?: unknown } | null)?.code === code;
}
