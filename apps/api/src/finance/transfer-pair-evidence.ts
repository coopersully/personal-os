import { createHash } from "node:crypto";
import {
  financeAccounts,
  financeProviderItems,
  financeReviewCases,
  financeTransactions,
} from "@personal-os/database";
import type { FinanceTransferPairDecision } from "@personal-os/domain";
import { and, eq, inArray } from "drizzle-orm";
import { AppError } from "../errors.js";
import { lockReimbursementTopology } from "../finance-reimbursement-locks.js";
import { isFinanceAccountSourceCurrent } from "./account-source-current.js";
import type { FinanceTransaction } from "./context.js";

/** Exact candidate evidence; owner confirmation is required before treating a candidate as a transfer. */
export async function readTransferPairEvidence(
  tx: Pick<FinanceTransaction, "select" | "execute">,
  userId: string,
  decision: FinanceTransferPairDecision,
  at: Date,
  lock: boolean,
) {
  const accountsQuery = tx
    .select()
    .from(financeAccounts)
    .where(eq(financeAccounts.userId, userId))
    .orderBy(financeAccounts.id);
  const accounts = await (lock ? accountsQuery.for("update") : accountsQuery);
  if (lock) await lockReimbursementTopology(tx, userId);
  const pairQuery = tx
    .select()
    .from(financeTransactions)
    .where(
      and(
        eq(financeTransactions.userId, userId),
        inArray(financeTransactions.id, [
          decision.transactionId,
          decision.counterpartTransactionId,
        ]),
      ),
    )
    .orderBy(financeTransactions.id);
  const pair = await (lock ? pairQuery.for("update") : pairQuery);
  const left = pair.find((row) => row.id === decision.transactionId);
  const right = pair.find((row) => row.id === decision.counterpartTransactionId);
  if (!left || !right) throw new AppError("not_found", "A transfer transaction was not found.");
  if (
    left.contextualRevision.toString() !== decision.expectedTransactionRevision ||
    left.updatedAt.toISOString() !== decision.expectedTransactionUpdatedAt ||
    right.contextualRevision.toString() !== decision.expectedCounterpartRevision ||
    right.updatedAt.toISOString() !== decision.expectedCounterpartUpdatedAt
  )
    throw new AppError("conflict", "The transfer pair changed; prepare a new preview.");
  const candidatesQuery = tx
    .select()
    .from(financeTransactions)
    .where(and(eq(financeTransactions.userId, userId), eq(financeTransactions.amount, left.amount)))
    .orderBy(financeTransactions.id)
    .limit(1001);
  const candidates = await (lock ? candidatesQuery.for("share") : candidatesQuery);
  if (candidates.length > 1000)
    throw new AppError("conflict", "Counterpart evidence exceeds the qualification bound.", {
      qualificationReason: "counterpart_evidence_limit",
    });
  const items = await tx
    .select()
    .from(financeProviderItems)
    .where(eq(financeProviderItems.userId, userId));
  const providerTransfer = (row: typeof left) => {
    const expected = row.providerDirection === "income" ? "TRANSFER_IN" : "TRANSFER_OUT";
    return (
      row.providerCategory === expected &&
      (row.providerCategoryDetailed === null ||
        row.providerCategoryDetailed === expected ||
        row.providerCategoryDetailed === `${expected}_ACCOUNT_TRANSFER`)
    );
  };
  const eligible = (row: typeof left) =>
    !row.pending &&
    row.amount > 0 &&
    row.currencyCode === "USD" &&
    !!row.providerDirection &&
    !row.transferGroupId &&
    row.reconciliationStatus !== "matched" &&
    row.reconciliationStatus !== "confirmed" &&
    providerTransfer(row);
  const counterparts = (row: typeof left) =>
    candidates.filter(
      (other) =>
        eligible(other) &&
        other.id !== row.id &&
        other.accountId !== row.accountId &&
        other.providerDirection !== row.providerDirection &&
        Math.abs(Date.parse(other.transactionDate) - Date.parse(row.transactionDate)) <=
          3 * 86400000,
    );
  if (
    !eligible(left) ||
    !eligible(right) ||
    left.amount !== right.amount ||
    counterparts(left).length !== 1 ||
    counterparts(left)[0]?.id !== right.id ||
    counterparts(right).length !== 1 ||
    counterparts(right)[0]?.id !== left.id
  )
    throw new AppError(
      "invalid_request",
      "This transfer needs a unique, posted, equal-amount USD counterpart with signed provider evidence.",
    );
  const selectedAccounts = pair.map((row) =>
    accounts.find((account) => account.id === row.accountId),
  );
  for (const account of selectedAccounts) {
    if (account?.ownershipType !== "individual" || account.ownershipShareBps !== 10000)
      throw new AppError(
        "invalid_request",
        "Confirm account ownership before resolving this transfer.",
      );
    const item = items.find((item) => item.id === account.providerItemRecordId);
    const fresh = isFinanceAccountSourceCurrent(account, item, at);
    if (!fresh)
      throw new AppError("conflict", "Refresh the transfer's account sources before resolving it.");
  }
  const [first, second] = selectedAccounts;
  if (
    first?.providerPersistentAccountId &&
    first.providerPersistentAccountId === second?.providerPersistentAccountId
  )
    throw new AppError(
      "invalid_request",
      "Duplicate account representations do not prove a transfer.",
    );
  const casesQuery = tx
    .select()
    .from(financeReviewCases)
    .where(
      and(
        eq(financeReviewCases.userId, userId),
        inArray(
          financeReviewCases.transactionId,
          pair.map((row) => row.id),
        ),
        inArray(financeReviewCases.status, ["open", "deferred"]),
      ),
    )
    .orderBy(financeReviewCases.id);
  const cases = await (lock ? casesQuery.for("update") : casesQuery);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify(
        {
          pair,
          accounts: selectedAccounts,
          items: items
            .filter((item) =>
              selectedAccounts.some((account) => account?.providerItemRecordId === item.id),
            )
            .map(({ encryptedCredentials: _credentials, ...item }) => item),
          cases,
        },
        (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      ),
    )
    .digest("hex");
  return {
    pair,
    cases,
    fingerprint,
    transferCounterpart: {
      transactionId: right.id,
      revision: right.contextualRevision.toString(),
      summary: {
        merchant: right.merchant,
        amountCents: right.amount,
        currencyCode: right.currencyCode,
        date: right.transactionDate,
      },
    },
  };
}
