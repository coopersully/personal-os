import { ApiClientError } from "@personal-os/api-client";

/** A proposed action or a follow-up question is not a saved financial record. */
export function appliedTransaction<T extends { id: string }>(
  value: T | { status: string; result?: T },
): T | null {
  if (!("status" in value)) return value;
  return value.status === "applied" && value.result ? value.result : null;
}

/**
 * Only a definitive client rejection proves nothing was written. A timeout, lost
 * connection or server fault leaves the outcome unknown, so its retry key is kept.
 */
export function confirmedRejection(error: unknown): error is ApiClientError {
  return (
    error instanceof ApiClientError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408
  );
}

/** Blank means the balance is unavailable; `undefined` means the text is not an exact amount. */
export function parseBalance(text: string): number | null | undefined {
  const value = text.trim().replaceAll(",", "");
  if (!value) return null;
  return /^-?\d+(\.\d{1,2})?$/.test(value) ? Number(value) : undefined;
}

export const disconnectedCodes = [
  "finance_account_disconnected",
  "finance_account_legacy_disconnected",
] as const;
/** Tracking was already stopped locally; sync and stop-tracking no longer apply. */
export function trackingStopped(account: {
  synchronization?: { failureCode?: string | null } | null;
}): boolean {
  return (disconnectedCodes as readonly string[]).includes(
    account.synchronization?.failureCode ?? "",
  );
}
