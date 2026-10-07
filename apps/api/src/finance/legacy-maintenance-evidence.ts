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
import { readProjectionRows } from "./search-projection-bounds.js";

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
  searchLimit?: number,
): Promise<LegacyFinanceEffect[]> {
  let targetTransactionId: string | undefined;
  if (scope.type === "target") {
    if (scope.entityType === "finance_review_case") {
      const [review] = await readProjectionRows(
        executor
          .select({ transactionId: financeReviewCases.transactionId })
          .from(financeReviewCases)
          .where(and(eq(financeReviewCases.userId, userId), eq(financeReviewCases.id, scope.id))),
        searchLimit,
      );
      if (!review) throw new AppError("not_found", "The Finance target was not found.");
      targetTransactionId = review.transactionId;
    } else if (scope.entityType === "finance_account") {
      const [account] = await readProjectionRows(
        executor
          .select({ id: financeAccounts.id })
          .from(financeAccounts)
          .where(and(eq(financeAccounts.userId, userId), eq(financeAccounts.id, scope.id))),
        searchLimit,
      );
      if (!account) throw new AppError("not_found", "The Finance target was not found.");
    } else if (scope.entityType === "finance_transaction") {
      targetTransactionId = scope.id;
    } else {
      throw new AppError("invalid_request", "The Finance target type is not supported.");
    }
  }
  const transactions = await readProjectionRows(
    executor
      .select({ id: financeTransactions.id })
      .from(financeTransactions)
      .where(
        and(
          eq(financeTransactions.userId, userId),
          searchLimit === undefined
            ? undefined
            : sql`(
            EXISTS (
              SELECT 1 FROM finance_transaction_revisions candidate_revision
              WHERE candidate_revision.user_id = ${userId}
                AND candidate_revision.transaction_id = ${financeTransactions.id}
                AND jsonb_typeof(candidate_revision.provenance -> 'maintenanceRunId') = 'string'
                AND candidate_revision.provenance ->> 'maintenanceRunId' <> ''
                AND NOT EXISTS (
                  SELECT 1 FROM workspace_maintenance_runs canonical_run
                  WHERE canonical_run.user_id = ${userId} AND canonical_run.domain = 'finances'
                    AND canonical_run.id::text = candidate_revision.provenance ->> 'maintenanceRunId'
                )
            ) OR EXISTS (
              SELECT 1 FROM finance_transaction_relationships candidate_relationship
              WHERE candidate_relationship.user_id = ${userId}
                AND candidate_relationship.transaction_ids ? ${financeTransactions.id}::text
                AND jsonb_typeof(candidate_relationship.provenance -> 'maintenanceRunId') = 'string'
                AND candidate_relationship.provenance ->> 'maintenanceRunId' <> ''
                AND NOT EXISTS (
                  SELECT 1 FROM workspace_maintenance_runs canonical_run
                  WHERE canonical_run.user_id = ${userId} AND canonical_run.domain = 'finances'
                    AND canonical_run.id::text = candidate_relationship.provenance ->> 'maintenanceRunId'
                )
            )
          )`,
          targetTransactionId ? eq(financeTransactions.id, targetTransactionId) : undefined,
          scope.type === "target" && scope.entityType === "finance_account"
            ? eq(financeTransactions.accountId, scope.id)
            : undefined,
          scope.type === "window"
            ? gte(financeTransactions.transactionDate, scope.start)
            : undefined,
          scope.type === "window" ? lte(financeTransactions.transactionDate, scope.end) : undefined,
        ),
      ),
    searchLimit,
  );
  if (targetTransactionId && transactions.length === 0)
    throw new AppError("not_found", "The Finance target was not found.");
  if (transactions.length === 0) return [];
  const transactionIds = transactions.map((transaction) => transaction.id);
  const revisions = await readProjectionRows(
    executor
      .select()
      .from(financeTransactionRevisions)
      .where(
        and(
          eq(financeTransactionRevisions.userId, userId),
          inArray(financeTransactionRevisions.transactionId, transactionIds),
        ),
      )
      .orderBy(asc(financeTransactionRevisions.version)),
    searchLimit,
  );
  const decisions = await readProjectionRows(
    executor
      .select()
      .from(financeClassificationDecisions)
      .where(
        and(
          eq(financeClassificationDecisions.userId, userId),
          eq(financeClassificationDecisions.source, "user"),
          inArray(financeClassificationDecisions.transactionId, transactionIds),
        ),
      ),
    searchLimit,
  );
  const relationshipRows = await readProjectionRows(
    executor
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
      .orderBy(asc(financeTransactionRelationships.createdAt)),
    searchLimit,
  );
  const relationships = relationshipRows.map(({ relationship, eventUserId }) => ({
    ...relationship,
    eventUserId,
  }));
  const referencedRunIds = [
    ...new Set(
      [...revisions, ...relationships].flatMap((row) => {
        const id = maintenanceRunId(row.provenance);
        return id ? [id] : [];
      }),
    ),
  ];
  const legacyRuns = await readProjectionRows(
    executor
      .select({ id: financeMaintenanceRuns.id })
      .from(financeMaintenanceRuns)
      .where(
        and(
          eq(financeMaintenanceRuns.userId, userId),
          searchLimit === undefined
            ? undefined
            : inArray(sql`${financeMaintenanceRuns.id}::text`, referencedRunIds),
        ),
      ),
    searchLimit,
  );
  const canonicalRuns = await readProjectionRows(
    executor
      .select({ id: workspaceMaintenanceRuns.id })
      .from(workspaceMaintenanceRuns)
      .where(
        and(
          eq(workspaceMaintenanceRuns.userId, userId),
          eq(workspaceMaintenanceRuns.domain, "finances"),
          searchLimit === undefined
            ? undefined
            : inArray(sql`${workspaceMaintenanceRuns.id}::text`, referencedRunIds),
        ),
      ),
    searchLimit,
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
  const ownedTransactions = await readProjectionRows(
    executor
      .select({ id: financeTransactions.id })
      .from(financeTransactions)
      .where(
        and(
          eq(financeTransactions.userId, userId),
          searchLimit === undefined
            ? undefined
            : inArray(financeTransactions.id, [
                ...new Set(relationships.flatMap((row) => row.transactionIds)),
              ]),
        ),
      ),
    searchLimit,
  );
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
