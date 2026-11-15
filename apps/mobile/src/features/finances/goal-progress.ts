import type { FinanceGoal } from "@personal-os/domain";
import { formatMoney } from "./presentation";

export interface ConfirmedGoalProgress {
  amount: number;
  currency: string;
  asOf: string;
  /** Whole percent of the target; `null` when the target is zero. */
  percent: number | null;
}

/**
 * The progress a person confirmed for exactly this version of the goal, or `null`.
 *
 * This applies the same rule as the domain's `financePlanningEvidenceApplicability`, which
 * cannot run here: its currency check needs `Intl.supportedValuesOf`, absent from the app's
 * JavaScript runtime. The server validated the currency when it recorded the statement. A
 * recorded amount without a matching statement is never shown as progress.
 */
export function confirmedProgress(
  goal: FinanceGoal,
  owner: string | undefined,
  today: string | undefined,
): ConfirmedGoalProgress | null {
  const evidence = goal.planningEvidence;
  if (!evidence || !owner || !today || goal.status === "removed") return null;
  if (evidence.ownerUserId !== owner || evidence.actor.userId !== owner) return null;
  if (evidence.goalId !== goal.id || evidence.goalVersion !== goal.version) return null;
  if (Math.round(goal.currentAmount * 100) !== evidence.progressAmountCents) return null;
  if (evidence.asOf > today) return null;
  const amount = evidence.progressAmountCents / 100;
  return {
    amount,
    currency: evidence.currencyCode,
    asOf: evidence.asOf,
    percent: goal.targetAmount > 0 ? Math.round((amount / goal.targetAmount) * 100) : null,
  };
}

/** A date-only value with its year: a deadline or statement date is often in another year. */
export function goalDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export const goalPriorities: readonly { value: FinanceGoal["priority"]; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export function goalStatusLabel(status: FinanceGoal["status"]): string {
  return { active: "Active", paused: "Paused", completed: "Completed", removed: "Removed" }[status];
}

/**
 * A goal has no currency of its own: its target reads in the currency of its latest progress
 * statement, even one that no longer applies, so a pause or edit does not change the symbol.
 */
export function goalTarget(goal: FinanceGoal, progress: ConfirmedGoalProgress | null): string {
  return formatMoney(
    goal.targetAmount,
    progress?.currency ?? goal.planningEvidence?.currencyCode ?? "USD",
  );
}

/** One line for a goal row: status when not active, then confirmed progress or its absence. */
export function goalSummary(goal: FinanceGoal, progress: ConfirmedGoalProgress | null): string {
  return [
    goal.status === "active" ? null : goalStatusLabel(goal.status),
    progress
      ? `${formatMoney(progress.amount, progress.currency)} confirmed of ${goalTarget(goal, progress)}`
      : `Target ${goalTarget(goal, null)} · progress not confirmed`,
    goal.deadline ? `by ${goalDate(goal.deadline)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A non-negative amount with at most two decimals, in cents; `undefined` when it is not one. */
export function parseProgressCents(text: string): number | undefined {
  const value = text.trim();
  // A comma is only ever thousands grouping: "12,50" is a correction, never 1250.
  if (!/^(\d+|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/.test(value)) return undefined;
  const [whole, fraction = ""] = value.replaceAll(",", "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return cents <= 2_147_483_647 ? cents : undefined;
}

/** A goal target: zero to 100,000,000 with at most two decimals; `undefined` when it is not one. */
export function parseTarget(text: string): number | undefined {
  const value = text.trim();
  if (!/^(\d+|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/.test(value)) return undefined;
  const amount = Number(value.replaceAll(",", ""));
  return amount <= 100_000_000 ? amount : undefined;
}
