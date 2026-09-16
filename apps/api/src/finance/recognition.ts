import {
  type AllocationProjection,
  activeAllocationsByTransaction,
  excludedReimbursementCentsByAllocation,
  matchedReimbursementCentsByCredit,
  personalAllocationCents,
  type ReimbursementAllocationProjection,
} from "../finance-allocation-projections.js";

type RecognitionAccount = {
  currencyCode: string | null;
  id: string;
  includeInPlanning: boolean;
  kind: "cash" | "debt" | "investment" | "other";
  ownershipShareBps: number | null;
  ownershipType: "individual" | "joint" | "unknown";
};

type RecognitionTransaction = {
  accountId: string;
  amount: number;
  category: string | null;
  currencyCode: string | null;
  direction: "expense" | "income" | "transfer";
  id: string;
  pending: boolean;
  pendingTransactionId: string | null;
  providerDirection: "expense" | "income" | null;
  providerTransactionId: string | null;
  transactionDate: string;
};

type RecognitionRelationship = {
  eventId: string;
  relationship: "duplicate" | "refund" | "reimbursement" | "reversal" | "split" | "transfer";
  transactionIds: string[];
};

type ReimbursementProjection = ReimbursementAllocationProjection & {
  id: string;
};

type ReimbursementMatch = {
  amount: number;
  creditTransactionId: string;
  reimbursementId: string;
};

export type FinanceRecognitionQualification = {
  code:
    | "allocation_sum_mismatch"
    | "ownership_unknown"
    | "transfer_direction_unknown"
    | "unsupported_currency";
  sourceIds: string[];
};

export type FinanceActivityRecognition = {
  grossPostedExpenseCents: number;
  investmentContributionsCents: number;
  observedIncomeCents: number;
  pendingExposureCents: number;
  postedSpendCents: number;
  qualifications: FinanceRecognitionQualification[];
  refundCreditsCents: number;
  reimbursementExpectedCents: number;
  reimbursementOutstandingCents: number;
  reimbursementReceivedCents: number;
};

type RecognitionInput = {
  accounts: RecognitionAccount[];
  allocations: AllocationProjection[];
  matches: ReimbursementMatch[];
  relationships: RecognitionRelationship[];
  reimbursements: ReimbursementProjection[];
  transactions: RecognitionTransaction[];
};

function direction(transaction: RecognitionTransaction) {
  return transaction.providerDirection ?? transaction.direction;
}

function ownedCents(amount: number, account: RecognitionAccount): number {
  if (account.ownershipType === "unknown" || account.ownershipShareBps === null) return amount;
  return Math.round((amount * account.ownershipShareBps) / 10_000);
}

function recognizedCurrency(
  transaction: RecognitionTransaction,
  account: RecognitionAccount,
): boolean {
  return (transaction.currencyCode ?? account.currencyCode) === "USD";
}

function isRefundOrReversal(
  transaction: RecognitionTransaction,
  relationships: readonly RecognitionRelationship[],
): boolean {
  if (
    relationships.some(
      (relationship) =>
        (relationship.relationship === "refund" || relationship.relationship === "reversal") &&
        relationship.transactionIds.includes(transaction.id),
    )
  ) {
    return direction(transaction) === "income";
  }
  return (
    direction(transaction) === "income" &&
    transaction.category !== "INCOME" &&
    transaction.category !== "OTHER" &&
    !transaction.category?.startsWith("TRANSFER")
  );
}

function transferContribution(
  relationship: RecognitionRelationship,
  transactionById: ReadonlyMap<string, RecognitionTransaction>,
  accountById: ReadonlyMap<string, RecognitionAccount>,
): { amount: number; directionKnown: boolean } {
  let cashOut = 0;
  let investmentIn = 0;
  let directionKnown = true;
  for (const id of relationship.transactionIds) {
    const transaction = transactionById.get(id);
    const account = transaction ? accountById.get(transaction.accountId) : undefined;
    if (!transaction || !account?.includeInPlanning) continue;
    const transactionDirection = direction(transaction);
    if (transactionDirection === "transfer") {
      directionKnown = false;
      continue;
    }
    if (!recognizedCurrency(transaction, account)) continue;
    const amount = ownedCents(transaction.amount, account);
    if (account.kind === "cash" && transactionDirection === "expense") cashOut += amount;
    if (account.kind === "investment" && transactionDirection === "income") investmentIn += amount;
  }
  return { amount: Math.min(cashOut, investmentIn), directionKnown };
}

/**
 * Canonical, API-owned recognition oracle. It intentionally returns an internal
 * shape until F0b publishes the shared PositionEvidence contract.
 */
