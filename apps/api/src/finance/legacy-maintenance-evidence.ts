import {
  type Database,
  financeAccounts,
  financeClassificationDecisions,
  financeEconomicEvents,
  financeMaintenanceRuns,
  financeReviewCases,
  financeTransactionRelationships,
  financeTransactionRevisions,
  financeTransactions,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import type { MaintenanceScope } from "@personal-os/domain";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { AppError } from "../errors.js";

type ReadExecutor = Pick<Database, "select">;
export type LegacyFinanceEffect = {
  effectId: string;
  kind: "classification" | "relationship" | "transaction_change";
  code: "legacy_maintenance_unverified" | "finance_maintenance_evidence_missing";
  legacyRunId: string | null;
  transactionIds: string[];
  repair: { href: string; label: string; operation: string };
};

function maintenanceRunId(provenance: Record<string, unknown>): string | null {
  return typeof provenance.maintenanceRunId === "string" && provenance.maintenanceRunId.length > 0
    ? provenance.maintenanceRunId
    : null;
}

function isUserDecision(provenance: Record<string, unknown>): boolean {
  return provenance.actorType === "user" && maintenanceRunId(provenance) === null;
}

function sameTransactions(left: string[], right: string[]): boolean {
  const ids = [...new Set(left)].sort();
  const other = [...new Set(right)].sort();
  return ids.length === other.length && ids.every((id, index) => id === other[index]);
}

/**
 * Legacy run effects remain unverified even if they cleared needsReview. A note,
 * clarification, later unrelated revision, or a completed run is not a financial
 * decision. Only evidence for the exact affected classification/relationship can
 * supersede it. This read never changes ledger semantics or creates authority.
 */
export async function findUnverifiedLegacyFinanceEffects(
  executor: ReadExecutor,
  userId: string,
  scope: MaintenanceScope,
): Promise<LegacyFinanceEffect[]> {
  let targetTransactionId: string | undefined;
  if (scope.type === "target") {
    if (scope.entityType === "finance_review_case") {
      const [review] = await executor
        .select({ transactionId: financeReviewCases.transactionId })
        .from(financeReviewCases)
        .where(and(eq(financeReviewCases.userId, userId), eq(financeReviewCases.id, scope.id)));
      if (!review) throw new AppError("not_found", "The Finance target was not found.");
      targetTransactionId = review.transactionId;
    } else if (scope.entityType === "finance_account") {
      const [account] = await executor
        .select({ id: financeAccounts.id })
        .from(financeAccounts)
        .where(and(eq(financeAccounts.userId, userId), eq(financeAccounts.id, scope.id)));
      if (!account) throw new AppError("not_found", "The Finance target was not found.");
    } else if (scope.entityType === "finance_transaction") {
      targetTransactionId = scope.id;
    } else {
      throw new AppError("invalid_request", "The Finance target type is not supported.");
    }
  }
  const transactions = await executor
    .select({ id: financeTransactions.id })
    .from(financeTransactions)
    .where(
      and(
        eq(financeTransactions.userId, userId),
        targetTransactionId ? eq(financeTransactions.id, targetTransactionId) : undefined,
        scope.type === "target" && scope.entityType === "finance_account"
          ? eq(financeTransactions.accountId, scope.id)
          : undefined,
        scope.type === "window" ? gte(financeTransactions.transactionDate, scope.start) : undefined,
        scope.type === "window" ? lte(financeTransactions.transactionDate, scope.end) : undefined,
      ),
    );
  if (targetTransactionId && transactions.length === 0)
    throw new AppError("not_found", "The Finance target was not found.");
  if (transactions.length === 0) return [];
  const transactionIds = transactions.map((transaction) => transaction.id);
  const legacyRuns = await executor
    .select({ id: financeMaintenanceRuns.id })
    .from(financeMaintenanceRuns)
    .where(eq(financeMaintenanceRuns.userId, userId));
  const canonicalRuns = await executor
    .select({ id: workspaceMaintenanceRuns.id })
    .from(workspaceMaintenanceRuns)
    .where(
      and(
        eq(workspaceMaintenanceRuns.userId, userId),
        eq(workspaceMaintenanceRuns.domain, "finances"),
      ),
    );
  const legacyIds = new Set(legacyRuns.map((run) => run.id));
  const canonicalIds = new Set(canonicalRuns.map((run) => run.id));
  const unverifiedProvenance = (
    provenance: Record<string, unknown>,
  ): Pick<LegacyFinanceEffect, "code" | "legacyRunId"> | null => {
    const runId = maintenanceRunId(provenance);
    if (!runId || canonicalIds.has(runId)) return null;
    return legacyIds.has(runId)
      ? { code: "legacy_maintenance_unverified", legacyRunId: runId }
      : { code: "finance_maintenance_evidence_missing", legacyRunId: null };
  };

  const revisions = await executor
    .select()
    .from(financeTransactionRevisions)
    .where(
      and(
        eq(financeTransactionRevisions.userId, userId),
        inArray(financeTransactionRevisions.transactionId, transactionIds),
      ),
    )
    .orderBy(asc(financeTransactionRevisions.version));
  const decisions = await executor
    .select()
    .from(financeClassificationDecisions)
    .where(
      and(
        eq(financeClassificationDecisions.userId, userId),
        eq(financeClassificationDecisions.source, "user"),
        inArray(financeClassificationDecisions.transactionId, transactionIds),
      ),
    );
  const effects: LegacyFinanceEffect[] = [];
  for (const revision of revisions) {
    const provenance = unverifiedProvenance(revision.provenance);
    if (!provenance) continue;
    const classification =
      Object.hasOwn(revision.changes, "category") &&
      Object.keys(revision.changes).every((key) => ["category", "meaning"].includes(key));
    // Later legacy classification replaces the earlier classification effect;
    // unrelated revisions do not hide a still-operative legacy change.
    if (
      classification &&
      revisions.some(
        (later) =>
          later.transactionId === revision.transactionId &&
          later.version > revision.version &&
          Object.hasOwn(later.changes, "category") &&
          (unverifiedProvenance(later.provenance) !== null || isUserDecision(later.provenance)),
      )
    )
      continue;
    if (
      classification &&
      decisions.some(
        (decision) =>
          decision.transactionId === revision.transactionId &&
          decision.outcome !== "deferred" &&
          decision.createdAt > revision.createdAt,
      )
    )
      continue;
    effects.push({
      effectId: revision.id,
      kind: classification ? "classification" : "transaction_change",
      ...provenance,
      transactionIds: [revision.transactionId],
      repair: {
        href: `/finances/transactions?transactionId=${encodeURIComponent(revision.transactionId)}`,
        label: classification
          ? "Review and confirm transaction category"
          : "Inspect transaction change; operator repair required",
        operation: classification ? "update_finance_transaction" : "get_finance_transaction",
      },
    });
  }
  const relationshipRows = await executor
    .select({
      relationship: financeTransactionRelationships,
      eventUserId: financeEconomicEvents.userId,
    })
    .from(financeTransactionRelationships)
    .leftJoin(
      financeEconomicEvents,
      eq(financeEconomicEvents.id, financeTransactionRelationships.economicEventId),
    )
    .where(
      and(
        eq(financeTransactionRelationships.userId, userId),
        sql`${financeTransactionRelationships.transactionIds} ?| ARRAY[${sql.join(
          transactionIds.map((id) => sql`${id}`),
          sql`, `,
        )}]::text[]`,
      ),
    )
    .orderBy(asc(financeTransactionRelationships.createdAt));
  const relationships = relationshipRows.map(({ relationship, eventUserId }) => ({
    ...relationship,
    eventUserId,
  }));
  const ownedTransactions = await executor
    .select({ id: financeTransactions.id })
    .from(financeTransactions)
    .where(eq(financeTransactions.userId, userId));
  const ownedIds = new Set(ownedTransactions.map((transaction) => transaction.id));
  const scopedIds = new Set(transactionIds);
  for (const relationship of relationships) {
    const provenance = unverifiedProvenance(relationship.provenance);
    if (!provenance) continue;
    const superseded = relationships.some(
      (later) =>
        later.createdAt > relationship.createdAt &&
        later.eventUserId === userId &&
        later.transactionIds.every((id) => ownedIds.has(id)) &&
        sameTransactions(later.transactionIds, relationship.transactionIds) &&
        (isUserDecision(later.provenance) || unverifiedProvenance(later.provenance) !== null),
    );
    if (superseded) continue;
    // Do not disclose foreign transaction IDs from a malformed owned relation.
    const ids = relationship.transactionIds.filter((id) => ownedIds.has(id));
    const target = ids.find((id) => scopedIds.has(id));
    if (!target) continue;
    effects.push({
      effectId: relationship.id,
      kind: "relationship",
      ...provenance,
      transactionIds: ids,
      repair: {
        href: `/finances/transactions?transactionId=${encodeURIComponent(target)}`,
        label: "Review and explicitly confirm transaction relationship",
        operation: "link_finance_transactions",
      },
    });
  }
  return effects;
}
