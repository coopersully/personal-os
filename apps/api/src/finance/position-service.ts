import {
  type Database,
  financeAccounts,
  financeEconomicEvents,
  financeProviderItems,
  financeReimbursementMatches,
  financeReimbursements,
  financeTransactionAllocations,
  financeTransactionRelationships,
  financeTransactions,
} from "@personal-os/database";
import {
  type FinancePositionEvidence,
  type FinancePositionReadScope,
  financePositionEvidenceSchema,
  financeProvenanceSchema,
} from "@personal-os/domain";
import { eq } from "drizzle-orm";
import { AppError } from "../errors.js";
import { buildFinancePosition, type PositionAccount, positionRevision } from "./position.js";
import type { RecognitionInput } from "./recognition.js";

/** Read-only producer. Authenticated composition supplies userId, never a request payload. */
export function createFinancePositionService(input: { db: Database; now: () => Date }) {
  async function readSnapshot(userId: string, requestedScope: FinancePositionReadScope) {
    const asOf = input.now().toISOString();
    const scopeResult = financePositionEvidenceSchema.shape.scope.safeParse({
      ...requestedScope,
      accountIds: requestedScope.accountIds ?? [],
    });
    if (!scopeResult.success)
      throw new AppError(
        "invalid_request",
        "Position scope requires ordered ISO dates and at most 100 account IDs.",
      );
    const validatedScope = scopeResult.data;
    if (validatedScope.from > validatedScope.through) {
      throw new AppError("invalid_request", "Position scope dates are reversed.");
    }
    return input.db.transaction(
      async (tx) => {
        const accountRows = await tx
          .select()
          .from(financeAccounts)
          .where(eq(financeAccounts.userId, userId));
        const items = await tx
          .select()
          .from(financeProviderItems)
          .where(eq(financeProviderItems.userId, userId));
        const transactions = await tx
          .select()
          .from(financeTransactions)
          .where(eq(financeTransactions.userId, userId));
        const allocations = await tx
          .select()
          .from(financeTransactionAllocations)
          .where(eq(financeTransactionAllocations.userId, userId));
        const reimbursements = await tx
          .select()
          .from(financeReimbursements)
          .where(eq(financeReimbursements.userId, userId));
        const matches = await tx
          .select()
          .from(financeReimbursementMatches)
          .where(eq(financeReimbursementMatches.userId, userId));
        const rows = await tx
          .select()
          .from(financeTransactionRelationships)
          .where(eq(financeTransactionRelationships.userId, userId));
        const events = await tx
          .select()
          .from(financeEconomicEvents)
          .where(eq(financeEconomicEvents.userId, userId));
        const ownedIds = new Set(accountRows.map((account) => account.id));
        if (validatedScope.accountIds.some((id) => !ownedIds.has(id))) {
          throw new AppError("not_found", "The position account was not found.");
        }
        if (requestedScope.accountIds === undefined && ownedIds.size > 100) {
          throw new AppError(
            "invalid_request",
            "Select at most 100 accounts for position evidence.",
          );
        }
        const scope = {
          ...validatedScope,
          accountIds:
            requestedScope.accountIds === undefined
              ? [...ownedIds].toSorted()
              : [...new Set(validatedScope.accountIds)].toSorted(),
        };
        const itemById = new Map(items.map((item) => [item.id, item]));
        const accounts: PositionAccount[] = accountRows.map((row) => {
          const item = row.providerItemRecordId
            ? itemById.get(row.providerItemRecordId)
            : undefined;
          const sync =
            item?.syncState === "current" &&
            (row.syncState === "blocked" || row.syncState === "retrying")
              ? row
              : (item ?? row);
          const reasons: PositionAccount["reasons"] = [];
          if (
            row.status === "needs_reauth" ||
            sync.syncState === "blocked" ||
            sync.syncState === "retrying"
          )
            reasons.push("source_unavailable");
          if (
            row.provider === "plaid" &&
            (!sync.lastSyncedAt ||
              sync.lastSyncedAt.getTime() < new Date(asOf).getTime() - 86_400_000 ||
              sync.syncState !== "current")
          )
            reasons.push("stale_evidence");
          const projection = {
            balance: row.balance,
            currencyCode: row.currencyCode,
            id: row.id,
            includeInPlanning: row.includeInPlanning,
            kind: row.kind,
            ownershipShareBps: row.ownershipShareBps,
            ownershipType: row.ownershipType,
            reasons,
          };
          return {
            ...projection,
            source: {
              id: row.id,
              revision: positionRevision({
                ...projection,
                updatedAt: row.updatedAt,
                itemUpdatedAt: item?.updatedAt,
                lastSyncedAt: sync.lastSyncedAt,
              }),
            },
          };
        });
        const eventById = new Map(events.map((event) => [event.id, event]));
        const relationships: RecognitionInput["relationships"] = rows.flatMap((row) => {
          const event = eventById.get(row.economicEventId);
          const provenance = financeProvenanceSchema.safeParse(row.provenance);
          if (
            !event ||
            !provenance.success ||
            !["agent", "system", "user"].includes(provenance.data.actorType)
          )
            return [];
          return [
            {
              createdAt: row.createdAt.toISOString(),
              eventId: event.id,
              eventUserId: event.userId,
              id: row.id,
              provenance: { actorType: provenance.data.actorType as "agent" | "system" | "user" },
              provenanceValidated: true,
              relationship: row.relationship,
              transactionIds: row.transactionIds,
              userId: row.userId,
            },
          ];
        });
        const activityInput = {
          allocations: allocations.map(({ id, transactionId, amount, treatment, state }) => ({
            id,
            transactionId,
            amount,
            treatment,
            state,
          })),
          matches: matches.map(({ amount, creditTransactionId, reimbursementId }) => ({
            amount,
            creditTransactionId,
            reimbursementId,
          })),
          relationships,
          reimbursements: reimbursements.map(
            ({ id, allocationId, expectedAmount, receivedAmount, status }) => ({
              id,
              allocationId,
              expectedAmount,
              receivedAmount,
              status,
            }),
          ),
          transactions: transactions.map(
            ({
              accountId,
              amount,
              category,
              currencyCode,
              direction,
              id,
              pending,
              pendingTransactionId,
              providerDirection,
              providerTransactionId,
              reconciliationStatus,
              transactionDate,
              transferGroupId,
              userId,
            }) => ({
              accountId,
              amount,
              category,
              currencyCode,
              direction,
              id,
              pending,
              pendingTransactionId,
              providerDirection,
              providerTransactionId,
              reconciliationStatus,
              transactionDate,
              transferGroupId,
              userId,
            }),
          ),
          userId,
        };
        const includedAccountIds = new Set(
          accounts
            .filter((account) => scope.accountIds.includes(account.id) && account.includeInPlanning)
            .map((account) => account.id),
        );
        const revisionTransactions = activityInput.transactions.filter((transaction) =>
          includedAccountIds.has(transaction.accountId),
        );
        const revisionTransactionIds = new Set(
          revisionTransactions.map((transaction) => transaction.id),
        );
        const revisionAllocations = activityInput.allocations.filter((allocation) =>
          revisionTransactionIds.has(allocation.transactionId),
        );
        const revisionAllocationIds = new Set(
          revisionAllocations.map((allocation) => allocation.id),
        );
        const revisionReimbursements = activityInput.reimbursements.filter((reimbursement) =>
          revisionAllocationIds.has(reimbursement.allocationId),
        );
        const revisionReimbursementIds = new Set(
          revisionReimbursements.map((reimbursement) => reimbursement.id),
        );
        const revisionRelationships = relationships.filter((relationship) =>
          relationship.transactionIds.some((id) => revisionTransactionIds.has(id)),
        );
        const revisionMatches = activityInput.matches.filter(
          (match) =>
            revisionReimbursementIds.has(match.reimbursementId) &&
            revisionTransactionIds.has(match.creditTransactionId),
        );
        // Sort all row sets before hashing so database ordering cannot create a new revision.
        const activityRevision = positionRevision({
          scope,
          transactions: revisionTransactions.toSorted((a, b) => a.id.localeCompare(b.id)),
          allocations: revisionAllocations.toSorted((a, b) => a.id.localeCompare(b.id)),
          relationships: revisionRelationships.toSorted((a, b) => a.id.localeCompare(b.id)),
          reimbursements: revisionReimbursements.toSorted((a, b) => a.id.localeCompare(b.id)),
          matches: revisionMatches.toSorted(
            (a, b) =>
              a.reimbursementId.localeCompare(b.reimbursementId) ||
              a.creditTransactionId.localeCompare(b.creditTransactionId),
          ),
        });
        return buildFinancePosition({
          ...activityInput,
          accounts,
          asOf,
          scope,
          activitySource: { id: userId, revision: activityRevision },
        });
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }
  async function readPosition(
    userId: string,
    scope: FinancePositionReadScope,
  ): Promise<FinancePositionEvidence> {
    return (await readSnapshot(userId, scope)).position;
  }
  return { readPosition, readSnapshot };
}
