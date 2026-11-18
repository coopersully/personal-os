import type { FinanceTransaction, FinanceTransactionAllocation } from "@personal-os/domain";
import { parseAmount } from "./mutations";

export type SplitTreatment = FinanceTransactionAllocation["treatment"];

/** One part of a split as it is being edited; `amount` is the text in its field. */
export interface SplitPart {
  key: string;
  amount: string;
  categoryId: string | null;
  rationale: string;
  treatment: SplitTreatment;
}

export const splitRationale = "User-entered transaction breakdown.";
/** The API accepts at most this many parts in one breakdown. */
export const maxSplitParts = 100;

/** The parts that currently divide a transaction, in their saved order. */
export function activeAllocations(
  item: Pick<FinanceTransaction, "allocations">,
): FinanceTransactionAllocation[] {
  return (item.allocations ?? [])
    .filter((allocation) => allocation.state === "active")
    .sort((left, right) => left.allocationOrder - right.allocationOrder);
}

/** A transaction is split once more than one part divides it; one part is a plain category. */
export function isSplit(item: Pick<FinanceTransaction, "allocations">): boolean {
  return activeAllocations(item).length > 1;
}

const cents = (amount: number) => Math.round(amount * 100);
/** Cents as the text of an amount field. */
export const centsText = (value: number) => (value / 100).toFixed(2);

export interface SplitBalance {
  /** Cents of the transaction not yet given to a part; negative when the parts exceed it. */
  remainingCents: number;
  /** Two parts share a category and treatment, which the API stores as one. */
  duplicate: boolean;
  /** Every part is complete and together they equal the transaction amount exactly. */
  balanced: boolean;
}

/** Whether the parts as typed reconcile to the transaction amount. */
export function splitBalance(parts: readonly SplitPart[], transactionAmount: number): SplitBalance {
  const amounts = parts.map((part) => parseAmount(part.amount));
  const assigned = amounts.reduce<number>((sum, amount) => sum + cents(amount ?? 0), 0);
  const remainingCents = cents(transactionAmount) - assigned;
  const keys = parts
    .filter((part) => part.categoryId)
    .map((part) => `${part.categoryId}:${part.treatment}`);
  const duplicate = new Set(keys).size !== keys.length;
  return {
    remainingCents,
    duplicate,
    balanced:
      parts.length > 0 &&
      remainingCents === 0 &&
      !duplicate &&
      amounts.every((amount) => amount !== undefined) &&
      parts.every((part) => part.categoryId),
  };
}

/** The draft a split editor opens with: the saved parts, or the whole amount and an empty part. */
export function initialSplitParts(
  item: Pick<FinanceTransaction, "allocations" | "amount" | "categoryId">,
): SplitPart[] {
  const saved = activeAllocations(item);
  if (saved.length)
    return saved.map((allocation) => ({
      key: allocation.id,
      amount: allocation.amount.toFixed(2),
      categoryId: allocation.categoryId,
      rationale: allocation.rationale?.trim() || splitRationale,
      treatment: allocation.treatment,
    }));
  return [
    {
      key: "new-0",
      amount: item.amount.toFixed(2),
      categoryId: item.categoryId ?? null,
      rationale: splitRationale,
      treatment: "personal",
    },
    {
      key: "new-1",
      amount: "",
      categoryId: null,
      rationale: splitRationale,
      treatment: "personal",
    },
  ];
}
