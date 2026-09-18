import { createHash } from "node:crypto";
import {
  type FinanceMoneyFact,
  type FinanceMoneyFactReasonCode,
  type FinancePositionEvidence,
  type FinanceRevisionRef,
  financeMoneyFactSchema,
  financePositionEvidenceSchema,
  financeRevisionRefSchema,
} from "@personal-os/domain";
import { type RecognitionInput, recognizeFinanceActivity } from "./recognition.js";

export type PositionAccount = RecognitionInput["accounts"][number] & {
  balance: number | null;
  reasons: FinanceMoneyFactReasonCode[];
  source: FinanceRevisionRef;
};

export type PositionInput = Omit<RecognitionInput, "accounts"> & {
  accounts: PositionAccount[];
  asOf: string;
  scope: FinancePositionEvidence["scope"];
  activitySource: FinanceRevisionRef;
  committed?: FinanceMoneyFact;
  protected?: FinanceMoneyFact;
};

export function positionRevision(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fact(
  cents: number | null,
  reasons: FinanceMoneyFactReasonCode[],
  sources: FinanceRevisionRef[],
): FinanceMoneyFact {
  return financeMoneyFactSchema.parse({
    cents,
    currency: "USD",
    quality: cents === null ? "unavailable" : reasons.length ? "qualified" : "verified",
    reasons: [...new Set(reasons)].toSorted(),
    sources,
  });
}

const qualificationReasons = {
  allocation_evidence_unresolved: "unresolved_allocation",
  allocation_sum_mismatch: "unresolved_allocation",
  ownership_unknown: "incomplete_evidence",
  reimbursement_allocation_unresolved: "unresolved_reimbursement",
  transfer_evidence_incomplete: "incomplete_evidence",
  transfer_direction_unknown: "incomplete_evidence",
  unsupported_currency: "unsupported_account_type",
} as const;

/** One immutable snapshot feeds every fact; callers cannot drop qualification at the seam. */
export function buildFinancePosition(input: PositionInput) {
  const scope = financePositionEvidenceSchema.shape.scope.parse({
    ...input.scope,
    accountIds: [...new Set(input.scope.accountIds)].toSorted(),
  });
  if (scope.from > scope.through) throw new Error("Position scope dates are reversed.");
  const accountIds = new Set(scope.accountIds);
  const accounts = input.accounts
    .filter((account) => accountIds.has(account.id) && account.includeInPlanning)
    .toSorted((a, b) => a.id.localeCompare(b.id));
  const includedIds = new Set(accounts.map((account) => account.id));
  const transactions = input.transactions.filter((transaction) =>
    includedIds.has(transaction.accountId),
  );
  const transactionIds = new Set(transactions.map((transaction) => transaction.id));
  const allocationById = new Map(
    input.allocations.map((allocation) => [allocation.id, allocation]),
  );
  const allocations = input.allocations.filter((allocation) =>
    transactionIds.has(allocation.transactionId),
  );
  const reimbursements = input.reimbursements.filter((reimbursement) => {
    const allocation = allocationById.get(reimbursement.allocationId);
    return !allocation || transactionIds.has(allocation.transactionId);
  });
  const activity = recognizeFinanceActivity({
    ...input,
    accounts,
    transactions,
    allocations,
    reimbursements,
    period: scope,
  });
  const activitySources = [
    {
      id: input.userId,
      revision: positionRevision({
        activity: financeRevisionRefSchema.parse(input.activitySource),
        accounts: accounts.map((account) => account.source),
        scope,
      }),
    },
  ];
  const activityReasons = activity.qualifications.map((q) => qualificationReasons[q.code]);
  const sourceReasons = accounts.flatMap((account) => account.reasons);
  if (accounts.length === 0) sourceReasons.push("source_unavailable");
  const balanceFact = (kinds: PositionAccount["kind"][]) => {
    const selected = accounts.filter((account) => kinds.includes(account.kind));
    const reasons = selected.flatMap((account) => account.reasons);
    let cents = 0;
    let supported = true;
    for (const account of selected) {
      if (account.balance === null || account.currencyCode !== "USD") {
        supported = false;
        reasons.push(account.balance === null ? "source_unavailable" : "unsupported_account_type");
        continue;
      }
      if (account.ownershipType === "unknown" || account.ownershipShareBps === null) {
        reasons.push("incomplete_evidence");
      }
      const share = account.ownershipShareBps ?? 10_000;
      cents += Math.round(
        ((account.kind === "debt" ? Math.abs(account.balance) : account.balance) * share) / 10_000,
      );
    }
    if (accounts.length === 0) reasons.push("source_unavailable");
    return fact(
      supported && accounts.length ? cents : null,
      reasons,
      selected.map((a) => a.source),
    );
  };
  const cash = balanceFact(["cash"]);
  const debt = balanceFact(["debt"]);
  const investments = balanceFact(["investment"]);
  const other = balanceFact(["other"]);
  const postedSpend = fact(
    accounts.length ? activity.postedSpendCents : null,
    [...sourceReasons, ...activityReasons],
    activitySources,
  );
  const pendingExposure = fact(
    accounts.length ? activity.pendingExposureCents : null,
    [
      ...sourceReasons,
      ...activityReasons,
      ...(activity.pendingExposureCents ? ["pending_transactions" as const] : []),
    ],
    activitySources,
  );
  const committed = input.committed
    ? financeMoneyFactSchema.parse(input.committed)
    : fact(null, ["missing_commitments"], []);
  const protectedFact = input.protected
    ? financeMoneyFactSchema.parse(input.protected)
    : fact(null, ["missing_protection_policy"], []);
  const spendableDependencies = [cash, pendingExposure, committed, protectedFact];
  const commitmentSourceIds = new Set(committed.sources.map((source) => source.id));
  const reservationOverlap = protectedFact.sources.some((source) =>
    commitmentSourceIds.has(source.id),
  );
  const reservationEvidenceMissing = [committed, protectedFact].some(
    (item) => item.cents !== null && item.sources.length === 0,
  );
  // Unknown or stale funding cannot authorize an optimistic spending recommendation.
  const spendable = fact(
    !reservationOverlap &&
      !reservationEvidenceMissing &&
      spendableDependencies.every((item) => item.cents !== null && item.quality === "verified")
      ? (cash.cents as number) -
          (pendingExposure.cents as number) -
          (committed.cents as number) -
          (protectedFact.cents as number)
      : null,
    [
      ...spendableDependencies.flatMap((item) => item.reasons),
      ...(reservationOverlap || reservationEvidenceMissing ? ["incomplete_evidence" as const] : []),
    ],
    [{ id: input.userId, revision: positionRevision(spendableDependencies) }],
  );
  const wealthDependencies = [cash, debt, investments, other];
  const netWorth = fact(
    wealthDependencies.every((item) => item.cents !== null)
      ? (cash.cents as number) +
          (investments.cents as number) +
          (other.cents as number) -
          (debt.cents as number)
      : null,
    wealthDependencies.flatMap((item) => item.reasons),
    accounts.map((account) => account.source),
  );
  const values = {
    cash,
    postedSpend,
    pendingExposure,
    committed,
    protected: protectedFact,
    spendable,
    debt,
    investments,
    netWorth,
  };
  const position = financePositionEvidenceSchema.parse({
    ...values,
    asOf: input.asOf,
    revision: positionRevision({ scope, ...values }),
    scope: { ...scope, accountIds: [...accountIds].toSorted() },
  });
  return { activity, position };
}
