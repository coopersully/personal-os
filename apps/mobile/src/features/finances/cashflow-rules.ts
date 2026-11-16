import type {
  ConfirmFinanceRecurringScheduleInput,
  FinanceCashflowSourceSnapshots,
  FinanceIncomeStream,
  FinanceOccurrenceMatchEvent,
  FinanceRecurringObligation,
  FinanceRecurringOccurrence,
  FinanceRecurringSchedule,
  FinanceScenarioInput,
} from "@personal-os/domain";
import { isCalendarDate } from "./goal-progress";
import { formatMoney } from "./presentation";

export type RecurringKind = "income" | "obligation";
export type RecurringItem = FinanceIncomeStream | FinanceRecurringObligation;
export type RecurringSource = { kind: RecurringKind; id: string };
export type CashflowTransaction = FinanceCashflowSourceSnapshots["transactions"][number];

const cadences: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every two weeks",
  semimonthly: "Twice a month",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
  irregular: "Irregular",
};
export const scheduleCadences = Object.entries(cadences).map(([value, label]) => ({
  value,
  label,
}));
export const cadenceLabel = (cadence: string) => cadences[cadence] ?? cadence;

export function recurringStatusLabel(status: RecurringItem["status"]) {
  if (status === "needs_review") return "Needs confirmation";
  if (status === "active") return "Active";
  return status === "paused" ? "Paused" : "Cancelled";
}

/** A date with its year: recurring dates can sit in another year. */
export function cashflowDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function recurringSummary(item: RecurringItem) {
  return `${cadenceLabel(item.cadence)} · ${
    item.nextExpectedDate ? `Next ${cashflowDate(item.nextExpectedDate)}` : "Date not established"
  }`;
}

/** Moves a calendar date by whole days. */
export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** The newest schedule statement for a source: the one no later statement replaces. */
export function latestSchedule(
  schedules: readonly FinanceRecurringSchedule[] | undefined,
  source: RecurringSource,
): FinanceRecurringSchedule | null {
  const versions = (schedules ?? []).filter(
    (item) => item.source.kind === source.kind && item.source.id === source.id,
  );
  const replaced = new Set(versions.map((item) => item.supersedesId));
  return versions.find((item) => !replaced.has(item.id)) ?? null;
}

/**
 * A schedule statement describes one revision of its source. Once the source changes, the
 * server stops producing occurrences from it until the schedule is confirmed again.
 */
export function scheduleState(
  schedule: FinanceRecurringSchedule | null,
  item: { revision?: number | undefined },
): "confirmed" | "changed" | "none" {
  if (!schedule) return "none";
  return schedule.sourceRevision === item.revision ? "confirmed" : "changed";
}

export function scheduleSummary(schedule: FinanceRecurringSchedule) {
  const amount =
    schedule.amountCents == null
      ? "amount not stated"
      : formatMoney(schedule.amountCents / 100, schedule.currencyCode);
  return `${cadenceLabel(schedule.cadence)} from ${cashflowDate(schedule.effectiveFrom)} · ${
    schedule.amountBasis === "fixed" ? "Fixed" : "Variable"
  }, ${amount}`;
}

/** Exact cents from typed text; the record holds at most 100,000,000.00. */
export function parseCents(text: string): number | undefined {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return undefined;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return cents <= 10_000_000_000 ? cents : undefined;
}

export function isTimezone(text: string) {
  if (!text || text.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: text });
    return true;
  } catch {
    return false;
  }
}

export interface ScheduleDraft {
  cadence: string;
  timezone: string;
  anchorLocalDate: string | null;
  effectiveFrom: string | null;
  day1: string;
  day2: string;
  amountBasis: string;
  amount: string;
  currencyCode: string;
}
export type ScheduleField =
  | "cadence"
  | "timezone"
  | "anchorLocalDate"
  | "effectiveFrom"
  | "days"
  | "amountBasis"
  | "amount"
  | "currencyCode";
export type ScheduleStatement = Omit<ConfirmFinanceRecurringScheduleInput, "idempotencyKey">;

const monthDay = (text: string) => {
  const day = /^\d{1,2}$/.test(text.trim()) ? Number(text) : 0;
  return day >= 1 && day <= 31 ? day : null;
};

/**
 * Checks a schedule statement the way the server will, so a correction is shown beside the
 * field instead of arriving as a rejection. Returns the statement only when nothing is wrong.
 */