export function recognizeFinanceActivity(input: RecognitionInput): FinanceActivityRecognition {
  const accountById = new Map(input.accounts.map((account) => [account.id, account]));
  const transactionById = new Map(
    input.transactions.map((transaction) => [transaction.id, transaction]),
  );
  const activeAllocations = activeAllocationsByTransaction(input.allocations);
  const excludedReimbursements = excludedReimbursementCentsByAllocation(input.reimbursements);
  const matchedByCredit = matchedReimbursementCentsByCredit(input.matches);
  const replacedPendingIds = new Set(
    input.transactions.flatMap((transaction) =>
      !transaction.pending && transaction.pendingTransactionId
        ? [transaction.pendingTransactionId]
        : [],
    ),
  );
  const excludedTransactionIds = new Set<string>();
  const transferTransactionIds = new Set<string>();
  const transferDirectionUnknown = new Set<string>();
  let investmentContributionsCents = 0;
  for (const relationship of input.relationships) {
    if (relationship.relationship === "split") {
      const [parent] = relationship.transactionIds;
      if (parent) excludedTransactionIds.add(parent);
    }
    if (relationship.relationship === "duplicate") {
      const representative =
        relationship.transactionIds.find((id) => {
          const transaction = transactionById.get(id);
          const account = transaction ? accountById.get(transaction.accountId) : undefined;
          return Boolean(
            transaction && account?.includeInPlanning && recognizedCurrency(transaction, account),
          );
        }) ?? relationship.transactionIds[0];
      for (const duplicate of relationship.transactionIds) {
        if (duplicate !== representative) excludedTransactionIds.add(duplicate);
      }
    }
    if (relationship.relationship === "transfer") {
      for (const id of relationship.transactionIds) transferTransactionIds.add(id);
      const contribution = transferContribution(relationship, transactionById, accountById);
      investmentContributionsCents += contribution.amount;
      if (!contribution.directionKnown) transferDirectionUnknown.add(relationship.eventId);
    }
  }

  const unknownOwnershipIds = input.accounts
    .filter((account) => account.includeInPlanning && account.ownershipType === "unknown")
    .map((account) => account.id)
    .toSorted();
  const unsupportedCurrencyIds = new Set<string>();
  const allocationMismatchIds = new Set<string>();
  let grossPostedExpenseCents = 0;
  let observedIncomeCents = 0;
  let pendingExposureCents = 0;
  let postedSpendCents = 0;
  let refundCreditsCents = 0;

  for (const transaction of input.transactions) {
    const account = accountById.get(transaction.accountId);
    if (!account?.includeInPlanning || excludedTransactionIds.has(transaction.id)) continue;
    if (
      transaction.pending &&
      transaction.providerTransactionId &&
      replacedPendingIds.has(transaction.providerTransactionId)
    ) {
      continue;
    }
    if (!recognizedCurrency(transaction, account)) {
      unsupportedCurrencyIds.add(transaction.id);
      continue;
    }
    if (transferTransactionIds.has(transaction.id)) continue;

    const transactionDirection = direction(transaction);
    const ownedAmount = ownedCents(transaction.amount, account);
    const allocations = activeAllocations.get(transaction.id);
    const allocatedAmount = allocations?.reduce(
      (total, allocation) => total + allocation.amount,
      0,
    );
    if (allocations && allocatedAmount !== transaction.amount) {
      allocationMismatchIds.add(transaction.id);
    }
    const allocatedPersonalAmount = personalAllocationCents(
      transaction.id,
      Math.max(0, transaction.amount - (matchedByCredit.get(transaction.id) ?? 0)),
      activeAllocations,
      excludedReimbursements,
    );
    const unallocatedAmount =
      allocations && allocatedAmount !== undefined
        ? Math.max(0, transaction.amount - allocatedAmount)
        : 0;
    const personalAmount = ownedCents(allocatedPersonalAmount + unallocatedAmount, account);
    if (transaction.pending) {
      if (transactionDirection === "expense") pendingExposureCents += ownedAmount;
      continue;
    }
    if (transactionDirection === "expense") {
      grossPostedExpenseCents += ownedAmount;
      postedSpendCents += personalAmount;
      continue;
    }
    if (transactionDirection !== "income") continue;
    const matched = ownedCents(matchedByCredit.get(transaction.id) ?? 0, account);
    if (isRefundOrReversal(transaction, input.relationships)) {
      refundCreditsCents += Math.max(0, ownedAmount - matched);
    } else {
      observedIncomeCents += Math.max(0, ownedAmount - matched);
    }
  }

  const allocationAccount = new Map(
    input.allocations.flatMap((allocation) => {
      const transaction = transactionById.get(allocation.transactionId);
      const account = transaction ? accountById.get(transaction.accountId) : undefined;
      return transaction && account?.includeInPlanning && recognizedCurrency(transaction, account)
        ? [[allocation.id, account] as const]
        : [];
    }),
  );
  const reimbursementExpectedCents = input.reimbursements.reduce((total, reimbursement) => {
    const account = allocationAccount.get(reimbursement.allocationId);
    const recognizedExpected =
      reimbursement.status === "cancelled"
        ? reimbursement.receivedAmount
        : reimbursement.expectedAmount;
    return total + (account ? ownedCents(recognizedExpected, account) : 0);
  }, 0);
  const reimbursementReceivedCents = input.reimbursements.reduce((total, reimbursement) => {
    const account = allocationAccount.get(reimbursement.allocationId);
    return total + (account ? ownedCents(reimbursement.receivedAmount, account) : 0);
  }, 0);

  const qualifications: FinanceRecognitionQualification[] = [];
  if (unknownOwnershipIds.length > 0) {
    qualifications.push({ code: "ownership_unknown", sourceIds: unknownOwnershipIds });
  }
  if (unsupportedCurrencyIds.size > 0) {
    qualifications.push({
      code: "unsupported_currency",
      sourceIds: [...unsupportedCurrencyIds].toSorted(),
    });
  }
  if (allocationMismatchIds.size > 0) {
    qualifications.push({
      code: "allocation_sum_mismatch",
      sourceIds: [...allocationMismatchIds].toSorted(),
    });
  }
  if (transferDirectionUnknown.size > 0) {
    qualifications.push({
      code: "transfer_direction_unknown",
      sourceIds: [...transferDirectionUnknown].toSorted(),
    });
  }

  return {
    grossPostedExpenseCents,
    investmentContributionsCents,
    observedIncomeCents,
    pendingExposureCents,
    postedSpendCents,
    qualifications,
    refundCreditsCents,
    reimbursementExpectedCents,
    reimbursementOutstandingCents: Math.max(
      0,
      reimbursementExpectedCents - reimbursementReceivedCents,
    ),
    reimbursementReceivedCents,
  };
}
