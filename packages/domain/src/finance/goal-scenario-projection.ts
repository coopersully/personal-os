/** Pure hypothetical model. Cents are supported only for currencies with two minor-unit digits. */
export interface GoalScenarioInput {
  target: { amountCents: number; currency: string };
  sourceGoalRevision: string;
  asOfLocalDate: string;
  progress: {
    amountCents: number | null;
    currency: string;
    confirmed: boolean;
    provenance: string | null;
    asOfLocalDate: string | null;
    sourceRevision: string | null;
  };
  baseline: { name: string; monthlyContributionCents: number };
  alternatives?: { name: string; monthlyContributionCents: number }[];
  firstContributionLocalDate?: string;
  targetLocalDate?: string;
}

export type GoalScenarioReason =
  | "achieved"
  | "projected"
  | "nonpositive_contribution"
  | "progress_unknown"
  | "beyond_horizon";

const MAX_CENTS = 10_000_000_000;
const PERIODS = 1200;

function money(value: number, signed = false): void {
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_CENTS || (!signed && value < 0))
    throw new RangeError("Money must be bounded integer cents.");
}

function date(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError("Expected local ISO date.");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new RangeError("Invalid local ISO date.");
  return parsed;
}

function monthDate(anchor: string, offset: number): string | null {
  const origin = date(anchor);
  const year = origin.getUTCFullYear();
  const month = origin.getUTCMonth() + offset;
  const end = new Date(0);
  end.setUTCFullYear(year, month + 1, 0);
  end.setUTCDate(Math.min(origin.getUTCDate(), end.getUTCDate()));
  if (end.getUTCFullYear() > 9999) return null;
  return end.toISOString().slice(0, 10);
}

function text(value: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function projectGoalScenarios(input: GoalScenarioInput) {
  money(input.target.amountCents);
  if (!text(input.sourceGoalRevision)) throw new RangeError("Source goal revision is required.");
  const currency = input.target.currency;
  if (
    !/^[A-Z]{3}$/.test(currency) ||
    !Intl.supportedValuesOf("currency").includes(currency) ||
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits !== 2
  )
    throw new RangeError(
      "This cents-based projection supports only explicit currencies with two minor-unit digits.",
    );
  if (input.progress.currency !== currency)
    throw new RangeError("Progress currency must match target.");
  date(input.asOfLocalDate);
  if (input.progress.amountCents !== null) money(input.progress.amountCents);
  if (input.progress.asOfLocalDate !== null) {
    date(input.progress.asOfLocalDate);
    if (input.progress.asOfLocalDate > input.asOfLocalDate)
      throw new RangeError("Progress cannot be future dated.");
  }
  const firstDate = input.firstContributionLocalDate ?? input.asOfLocalDate;
  date(firstDate);
  if (firstDate < input.asOfLocalDate)
    throw new RangeError("First contribution precedes projection as-of date.");
  if (input.targetLocalDate !== undefined) date(input.targetLocalDate);
  const alternatives = input.alternatives ?? [];
  if (alternatives.length > 3) throw new RangeError("At most three alternatives are supported.");
  const assumptions = [input.baseline, ...alternatives];
  const names = new Set<string>();
  for (const assumption of assumptions) {
    if (!text(assumption.name) || names.has(assumption.name.trim()))
      throw new RangeError("Scenario names must be nonempty and unique.");
    names.add(assumption.name.trim());
    money(assumption.monthlyContributionCents, true);
  }
  const known =
    input.progress.confirmed === true &&
    input.progress.amountCents !== null &&
    text(input.progress.provenance) &&
    text(input.progress.sourceRevision) &&
    input.progress.asOfLocalDate !== null;
  const remainingCents = known
    ? Math.max(0, input.target.amountCents - (input.progress.amountCents ?? 0))
    : null;
  const scheduledDates: string[] = [];
  for (let i = 0; i < PERIODS; i++) {
    const scheduled = monthDate(firstDate, i);
    if (scheduled === null) break;
    scheduledDates.push(scheduled);
  }
  const scenarios = assumptions.map((assumption) => {
    const curve: {
      localDate: string;
      cumulativeContributionCents: number;
      projectedAmountCents: number;
    }[] = [];
    let reason: GoalScenarioReason =
      remainingCents === null
        ? "progress_unknown"
        : remainingCents === 0
          ? "achieved"
          : assumption.monthlyContributionCents <= 0
            ? "nonpositive_contribution"
            : "beyond_horizon";
    let completionLocalDate: string | null = null;
    if (reason === "beyond_horizon" && remainingCents !== null) {
      let contributed = 0;
      for (const localDate of scheduledDates) {
        // Preserve the exact fixed contribution, including any final overshoot.
        contributed += assumption.monthlyContributionCents;
        curve.push({
          localDate,
          cumulativeContributionCents: contributed,
          projectedAmountCents: (input.progress.amountCents ?? 0) + contributed,
        });
        if (contributed >= remainingCents) {
          reason = "projected";
          completionLocalDate = localDate;
          break;
        }
      }
    }
    return { ...assumption, reason, completionLocalDate, curve };
  });
  const targetDate = input.targetLocalDate;
  const datesThroughTarget =
    targetDate === undefined
      ? 0
      : scheduledDates.filter((scheduled) => scheduled <= targetDate).length;
  const targetDateRequirement =
    targetDate === undefined
      ? null
      : {
          localDate: targetDate,
          scheduledContributionCount: datesThroughTarget,
          reason:
            remainingCents === null
              ? "progress_unknown"
              : remainingCents === 0
                ? "achieved"
                : targetDate < input.asOfLocalDate
                  ? "past_target_date"
                  : targetDate > (scheduledDates.at(-1) ?? firstDate)
                    ? "beyond_horizon"
                    : datesThroughTarget === 0
                      ? "no_scheduled_contributions"
                      : "projected",
          requiredMonthlyContributionCents:
            remainingCents !== null &&
            remainingCents > 0 &&
            targetDate >= input.asOfLocalDate &&
            targetDate <= (scheduledDates.at(-1) ?? firstDate) &&
            datesThroughTarget > 0
              ? Math.ceil(remainingCents / datesThroughTarget)
              : null,
        };
  return {
    model: "hypothetical_fixed_monthly_zero_growth" as const,
    currency,
    currencyMinorUnitDigits: 2 as const,
    sourceGoalRevision: input.sourceGoalRevision,
    progress: { ...input.progress },
    asOfLocalDate: input.asOfLocalDate,
    firstContributionLocalDate: firstDate,
    firstContributionBasis:
      input.firstContributionLocalDate === undefined
        ? ("monthly_assumption_starting_as_of" as const)
        : ("explicit" as const),
    maxMonthlyPeriods: PERIODS,
    remainingCents,
    scenarios,
    targetDateRequirement,
  };
}
