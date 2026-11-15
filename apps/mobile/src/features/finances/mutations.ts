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

/** An exact amount above zero with at most two decimals; `undefined` when the text is not one. */
export function parseAmount(text: string): number | undefined {
  const value = text.trim();
  // A comma is only ever thousands grouping: "12,50" is a correction, never 1250.
  if (!/^(\d+|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/.test(value)) return undefined;
  const amount = Number(value.replaceAll(",", ""));
  return amount > 0 ? amount : undefined;
}

/** Today's calendar date in the account planning timezone, as the API's date-only value. */
export function localToday(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export interface TransactionAttempt {
  accountId: string;
  amount: number;
  date: string;
  direction: string;
  merchant: string;
}
/** A record that an earlier, unconfirmed add of the same transaction would have produced. */
export function matchesAttempt(item: TransactionAttempt, attempt: TransactionAttempt): boolean {
  return (
    item.accountId === attempt.accountId &&
    item.date === attempt.date &&
    item.direction === attempt.direction &&
    Math.round(item.amount * 100) === Math.round(attempt.amount * 100) &&
    item.merchant.trim().toLowerCase() === attempt.merchant.trim().toLowerCase()
  );
}

export interface CategorizationTally {
  applied: number;
  review: number;
  changed: number;
  failed: number;
  unconfirmed: number;
}
/** One outcome per submitted record. A record the response omits is unconfirmed, never applied. */
export function tallyCategorizations(
  ids: readonly string[],
  results: readonly {
    transactionId: string;
    applied: boolean;
    status: string;
    error: { code: string } | null;
  }[],
): CategorizationTally {
  const byId = new Map(results.map((result) => [result.transactionId, result]));
  const tally: CategorizationTally = {
    applied: 0,
    review: 0,
    changed: 0,
    failed: 0,
    unconfirmed: 0,
  };
  for (const id of ids) {
    const result = byId.get(id);
    if (!result) tally.unconfirmed += 1;
    else if (result.status === "applied" && result.applied) tally.applied += 1;
    else if (result.status === "review_required") tally.review += 1;
    else if (result.error?.code === "conflict") tally.changed += 1;
    else tally.failed += 1;
  }
  return tally;
}

/** The parts of a batch that were not applied, in the words the toast uses. */
export function describeTally(tally: CategorizationTally): string {
  return [
    tally.review ? `${tally.review} sent to review` : null,
    tally.changed ? `${tally.changed} changed elsewhere` : null,
    tally.failed ? `${tally.failed} not changed` : null,
    tally.unconfirmed ? `${tally.unconfirmed} unconfirmed` : null,
  ]
    .filter(Boolean)
    .join(", ");
}
