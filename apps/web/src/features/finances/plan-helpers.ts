import type {
  FinanceBudgetAllocation,
  FinanceBudgetResource,
  FinanceToolResult,
} from "@personal-os/domain";
import {
  isConfirmedFinanceMutationFailure,
  requireFinanceMutationResult,
} from "./mutation-retry.js";

export const allocationLabels: Record<FinanceBudgetAllocation["kind"], string> = {
  spending: "Spending",
  savings: "Savings",
  debt: "Debt payment",
  goal: "Goal contribution",
  buffer: "Buffer",
};

export const resourceLabels: Record<FinanceBudgetResource["kind"], string> = {
  income: "Income",
  reserve_draw: "Reserve draw",
  borrowing: "Borrowing",
  other: "Other resource",
};

export function requireFinancePlanResult<T>(result: FinanceToolResult<T>): FinanceToolResult<T> {
  requireFinanceMutationResult(result);
  if (result.outcome !== "completed") {
    throw new Error(result.communication.headline);
  }
  return result;
}

export function isFinancePlanConflict(error: unknown): boolean {
  if (isConfirmedFinanceMutationFailure(error)) return false;
  return Boolean(
    error &&
      typeof error === "object" &&
      (("status" in error && error.status === 409) ||
        ("code" in error && error.code === "conflict")),
  );
}

/** Amount parsing is only form feedback; saved totals always come from the API. */
export function planAmountCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) && cents <= 10_000_000_000 ? cents : null;
}