export function scheduleStatement(
  draft: ScheduleDraft,
  context: {
    source: RecurringSource;
    expectedSourceRevision: number;
    supersedes: FinanceRecurringSchedule | null;
    /** The source's own account: the server rejects a schedule stated for any other. */
    accountId: string | null;
    accountCurrency: string | null;
  },
): { statement: ScheduleStatement | null; errors: Partial<Record<ScheduleField, string>> } {
  const errors: Partial<Record<ScheduleField, string>> = {};
  if (!cadences[draft.cadence]) errors.cadence = "Choose how often this repeats.";
  const timezone = draft.timezone.trim();
  if (!isTimezone(timezone)) errors.timezone = "Enter a timezone such as America/New_York.";
  if (!draft.anchorLocalDate || !isCalendarDate(draft.anchorLocalDate))
    errors.anchorLocalDate = "Enter the first date as a date such as 2026-01-15.";
  if (!draft.effectiveFrom || !isCalendarDate(draft.effectiveFrom))
    errors.effectiveFrom = "Enter the effective date as a date such as 2026-01-15.";
  else if (context.supersedes && draft.effectiveFrom <= context.supersedes.effectiveFrom)
    errors.effectiveFrom = `Choose a date after ${cashflowDate(context.supersedes.effectiveFrom)}, when the previous schedule took effect.`;
  const days = [monthDay(draft.day1), monthDay(draft.day2)];
  if (draft.cadence === "semimonthly" && (!days[0] || !days[1] || days[0] === days[1]))
    errors.days = "Enter two different days of the month, each from 1 to 31.";
  if (draft.amountBasis !== "fixed" && draft.amountBasis !== "variable")
    errors.amountBasis = "Choose fixed or variable.";
  const amount = draft.amount.trim() ? parseCents(draft.amount) : null;
  if (amount === undefined) errors.amount = "Enter an amount such as 1250.00.";
  else if (amount === null && draft.amountBasis === "fixed")
    errors.amount = "A fixed schedule needs its amount.";
  const currencyCode = draft.currencyCode.trim();
  if (!/^[A-Z]{3}$/.test(currencyCode))
    errors.currencyCode = "Use a three-letter code such as USD.";
  else if (context.accountCurrency && context.accountCurrency !== currencyCode)
    errors.currencyCode = `This account is held in ${context.accountCurrency}.`;
  if (Object.keys(errors).length) return { statement: null, errors };
  return {
    errors,
    statement: {
      source: context.source,
      expectedSourceRevision: context.expectedSourceRevision,
      supersedesId: context.supersedes?.id ?? null,
      accountId: context.accountId,
      cadence: draft.cadence as ScheduleStatement["cadence"],
      timezone,
      anchorLocalDate: draft.anchorLocalDate as string,
      effectiveFrom: draft.effectiveFrom as string,
      semimonthlyDays:
        draft.cadence === "semimonthly" ? [days[0] as number, days[1] as number] : null,
      amountBasis: draft.amountBasis as ScheduleStatement["amountBasis"],
      amountCents: amount ?? null,
      currencyCode,
    },
  };
}

const occurrenceStates: Record<FinanceRecurringOccurrence["matchState"], string> = {
  expected: "Expected",
  partially_matched: "Partly matched",
  matched: "Matched",
  invalidated: "No longer applies",
};
export const occurrenceStateLabel = (state: FinanceRecurringOccurrence["matchState"]) =>
  occurrenceStates[state];

