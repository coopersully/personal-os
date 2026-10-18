import {
  type FinanceSpendingContribution,
  type FinanceSpendingScope,
  type FinanceSpendingSnapshot,
  financeSpendingScopeSchema,
  financeSpendingSnapshotSchema,
} from "@personal-os/domain";
import { z } from "zod";
import {
  activeAllocationsByTransaction,
  excludedReimbursementCentsByAllocation,
} from "../finance-allocation-projections.js";
import { type RecognitionInput, resolveFinanceSpendingEvidence } from "./recognition.js";

export type SpendingEvidenceInput = Omit<
  RecognitionInput,
  "accounts" | "allocations" | "transactions" | "period"
> & {
  accounts: Array<RecognitionInput["accounts"][number] & { userId: string }>;
  allocations: Array<RecognitionInput["allocations"][number] & { categoryId: string | null }>;
  transactions: Array<RecognitionInput["transactions"][number] & { categoryId: string | null }>;
  asOf: string;
  /** Supplied by the owning loader, never inferred from record count. */
  coverage: "complete" | "partial" | "unknown";
};

export function financeSpendingLocalDate(value: string, timezone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Largest-remainder allocation, with canonical source order breaking ties. */
function apportion(amounts: number[], shareBps: number, capacities?: number[]): number[] {
  const numerators = amounts.map((amount) => BigInt(amount) * BigInt(shareBps));
  const values = numerators.map((value) => Number(value / 10_000n));
  const target = Number((numerators.reduce((sum, value) => sum + value, 0n) + 5_000n) / 10_000n);
  const order = numerators
    .map((value, index) => ({ index, remainder: Number(value % 10_000n) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  let remaining = target - values.reduce((sum, value) => sum + value, 0);
  for (const item of order) {
    if (remaining === 0) break;
    if (capacities && (values[item.index] ?? 0) >= (capacities[item.index] ?? 0)) continue;
    values[item.index] = (values[item.index] ?? 0) + 1;
    remaining--;
  }
  return values;
}

/** Pure projection. The caller must load the complete recognition evidence before invoking it. */
export function projectFinanceSpending(
  input: SpendingEvidenceInput,
  requestedScope: FinanceSpendingScope,
): FinanceSpendingSnapshot {
  const scope = financeSpendingScopeSchema.parse(requestedScope);
  z.iso.datetime().parse(input.asOf);
  const monetaryInput = z.number().int().safe().nonnegative();
  for (const item of [...input.transactions, ...input.allocations, ...input.matches])
    monetaryInput.parse(item.amount);
  for (const item of input.reimbursements) {
    monetaryInput.parse(item.expectedAmount);
    monetaryInput.parse(item.receivedAmount);
  }
  // The shared legacy recognition pass multiplies cents by basis points as numbers.
  // Bound its aggregate intermediate so this projection cannot accept lossy evidence.
  const evidenceCents =
    [...input.transactions, ...input.allocations, ...input.matches].reduce(
      (sum, item) => sum + BigInt(item.amount),
      0n,
    ) +
    input.reimbursements.reduce(
      (sum, item) => sum + BigInt(item.expectedAmount) + BigInt(item.receivedAmount),
      0n,
    );
  if (evidenceCents > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 10_000)))
    throw new RangeError("Spending evidence exceeds exact recognition capacity");
  for (const account of input.accounts)
    z.number().int().min(0).max(10_000).nullable().parse(account.ownershipShareBps);
  for (const transaction of input.transactions)
    z.union([z.iso.date(), z.iso.datetime({ offset: true })]).parse(transaction.transactionDate);
  const accounts = input.accounts.filter((account) => account.userId === input.userId);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const transactions = input.transactions.filter(
    (transaction) => transaction.userId === input.userId && accountById.has(transaction.accountId),
  );
  const transactionIds = new Set(transactions.map((transaction) => transaction.id));
  const allocations = input.allocations.filter((allocation) =>
    transactionIds.has(allocation.transactionId),
  );
  const allocationIds = new Set(allocations.map((allocation) => allocation.id));
  const reimbursements = input.reimbursements.filter((item) =>
    allocationIds.has(item.allocationId),
  );
  const reimbursementIds = new Set(reimbursements.map((item) => item.id));
  const matches = input.matches.filter(
    (item) =>
      reimbursementIds.has(item.reimbursementId) && transactionIds.has(item.creditTransactionId),
  );
  const foreignTransactionIds = new Set(
    input.transactions.filter((item) => !transactionIds.has(item.id)).map((item) => item.id),
  );
  const { evidence, qualifications: recognitionQualifications } = resolveFinanceSpendingEvidence({
    ...input,
    accounts,
    transactions,
    allocations,
    reimbursements,
    matches,
    relationships: input.relationships.filter((item) =>
      item.transactionIds.every((id) => !foreignTransactionIds.has(id)),
    ),
  });
  const qualifications: FinanceSpendingSnapshot["qualifications"] = [...recognitionQualifications];
  const missingShares = accounts
    .filter(
      (item) =>
        item.includeInPlanning &&
        item.ownershipType !== "unknown" &&
        item.ownershipShareBps === null,
    )
    .map((item) => item.id)
    .toSorted();
  if (missingShares.length)
    qualifications.push({ code: "ownership_share_unknown", sourceIds: missingShares });
  const coverage =
    input.coverage === "complete" && qualifications.length > 0 ? "partial" : input.coverage;
  const active = activeAllocationsByTransaction(allocations);
  const exclusions = excludedReimbursementCentsByAllocation(reimbursements);
  const contributions: FinanceSpendingContribution[] = [];
  const claimsByAllocation = new Map<string, typeof reimbursements>();
  for (const claim of reimbursements) {
    const claims = claimsByAllocation.get(claim.allocationId) ?? [];
    claims.push(claim);
    claimsByAllocation.set(claim.allocationId, claims);
  }
  for (const transaction of transactions.toSorted((a, b) => a.id.localeCompare(b.id))) {
    const account = accountById.get(transaction.accountId);
    if (
      !account?.includeInPlanning ||
      account.ownershipType === "unknown" ||
      account.ownershipShareBps === null
    )
      continue;
    if (scope.accountIds !== null && !scope.accountIds.includes(account.id)) continue;
    if ((transaction.currencyCode ?? account.currencyCode) !== "USD") continue;
    if (
      evidence.excludedTransactionIds.has(transaction.id) ||
      evidence.transferTransactionIds.has(transaction.id) ||
      transaction.direction === "transfer"
    )
      continue;
    if (
      transaction.pending &&
      (!scope.includePending ||
        (transaction.providerTransactionId !== null &&
          evidence.replacedPendingIds.has(transaction.providerTransactionId)))
    )
      continue;
    const date = financeSpendingLocalDate(transaction.transactionDate, scope.timezone);
    if (date < scope.from || date > scope.through) continue;
    const direction = transaction.providerDirection ?? transaction.direction;
    const refund =
      direction === "income" &&
      scope.subtractRefunds &&
      evidence.refundTransactionIds.has(transaction.id);
    if (direction !== "expense" && !refund) continue;
    const splits = active.get(transaction.id);
    if (
      splits &&
      (splits.length === 0 ||
        splits.reduce((sum, item) => sum + item.amount, 0) !== transaction.amount)
    )
      continue;
    const portions = splits
      ? splits
          .toSorted((a, b) => a.id.localeCompare(b.id))
          .map((item) => ({
            id: item.id,
            categoryId:
              allocations.find((allocation) => allocation.id === item.id)?.categoryId ?? null,
            amount: item.amount,
            exclusion:
              item.treatment === "reimbursable"
                ? Math.min(item.amount, exclusions.get(item.id) ?? 0)
                : 0,
          }))
      : [
          {
            id: null,
            categoryId: transaction.categoryId,
            amount: transaction.amount,
            exclusion: 0,
          },
        ];
    const gross = apportion(
      portions.map((item) => item.amount),
      account.ownershipShareBps,
    );
    const personal = apportion(
      portions.map((item) => item.amount - item.exclusion),
      account.ownershipShareBps,
      gross,
    );
    const outstanding = apportion(
      portions.map((item) =>
        Math.max(
          0,
          item.exclusion -
            (item.id === null ? [] : (claimsByAllocation.get(item.id) ?? [])).reduce(
              (sum, claim) => sum + claim.receivedAmount,
              0,
            ),
        ),
      ),
      account.ownershipShareBps,
      gross,
    );
    let relationshipRecovery =
      scope.basis === "personal_cost"
        ? (evidence.relationshipReimbursementByExpense.get(transaction.id) ?? 0)
        : 0;
    let refundMatched =
      (apportion(
        [evidence.matchedByCredit.get(transaction.id) ?? 0],
        account.ownershipShareBps,
      )[0] ?? 0) + (evidence.relationshipReimbursementByCredit.get(transaction.id) ?? 0);
    for (const [index, portion] of portions.entries()) {
      const amount = gross[index] ?? 0;
      let reimbursement = scope.basis === "personal_cost" ? amount - (personal[index] ?? 0) : 0;
      const relationship = Math.min(amount - reimbursement, relationshipRecovery);
      reimbursement += relationship;
      relationshipRecovery -= relationship;
      const matched = Math.min(amount, refundMatched);
      refundMatched -= matched;
      const refundAmount = refund ? amount - matched : 0;
      if (scope.categoryIds !== null && !scope.categoryIds.includes(portion.categoryId)) continue;
      contributions.push({
        id: `${transaction.id}:${portion.id ?? "unallocated"}`,
        transactionId: transaction.id,
        allocationId: portion.id,
        categoryId: portion.categoryId,
        accountId: account.id,
        date,
        pending: transaction.pending,
        currencyCode: "USD",
        grossCents: refund ? 0 : amount,
        reimbursementAdjustmentCents: refund ? 0 : reimbursement,
        reimbursementOutstandingCents: refund ? 0 : (outstanding[index] ?? 0),
        reimbursementIds:
          portion.id === null
            ? []
            : (claimsByAllocation.get(portion.id) ?? []).map((claim) => claim.id).toSorted(),
        refundAdjustmentCents: refundAmount,
        netCents: refund ? 0 - refundAmount : amount - reimbursement,
      });
    }
  }
  const today = financeSpendingLocalDate(input.asOf, scope.timezone);
  const bins: FinanceSpendingSnapshot["bins"] = [];
  for (let date = scope.from; date <= scope.through; ) {
    const items = contributions.filter((item) => item.date === date);
    const netCents = items.reduce((sum, item) => sum + item.netCents, 0);
    bins.push({
      date,
      netCents,
      positiveAreaCents: Math.max(0, netCents),
      negativeAdjustmentCents: Math.max(0, -netCents),
      pendingCents: items
        .filter((item) => item.pending)
        .reduce((sum, item) => sum + item.netCents, 0),
      coverage: date > today ? "unknown" : coverage,
      provisional: date === today || items.some((item) => item.pending),
      future: date > today,
      drillDown: {
        scope: { ...scope, from: date, through: date },
        contributionIds: items.map((item) => item.id),
        transactionIds: [...new Set(items.map((item) => item.transactionId))],
      },
    });
    if (date === scope.through) break;
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    date = next.toISOString().slice(0, 10);
  }
  const categoryTotals = new Map<string | null, number>();
  for (const item of contributions)
    categoryTotals.set(item.categoryId, (categoryTotals.get(item.categoryId) ?? 0) + item.netCents);
  const totals = [...categoryTotals.values()];
  return financeSpendingSnapshotSchema.parse({
    schemaVersion: 1,
    scope,
    asOf: input.asOf,
    coverage,
    contributions,
    bins,
    netCents: totals.reduce((a, b) => a + b, 0),
    positiveAreaCents: totals.reduce((sum, value) => sum + Math.max(0, value), 0),
    negativeAdjustmentCents: totals.reduce((sum, value) => sum + Math.max(0, -value), 0),
    qualifications,
    budgetComparison: { status: "unavailable", reason: "historical_budget_not_resolved" },
  });
}
