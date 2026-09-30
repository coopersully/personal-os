import {
  type AllocationProjection,
  activeAllocationsByTransaction,
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
  reconciliationStatus: "candidate" | "confirmed" | "matched" | "not_applicable";
  transactionDate: string;
  transferGroupId: string | null;
  userId: string;
};

type RecognitionRelationship = {
  createdAt: string;
  eventId: string;
  eventUserId: string;
  id: string;
  provenance: {
    actorType: "agent" | "system" | "user";
    maintenanceRunId?: string;
  };
  provenanceValidated: boolean;
  relationship: "duplicate" | "refund" | "reimbursement" | "reversal" | "split" | "transfer";
  transactionIds: string[];
  userId: string;
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
    | "allocation_evidence_unresolved"
    | "allocation_sum_mismatch"
    | "ownership_unknown"
    | "reimbursement_allocation_unresolved"
    | "transfer_evidence_incomplete"
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

export type RecognitionInput = {
  accounts: RecognitionAccount[];
  allocations: AllocationProjection[];
  matches: ReimbursementMatch[];
  relationships: RecognitionRelationship[];
  reimbursements: ReimbursementProjection[];
  transactions: RecognitionTransaction[];
  userId: string;
  period?: { from: string; through: string };
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

function movementDirection(transaction: RecognitionTransaction): "expense" | "income" | null {
  return (
    transaction.providerDirection ??
    (transaction.direction === "transfer" ? null : transaction.direction)
  );
}

function transferContribution(
  transactionIds: readonly string[],
  transactionById: ReadonlyMap<string, RecognitionTransaction>,
  accountById: ReadonlyMap<string, RecognitionAccount>,
  period?: RecognitionInput["period"],
): { amount: number; complete: boolean; directionKnown: boolean } {
  let cashOut = 0;
  let investmentIn = 0;
  let directionKnown = true;
  let incoming = 0;
  let outgoing = 0;
  let supported = transactionIds.length >= 2;
  for (const id of transactionIds) {
    const transaction = transactionById.get(id);
    const account = transaction ? accountById.get(transaction.accountId) : undefined;
    if (!transaction || !account?.includeInPlanning || !recognizedCurrency(transaction, account)) {
      supported = false;
      continue;
    }
    const transactionDirection = movementDirection(transaction);
    if (transactionDirection === null) {
      directionKnown = false;
      continue;
    }
    const amount = ownedCents(transaction.amount, account);
    if (transactionDirection === "expense") {
      outgoing += amount;
      if (account.kind === "cash") cashOut += amount;
    } else {
      incoming += amount;
      if (
        account.kind === "investment" &&
        (!period ||
          (transaction.transactionDate >= period.from &&
            transaction.transactionDate <= period.through))
      )
        investmentIn += amount;
    }
  }
  return {
    amount: Math.min(cashOut, investmentIn),
    complete: supported && directionKnown && incoming > 0 && outgoing > 0,
    directionKnown,
  };
}

function relationshipSetKey(transactionIds: readonly string[]): string {
  return [...new Set(transactionIds)].toSorted().join(":");
}

function isLaterRelationship(
  candidate: RecognitionRelationship,
  current: RecognitionRelationship,
): boolean {
  return (
    candidate.createdAt > current.createdAt ||
    (candidate.createdAt === current.createdAt && candidate.id > current.id)
  );
}

function currentRelationships(
  input: RecognitionInput,
  transactionById: ReadonlyMap<string, RecognitionTransaction>,
): RecognitionRelationship[] {
  const trusted = input.relationships.filter(
    (relationship) =>
      relationship.userId === input.userId &&
      relationship.eventUserId === input.userId &&
      relationship.provenanceValidated &&
      relationship.transactionIds.every((id) => {
        const transaction = transactionById.get(id);
        return !transaction || transaction.userId === input.userId;
      }),
  );
  const byEvent = new Map<string, RecognitionRelationship>();
  for (const relationship of trusted) {
    const current = byEvent.get(relationship.eventId);
    if (!current || isLaterRelationship(relationship, current)) {
      byEvent.set(relationship.eventId, relationship);
    }
  }
  const byTransactions = new Map<string, RecognitionRelationship>();
  for (const relationship of byEvent.values()) {
    const key = relationshipSetKey(relationship.transactionIds);
    const current = byTransactions.get(key);
    if (!current || isLaterRelationship(relationship, current)) {
      byTransactions.set(key, relationship);
    }
  }
  return [...byTransactions.values()].toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

function addCents(map: Map<string, number>, id: string, amount: number): void {
  map.set(id, (map.get(id) ?? 0) + amount);
}

/**
 * Canonical, API-owned recognition oracle. Position producers map its detailed
 * qualifications to the shared validating MoneyFact reason codes.
 */
export function recognizeFinanceActivity(input: RecognitionInput): FinanceActivityRecognition {
  const accountById = new Map(input.accounts.map((account) => [account.id, account]));
  const transactions = input.transactions.filter(
    (transaction) => transaction.userId === input.userId,
  );
  const inPeriod = (transaction: RecognitionTransaction) =>
    !input.period ||
    (transaction.transactionDate >= input.period.from &&
      transaction.transactionDate <= input.period.through);
  const transactionById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  const activeAllocations = activeAllocationsByTransaction(input.allocations);
  const activeAllocationAccount = new Map(
    input.allocations.flatMap((allocation) => {
      if (allocation.state !== "active") return [];
      const transaction = transactionById.get(allocation.transactionId);
      const account = transaction ? accountById.get(transaction.accountId) : undefined;
      return transaction && account?.includeInPlanning && recognizedCurrency(transaction, account)
        ? [[allocation.id, account] as const]
        : [];
    }),
  );
  const validReimbursementIds = new Set(
    input.reimbursements
      .filter((reimbursement) => activeAllocationAccount.has(reimbursement.allocationId))
      .map((reimbursement) => reimbursement.id),
  );
  const receivedByAllocation = new Map<string, number>();
  for (const reimbursement of input.reimbursements) {
    if (validReimbursementIds.has(reimbursement.id))
      addCents(receivedByAllocation, reimbursement.allocationId, reimbursement.receivedAmount);
  }
  const matchedByCredit = matchedReimbursementCentsByCredit(
    input.matches.filter((match) => validReimbursementIds.has(match.reimbursementId)),
  );
  const replacedPendingIds = new Set(
    transactions.flatMap((transaction) =>
      !transaction.pending &&
      transaction.pendingTransactionId &&
      (!input.period || transaction.transactionDate <= input.period.through)
        ? [transaction.pendingTransactionId]
        : [],
    ),
  );
  const excludedTransactionIds = new Set<string>();
  const transferTransactionIds = new Set<string>();
  const transferDirectionUnknown = new Set<string>();
  const transferEvidenceIncomplete = new Set<string>();
  const refundTransactionIds = new Set<string>();
  const reimbursementRelationships: RecognitionRelationship[] = [];
  const recognizedTransferSets = new Set<string>();
  let investmentContributionsCents = 0;
  const relationships = currentRelationships(input, transactionById);
  const recognizeTransfer = (sourceId: string, transactionIds: readonly string[]) => {
    if (
      input.period &&
      !transactionIds.some((id) => {
        const transaction = transactionById.get(id);
        return transaction !== undefined && inPeriod(transaction);
      })
    )
      return;
    const key = relationshipSetKey(transactionIds);
    if (recognizedTransferSets.has(key)) return;
    recognizedTransferSets.add(key);
    const contribution = transferContribution(
      transactionIds,
      transactionById,
      accountById,
      input.period,
    );
    if (!contribution.directionKnown) transferDirectionUnknown.add(sourceId);
    if (!contribution.complete) {
      transferEvidenceIncomplete.add(sourceId);
      return;
    }
    for (const id of transactionIds) transferTransactionIds.add(id);
    investmentContributionsCents += contribution.amount;
  };
  for (const relationship of relationships) {
    if (relationship.relationship === "split") {
      const [parent] = relationship.transactionIds;
      if (parent && relationship.transactionIds.every((id) => transactionById.has(id))) {
        excludedTransactionIds.add(parent);
      }
    }
    if (relationship.relationship === "duplicate") {
      const representative = relationship.transactionIds
        .flatMap((id) => {
          const transaction = transactionById.get(id);
          const account = transaction ? accountById.get(transaction.accountId) : undefined;
          return transaction &&
            account?.includeInPlanning &&
            recognizedCurrency(transaction, account)
            ? [transaction]
            : [];
        })
        .toSorted(
          (left, right) =>
            Number(left.pending) - Number(right.pending) || left.id.localeCompare(right.id),
        )[0]?.id;
      for (const duplicate of relationship.transactionIds) {
        if (representative && duplicate !== representative) excludedTransactionIds.add(duplicate);
      }
    }
    if (relationship.relationship === "transfer") {
      recognizeTransfer(relationship.eventId, relationship.transactionIds);
    }
    if (relationship.relationship === "refund" || relationship.relationship === "reversal") {
      for (const id of relationship.transactionIds) refundTransactionIds.add(id);
    }
    if (relationship.relationship === "reimbursement") {
      reimbursementRelationships.push(relationship);
    }
  }
  const reconciledTransferGroups = new Map<string, string[]>();
  for (const transaction of transactions) {
    if (
      transaction.direction !== "transfer" ||
      !transaction.transferGroupId ||
      (transaction.reconciliationStatus !== "matched" &&
        transaction.reconciliationStatus !== "confirmed")
    ) {
      continue;
    }
    const ids = reconciledTransferGroups.get(transaction.transferGroupId) ?? [];
    ids.push(transaction.id);
    reconciledTransferGroups.set(transaction.transferGroupId, ids);
  }
  for (const [groupId, ids] of reconciledTransferGroups) recognizeTransfer(groupId, ids);

  const relationshipReimbursementByCredit = new Map<string, number>();
  const relationshipReimbursementByExpense = new Map<string, number>();
  let relationshipReimbursementReceivedCents = 0;
  for (const relationship of reimbursementRelationships) {
    const related = relationship.transactionIds
      .map((id) => transactionById.get(id))
      .filter((transaction): transaction is RecognitionTransaction => transaction !== undefined);
    if (related.length !== relationship.transactionIds.length) continue;
    const expenses = related
      .filter(
        (transaction) =>
          movementDirection(transaction) === "expense" &&
          !transaction.pending &&
          !excludedTransactionIds.has(transaction.id) &&
          !transferTransactionIds.has(transaction.id) &&
          activeAllocations.get(transaction.id)?.length !== 0,
      )
      .toSorted((left, right) => left.id.localeCompare(right.id));
    const credits = related
      .filter(
        (transaction) =>
          movementDirection(transaction) === "income" &&
          !transaction.pending &&
          !excludedTransactionIds.has(transaction.id) &&
          !transferTransactionIds.has(transaction.id),
      )
      .toSorted((left, right) => left.id.localeCompare(right.id));
    if (expenses.length === 0 || credits.length === 0) continue;
    const expenseCapacity = expenses.map((transaction) => {
      const account = accountById.get(transaction.accountId);
      return {
        id: transaction.id,
        value:
          account?.includeInPlanning && recognizedCurrency(transaction, account)
            ? Math.max(
                0,
                ownedCents(transaction.amount, account) -
                  ownedCents(
                    (activeAllocations.get(transaction.id) ?? []).reduce(
                      (total, allocation) => total + (receivedByAllocation.get(allocation.id) ?? 0),
                      0,
                    ),
                    account,
                  ) -
                  (relationshipReimbursementByExpense.get(transaction.id) ?? 0),
              )
            : 0,
      };
    });
    const creditCapacity = credits.map((transaction) => {
      const account = accountById.get(transaction.accountId);
      const unmatched = Math.max(
        0,
        transaction.amount - (matchedByCredit.get(transaction.id) ?? 0),
      );
      return {
        id: transaction.id,
        value:
          account?.includeInPlanning && recognizedCurrency(transaction, account)
            ? Math.max(
                0,
                ownedCents(unmatched, account) -
                  (relationshipReimbursementByCredit.get(transaction.id) ?? 0),
              )
            : 0,
      };
    });
    let remaining = Math.min(
      expenseCapacity.reduce((total, item) => total + item.value, 0),
      creditCapacity.reduce((total, item) => total + item.value, 0),
    );
    const recognized = remaining;
    for (const item of expenseCapacity) {
      const amount = Math.min(item.value, remaining);
      addCents(relationshipReimbursementByExpense, item.id, amount);
      remaining -= amount;
    }
    remaining = recognized;
    for (const item of creditCapacity) {
      const amount = Math.min(item.value, remaining);
      addCents(relationshipReimbursementByCredit, item.id, amount);
      remaining -= amount;
    }
    relationshipReimbursementReceivedCents += recognized;
  }

  const unknownOwnershipIds = input.accounts
    .filter((account) => account.includeInPlanning && account.ownershipType === "unknown")
    .map((account) => account.id)
    .toSorted();
  const unsupportedCurrencyIds = new Set<string>();
  const allocationMismatchIds = new Set<string>();
  const unresolvedAllocationTransactionIds = new Set(
    [...activeAllocations.entries()]
      .filter(([transactionId, allocations]) => {
        const transaction = transactionById.get(transactionId);
        return allocations.length === 0 && transaction !== undefined && inPeriod(transaction);
      })
      .map(([transactionId]) => transactionId),
  );
  const unresolvedReimbursementIds = new Set<string>();
  const reimbursementByAccount = new Map<
    string,
    { account: RecognitionAccount; expected: number; received: number }
  >();
  for (const reimbursement of input.reimbursements) {
    const account = activeAllocationAccount.get(reimbursement.allocationId);
    if (!account) {
      const allocation = input.allocations.find((item) => item.id === reimbursement.allocationId);
      const transaction = allocation ? transactionById.get(allocation.transactionId) : undefined;
      if (!transaction || inPeriod(transaction)) unresolvedReimbursementIds.add(reimbursement.id);
      continue;
    }
    const totals = reimbursementByAccount.get(account.id) ?? {
      account,
      expected: 0,
      received: 0,
    };
    totals.expected +=
      reimbursement.status === "cancelled"
        ? reimbursement.receivedAmount
        : reimbursement.expectedAmount;
    totals.received += reimbursement.receivedAmount;
    reimbursementByAccount.set(account.id, totals);
  }
  const reimbursementExpectedCents =
    [...reimbursementByAccount.values()].reduce(
      (total, item) => total + ownedCents(item.expected, item.account),
      0,
    ) + relationshipReimbursementReceivedCents;
  const reimbursementReceivedCents =
    [...reimbursementByAccount.values()].reduce(
      (total, item) => total + ownedCents(item.received, item.account),
      0,
    ) + relationshipReimbursementReceivedCents;
  let grossPostedExpenseCents = 0;
  let observedIncomeCents = 0;
  let pendingExposureCents = 0;
  let postedSpendCents = 0;
  let refundCreditsCents = 0;

  for (const transaction of transactions) {
    if (!inPeriod(transaction)) continue;
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
    if (allocations && allocations.length > 0 && allocatedAmount !== transaction.amount) {
      allocationMismatchIds.add(transaction.id);
    }
    const allocatedPersonalAmount = personalAllocationCents(
      transaction.id,
      transaction.amount,
      activeAllocations,
      receivedByAllocation,
    );
    const unallocatedAmount =
      allocations && allocations.length > 0 && allocatedAmount !== undefined
        ? Math.max(0, transaction.amount - allocatedAmount)
        : 0;
    const personalAmount = ownedCents(allocatedPersonalAmount + unallocatedAmount, account);
    if (transaction.pending) {
      if (transactionDirection === "expense") pendingExposureCents += ownedAmount;
      continue;
    }
    if (transactionDirection === "expense") {
      grossPostedExpenseCents += ownedAmount;
      postedSpendCents += Math.max(
        0,
        personalAmount - (relationshipReimbursementByExpense.get(transaction.id) ?? 0),
      );
      continue;
    }
    if (transactionDirection !== "income") continue;
    const matched =
      ownedCents(matchedByCredit.get(transaction.id) ?? 0, account) +
      (relationshipReimbursementByCredit.get(transaction.id) ?? 0);
    if (refundTransactionIds.has(transaction.id)) {
      refundCreditsCents += Math.max(0, ownedAmount - matched);
    } else {
      observedIncomeCents += Math.max(0, ownedAmount - matched);
    }
  }

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
  if (unresolvedAllocationTransactionIds.size > 0) {
    qualifications.push({
      code: "allocation_evidence_unresolved",
      sourceIds: [...unresolvedAllocationTransactionIds].toSorted(),
    });
  }
  if (unresolvedReimbursementIds.size > 0) {
    qualifications.push({
      code: "reimbursement_allocation_unresolved",
      sourceIds: [...unresolvedReimbursementIds].toSorted(),
    });
  }
  if (transferEvidenceIncomplete.size > 0) {
    qualifications.push({
      code: "transfer_evidence_incomplete",
      sourceIds: [...transferEvidenceIncomplete].toSorted(),
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