/** Posted transactions the server will accept as the actual movement for an occurrence. */
export function eligibleTransactions(
  occurrence: FinanceRecurringOccurrence,
  transactions: readonly CashflowTransaction[],
): CashflowTransaction[] {
  const income = occurrence.source.kind === "income";
  return transactions
    .filter(
      (item) =>
        !item.pending &&
        item.accountId === occurrence.accountId &&
        item.currencyCode === occurrence.currencyCode &&
        item.direction === (income ? "income" : "expense") &&
        (income ? item.incomeEligibility.eligible : eligibleAllocations(item).length > 0),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
export const eligibleAllocations = (transaction: CashflowTransaction) =>
  transaction.allocations.filter((item) => item.expenseEligibility.eligible);

/** Every recorded match and reversal for an occurrence, oldest first. */
export function occurrenceEvents(
  occurrence: FinanceRecurringOccurrence,
  events: readonly FinanceOccurrenceMatchEvent[],
) {
  if (!occurrence.occurrenceId) return [];
  return events
    .filter((event) => event.occurrenceId === occurrence.occurrenceId)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}
/** Matches that still count: recorded for this occurrence and not reversed. */
export function activeMatches(
  occurrence: FinanceRecurringOccurrence,
  events: readonly FinanceOccurrenceMatchEvent[],
) {
  const reversed = new Set(
    events.filter((event) => event.kind === "reverse").map((event) => event.reversesMatchId),
  );
  return occurrenceEvents(occurrence, events).filter(
    (event) =>
      event.kind === "match" && occurrence.matchIds.includes(event.id) && !reversed.has(event.id),
  );
}

export const scenarioMoneyFields = [
  { key: "startingCash", label: "Starting cash", required: true },
  { key: "monthlyIncome", label: "Monthly income", required: true },
  { key: "monthlyHousingCost", label: "Monthly housing", required: true },
  { key: "monthlyDebtPayment", label: "Monthly debt payment", required: true },
  { key: "monthlyReserveContribution", label: "Monthly reserve", required: true },
  { key: "debtBalance", label: "Debt balance", required: false },
  { key: "goalTarget", label: "Goal target", required: false },
  { key: "goalCurrent", label: "Goal savings", required: false },
] as const;
export type ScenarioMoneyField = (typeof scenarioMoneyFields)[number]["key"];
export interface ScenarioDraft {
  id: string;
  label: string;
  money: Record<ScenarioMoneyField, string>;
  assumptions: string;
  noOtherSpending: boolean;
  allocations: { id: string; categoryId: string; limit: string }[];
}
export function newScenarioDraft(id: string, label: string): ScenarioDraft {
  return {
    id,
    label,
    assumptions: "",
    noOtherSpending: false,
    allocations: [],
    money: {
      startingCash: "",
      monthlyIncome: "",
      monthlyHousingCost: "",
      monthlyDebtPayment: "",
      monthlyReserveContribution: "",
      debtBalance: "",
      goalTarget: "",
      goalCurrent: "",
    },
  };
}
/** A scenario amount: up to 100,000,000 with two decimals; only starting cash may be negative. */
export function scenarioAmount(text: string, signed = false): number | undefined {
  const pattern = signed ? /^-?\d{1,9}(?:\.\d{1,2})?$/ : /^\d{1,9}(?:\.\d{1,2})?$/;
  if (!pattern.test(text.trim())) return undefined;
  const value = Number(text);
  return Math.abs(value) <= 100_000_000 ? value : undefined;
}
export const horizonMonths = (text: string) => {
  const months = /^\d{1,3}$/.test(text.trim()) ? Number(text) : 0;
  return months >= 1 && months <= 120 ? months : undefined;
};

/** The first thing wrong with a scenario draft, or the plan the comparison accepts. */
export function scenarioPlan(
  draft: ScenarioDraft,
): { plan: FinanceScenarioInput["baseline"] } | { problem: string } {
  const label = draft.label.trim();
  if (!label || label.length > 160) return { problem: "Give each scenario a name." };
  const values: Partial<Record<ScenarioMoneyField, number>> = {};
  for (const field of scenarioMoneyFields) {
    const text = draft.money[field.key];
    const value = scenarioAmount(text, field.key === "startingCash");
    if ((field.required || text.trim()) && value === undefined)
      return {
        problem: `${label}: enter ${field.label.toLowerCase()} as an amount such as 1500.00${field.required ? ", or 0 when it does not apply" : ""}.`,
      };
    if (value !== undefined) values[field.key] = value;
  }
  if (!draft.noOtherSpending && draft.allocations.length === 0)
    return { problem: `${label}: add other monthly spending, or state that there is none.` };
  const budgetAllocations: { categoryId: string; limit: number }[] = [];
  for (const row of draft.allocations) {
    const limit = scenarioAmount(row.limit);
    if (!row.categoryId || limit === undefined)
      return { problem: `${label}: give each spending line a category and an amount.` };
    if (budgetAllocations.some((item) => item.categoryId === row.categoryId))
      return { problem: `${label}: include each spending category only once.` };
    budgetAllocations.push({ categoryId: row.categoryId, limit });
  }
  const assumptions = draft.assumptions
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (draft.noOtherSpending)
    assumptions.push(`${label}: No category spending beyond housing and debt payments.`);
  if (assumptions.length > 25 || assumptions.some((line) => line.length > 500))
    return { problem: `${label}: keep to 25 assumptions of at most 500 characters each.` };
  return {
    plan: { ...values, label, budgetAllocations, assumptions } as FinanceScenarioInput["baseline"],
  };
}

export function scenarioInput(
  drafts: readonly ScenarioDraft[],
  asOf: string | null,
  horizon: string,
): { input: FinanceScenarioInput } | { problem: string } {
  if (!asOf || !isCalendarDate(asOf)) return { problem: "Enter the as-of date." };
  const months = horizonMonths(horizon);
  if (!months) return { problem: "Enter a horizon from 1 to 120 months." };
  const plans: FinanceScenarioInput["baseline"][] = [];
  for (const draft of drafts) {
    const result = scenarioPlan(draft);
    if ("problem" in result) return result;
    plans.push(result.plan);
  }
  if (plans.length < 2) return { problem: "Add an alternative to compare." };
  if (new Set(plans.map((plan) => plan.label)).size !== plans.length)
    return { problem: "Give each scenario a different name." };
  return {
    input: {
      asOf,
      horizonMonths: months,
      baseline: plans[0] as FinanceScenarioInput["baseline"],
      alternatives: plans.slice(1),
    },
  };
}

/** A cost statement describes one revision of a bill; a later change makes it stop applying. */
export function costStatement(item: FinanceRecurringObligation) {
  const evidence = item.planningEvidence;
  if (
    !evidence ||
    evidence.sourceId !== item.id ||
    evidence.sourceRevision !== item.revision ||
    evidence.expectedAmountCents !== Math.round(item.expectedAmount * 100) ||
    evidence.cadence !== item.cadence ||
    evidence.accountId !== item.accountId
  )
    return null;
  return evidence;
}
export const isObligation = (item: RecurringItem): item is FinanceRecurringObligation =>
  "kind" in item;
/** Whole cents of a stored amount, or nothing when the amount is not exact to the cent. */
export function exactCents(amount: number): number | undefined {
  return Number.isFinite(amount) && Number(amount.toFixed(2)) === amount
    ? Math.round(amount * 100)
    : undefined;
}
