import type { FinanceToolResult } from "@personal-os/domain";

class ConfirmedFinanceMutationFailure extends Error {}

/** A transport error is ambiguous; only these server results permit a fresh retry key. */
export function isConfirmedFinanceMutationFailure(error: unknown): boolean {
  return (
    error instanceof ConfirmedFinanceMutationFailure ||
    (error instanceof Error &&
      error.message.includes("previously failed; use a new idempotency key"))
  );
}

export function requireFinanceMutationResult<T>(
  result: FinanceToolResult<T>,
): FinanceToolResult<T> {
  if (result.outcome === "failed") {
    throw new ConfirmedFinanceMutationFailure(result.communication.headline);
  }
  return result;
}
