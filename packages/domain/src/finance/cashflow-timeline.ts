import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common.js";
import {
  type FinanceAccount,
  financeIncomeStreamSchema,
  financeRecurringObligationSchema,
} from "../finance.js";
import { addLocalDays, localDateAt, localDateToIso, parseLocalDate } from "../time.js";

const dateSchema = z.iso.date();
const timezoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Choose a supported timezone.");
export const financeCashflowScheduleQuerySchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    timezone: timezoneSchema,
    asOf: isoDateTimeSchema,
    accountIds: z
      .array(idSchema)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, "Choose each account once.")
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from > value.to)
      ctx.addIssue({ code: "custom", message: "End date must follow start date.", path: ["to"] });
    if (value.to > localDateToIso(addLocalDays(parseLocalDate(value.from), 365)))
      ctx.addIssue({ code: "custom", message: "Choose at most 366 calendar dates.", path: ["to"] });
  });
export type FinanceCashflowScheduleQuery = z.infer<typeof financeCashflowScheduleQuerySchema>;
export type FinanceCashflowScheduleAccount = Pick<FinanceAccount, "id" | "name" | "currencyCode">;
export type FinanceCashflowScheduleItem = {
  /** A projection key only. Durable occurrence identity requires schedule versions and matching history. */
  key: string;
  source: { kind: "income" | "obligation"; id: string };
  sourceStatus: "active" | "needs_review";
  provenance: "user" | "inferred";
  accountId: string | null;
  accountName: string | null;
  currencyCode: string | null;
  displayName: string;
  kind: "income" | "bill" | "subscription" | "savings";
  expectedAmount: number;
  date: string | null;
  dateCertainty: "expected" | "unknown";
  timing: "past_expected" | "expected" | "unknown";
  lastObservedDate: string | null;
  cadence: string;
};
export type FinanceCashflowScheduleView = {
  from: string;
  to: string;
  timezone: string;
  today: string;
  generatedAt: string;
  dated: FinanceCashflowScheduleItem[];
  undated: FinanceCashflowScheduleItem[];
  projection: { state: "unavailable"; reason: "balance_basis_unavailable" };
  coverage: {
    basis: "next_expected_only";
    recurrenceExpansion: "unavailable";
    matching: "unavailable";
    outsideRangeCount: number;
  };
};

/** Thirty local calendar dates, inclusive. Date-only source records never pass through UTC conversion. */
export function cashflowScheduleRange(asOf: string, timezone: string) {
  isoDateTimeSchema.parse(asOf);
  timezoneSchema.parse(timezone);
  const today = localDateAt(new Date(asOf), timezone);
  return { from: localDateToIso(today), to: localDateToIso(addLocalDays(today, 29)) };
}

/** Existing source records describe only their next expected activity, not a matched occurrence ledger. */
export function projectFinanceCashflowSchedule(
  input: FinanceCashflowScheduleQuery & {
    income: readonly z.infer<typeof financeIncomeStreamSchema>[];
    obligations: readonly z.infer<typeof financeRecurringObligationSchema>[];
    accounts: readonly FinanceCashflowScheduleAccount[];
  },
): FinanceCashflowScheduleView {
  const query = financeCashflowScheduleQuerySchema.parse(input);
  const income = z.array(financeIncomeStreamSchema).parse(input.income);
  const obligations = z.array(financeRecurringObligationSchema).parse(input.obligations);
  const accounts = new Map(input.accounts.map((account) => [account.id, account]));
  const today = localDateToIso(localDateAt(new Date(query.asOf), query.timezone));
  const seen = new Set<string>();
  const items: FinanceCashflowScheduleItem[] = [];
  for (const [sourceKind, records] of [
    ["income", income],
    ["obligation", obligations],
  ] as const) {
    for (const record of records) {
      const identity = `${sourceKind}:${record.id}`;
      if (seen.has(identity)) throw new Error("Duplicate Finance schedule source identity.");
      seen.add(identity);
      if (record.status !== "active" && record.status !== "needs_review") continue;
      if (
        query.accountIds !== undefined &&
        (record.accountId === null || !query.accountIds.includes(record.accountId))
      )
        continue;
      const account = record.accountId ? accounts.get(record.accountId) : undefined;
      const date = record.nextExpectedDate;
      items.push({
        key: `${identity}:${date ?? "undated"}`,
        source: { kind: sourceKind, id: record.id },
        sourceStatus: record.status,
        provenance: record.source,
        accountId: record.accountId,
        accountName: account?.name ?? null,
        currencyCode: account?.currencyCode ?? null,
        displayName: record.displayName,
        kind: "kind" in record ? record.kind : "income",
        expectedAmount: record.expectedAmount,
        date,
        dateCertainty: date ? "expected" : "unknown",
        timing: date === null ? "unknown" : date < today ? "past_expected" : "expected",
        lastObservedDate: record.lastObservedDate,
        cadence: record.cadence,
      });
    }
  }
  const withinRange = (item: FinanceCashflowScheduleItem) =>
    item.date !== null && item.date >= query.from && item.date <= query.to;
  const sort = (a: FinanceCashflowScheduleItem, b: FinanceCashflowScheduleItem) =>
    (a.date ?? "").localeCompare(b.date ?? "") ||
    a.displayName.localeCompare(b.displayName) ||
    a.key.localeCompare(b.key);
  return {
    from: query.from,
    to: query.to,
    timezone: query.timezone,
    today,
    generatedAt: query.asOf,
    dated: items.filter(withinRange).sort(sort),
    undated: items.filter((item) => item.date === null).sort(sort),
    projection: { state: "unavailable", reason: "balance_basis_unavailable" },
    coverage: {
      basis: "next_expected_only",
      recurrenceExpansion: "unavailable",
      matching: "unavailable",
      outsideRangeCount: items.filter((item) => item.date !== null && !withinRange(item)).length,
    },
  };
}
