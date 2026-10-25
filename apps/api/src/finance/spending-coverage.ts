import type { financeTransactionCoverage } from "@personal-os/database";

export type SpendingCoverageInterval = typeof financeTransactionCoverage.$inferSelect;

/** Completeness is explicit for every selected account/date, never inferred from row count. */
export function spendingDateCoverage(input: {
  userId: string;
  accounts: Array<{ id: string; currencyCode: string | null }>;
  date: string;
  timezone: string;
  asOf: string;
  intervals: SpendingCoverageInterval[];
}): "complete" | "partial" | "unknown" {
  const covered = input.accounts.filter((account) =>
    input.intervals.some(
      (row) =>
        row.userId === input.userId &&
        row.accountId === account.id &&
        account.currencyCode === "USD" &&
        row.timezone === input.timezone &&
        row.currencyCode === "USD" &&
        row.fromDate <= input.date &&
        row.throughDate >= input.date &&
        row.recordedAt.getTime() <= Date.parse(input.asOf) &&
        row.evidenceRef.trim().length > 0,
    ),
  ).length;
  return covered === 0 ? "unknown" : covered === input.accounts.length ? "complete" : "partial";
}
