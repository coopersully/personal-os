import type { FinanceSpendingScope } from "@personal-os/domain";

export function formatMoney(
  value: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  if (!currency) return "Currency unknown";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).format(value);
}
/** A legacy aggregate is displayable only when its source currencies agree. */
export function currencyForTotals(
  accounts: readonly { currencyCode: string | null }[],
): string | null {
  const codes = new Set(accounts.map((account) => account.currencyCode));
  return codes.size === 1 ? ([...codes][0] ?? null) : null;
}
export function periodScope(
  period: "week" | "month",
  timezone: string,
  now = new Date(),
): FinanceSpendingScope {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (key: string) => Number(parts.find((item) => item.type === key)?.value);
  const date = new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
  const start = new Date(date);
  const end = new Date(date);
  if (period === "month") {
    start.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
  } else {
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    end.setTime(start.getTime());
    end.setUTCDate(end.getUTCDate() + 6);
  }
  return {
    from: start.toISOString().slice(0, 10),
    through: end.toISOString().slice(0, 10),
    timezone,
    accountIds: null,
    categoryIds: null,
    basis: "personal_cost",
    includePending: true,
    subtractRefunds: true,
  };
}

export function upcomingScope(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (key: string) => Number(parts.find((item) => item.type === key)?.value);
  const start = new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 30);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export function aggregateCurrency(
  value:
    | {
        accounts: {
          balance: number | null;
          currencyCode: string | null;
          includeInPlanning: boolean;
        }[];
        accountSemantics: { trustworthy: boolean };
      }
    | undefined,
) {
  if (!value?.accountSemantics.trustworthy) return null;
  const included = value.accounts.filter((account) => account.includeInPlanning);
  if (included.some((account) => account.balance == null || !Number.isFinite(account.balance)))
    return null;
  return currencyForTotals(included);
}
export function expectedAmount(item: {
  source: { kind: "income" | "obligation" };
  remainingExpectedCents: number | null;
  currencyCode: string;
}) {
  if (item.remainingExpectedCents == null) return "Unavailable";
  return `${item.source.kind === "income" ? "+" : "−"}${formatMoney(item.remainingExpectedCents / 100, item.currencyCode)}`;
}

export function formatLocalDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Preserve a source amount even when its currency is missing; callers label that qualification. */
export function recordAmount(
  value: number | null | undefined,
  currency: string | null | undefined,
) {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  return currency
    ? formatMoney(value, currency)
    : new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
}
