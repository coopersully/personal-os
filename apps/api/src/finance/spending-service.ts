import { createHash } from "node:crypto";
import {
  type Database,
  financeAccounts,
  financeBudgetBucketCategories,
  financeBudgetBuckets,
  financeBudgetTaxonomies,
  financeCategories,
  financeEconomicEvents,
  financeProviderItems,
  financeReimbursementMatches,
  financeReimbursements,
  financeTransactionAllocations,
  financeTransactionCoverage,
  financeTransactionRelationships,
  financeTransactions,
} from "@personal-os/database";
import {
  type FinanceBudgetBaselineQualificationRead,
  type FinanceSpendingContribution,
  type FinanceSpendingDashboard,
  type FinanceSpendingGroup,
  type FinanceSpendingQuery,
  type FinanceSpendingReferenceFilter,
  financeGroupIcon,
  financeProvenanceSchema,
  financeSpendingDashboardSchema,
  financeSpendingQuerySchema,
  financeSpendingReferenceFilterSchema,
} from "@personal-os/domain";
import { eq } from "drizzle-orm";
import { AppError } from "../errors.js";
import { projectFinanceSpendingMonthlyBudget } from "./spending-budget.js";
import { projectFinanceSpending, type SpendingEvidenceInput } from "./spending-contributions.js";

type Metadata = {
  accounts: Array<{ id: string; label: string }>;
  categories: Array<{ id: string; label: string; color?: string | null }>;
  buckets: Array<{ id: string; label: string; categoryIds: string[] }>;
  transactions: FinanceSpendingDashboard["transactions"];
  source: FinanceSpendingDashboard["source"];
};

/** Group only already-recognized contributions. No second accounting implementation. */
export function buildFinanceSpendingDashboard(
  evidence: SpendingEvidenceInput,
  requested: FinanceSpendingQuery,
  metadata: Metadata,
  qualification?: FinanceBudgetBaselineQualificationRead,
): FinanceSpendingDashboard {
  const query = financeSpendingQuerySchema.parse(requested);
  const accounts = new Set(metadata.accounts.map((row) => row.id));
  const categories = new Set(metadata.categories.map((row) => row.id));
  if (
    query.scope.accountIds?.some((id) => !accounts.has(id)) ||
    query.scope.categoryIds?.some((id) => id !== null && !categories.has(id))
  )
    throw new AppError("not_found", "The spending selection was not found.");
  const unfiltered = projectFinanceSpending(evidence, query.scope);
  // Exclusion is another canonical projection, retaining exact cent residual assignments.
  const snapshot = query.includeUncategorized
    ? unfiltered
    : projectFinanceSpending(evidence, {
        ...query.scope,
        categoryIds:
          query.scope.categoryIds === null
            ? metadata.categories.map((row) => row.id)
            : query.scope.categoryIds.filter((id): id is string => id !== null),
      });
  const group = (
    id: string,
    label: string,
    kind: "bucket" | "category",
    categoryIds: Array<string | null>,
  ): FinanceSpendingGroup => {
    const values = snapshot.contributions.filter((row) => categoryIds.includes(row.categoryId));
    const sum = (
      key: keyof Pick<
        FinanceSpendingContribution,
        | "netCents"
        | "grossCents"
        | "reimbursementAdjustmentCents"
        | "reimbursementOutstandingCents"
        | "refundAdjustmentCents"
      >,
    ) => values.reduce((total, row) => total + row[key], 0);
    const netCents = sum("netCents");
    return {
      id,
      label,
      kind,
      visual: {
        color:
          kind === "category"
            ? (() => {
                const color = metadata.categories.find((row) => row.id === id)?.color;
                return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
              })()
            : null,
        icon: financeGroupIcon(label, id === "uncategorized" ? "uncategorized" : kind),
      },
      categoryIds,
      netCents,
      positiveAreaCents: Math.max(0, netCents),
      grossCents: sum("grossCents"),
      reimbursementAdjustmentCents: sum("reimbursementAdjustmentCents"),
      reimbursementOutstandingCents: sum("reimbursementOutstandingCents"),
      refundAdjustmentCents: sum("refundAdjustmentCents"),
      pendingCents: values
        .filter((row) => row.pending)
        .reduce((total, row) => total + row.netCents, 0),
      drillDown: {
        scope: snapshot.scope,
        contributionIds: values.map((row) => row.id),
        transactionIds: [...new Set(values.map((row) => row.transactionId))],
      },
    };
  };
  const categoryLabels = new Map(metadata.categories.map((row) => [row.id, row.label]));
  const activeCategoryIds = new Set(snapshot.contributions.map((row) => row.categoryId));
  // A qualified target remains inspectable when the selected day/account has no activity.
  // Its selected-period group stays exactly zero, with empty source references.
  const budgetCategories =
    qualification?.state === "qualified"
      ? qualification.qualification.allocations.filter(
          (row) =>
            row.categoryId !== null &&
            (query.scope.categoryIds === null || query.scope.categoryIds.includes(row.categoryId)),
        )
      : [];
  const categoryIds = [
    ...new Set([...activeCategoryIds, ...budgetCategories.map((row) => row.categoryId)]),
  ];
  for (const row of budgetCategories)
    if (row.categoryId !== null && !categoryLabels.has(row.categoryId))
      categoryLabels.set(row.categoryId, row.label);
  const categoryGroups = categoryIds.map((id) =>
    group(
      id ?? "uncategorized",
      id === null ? "Uncategorized" : (categoryLabels.get(id) ?? "Archived category"),
      "category",
      [id],
    ),
  );
  const effectiveGrouping =
    query.grouping !== "categories" && metadata.buckets.length > 0 ? "buckets" : "categories";
  let groups =
    effectiveGrouping === "categories"
      ? categoryGroups.map((row) => ({ ...row, categories: [] }))
      : (() => {
          const assigned = new Set(metadata.buckets.flatMap((row) => row.categoryIds));
          const result = metadata.buckets.map((bucket) => ({
            ...group(bucket.id, bucket.label, "bucket", bucket.categoryIds),
            categories: categoryGroups.filter((row) =>
              row.categoryIds.some((id) => id !== null && bucket.categoryIds.includes(id)),
            ),
          }));
          const unassigned = categoryIds.filter((id) => id === null || !assigned.has(id));
          if (unassigned.length)
            result.push({
              ...group("unassigned", "Other spending", "bucket", unassigned),
              categories: categoryGroups.filter((row) =>
                row.categoryIds.some((id) => unassigned.includes(id)),
              ),
            });
          return result.filter((row) => row.categories.length > 0);
        })();
  const ids = new Set(snapshot.contributions.map((row) => row.transactionId));
  const accountCurrency = new Map(evidence.accounts.map((row) => [row.id, row.currencyCode]));
  const unsupported = new Map<string | null, string[]>();
  // Unsupported evidence remains disclosed with source identity; it is never summed as USD.
  for (const row of evidence.transactions) {
    if (
      !accounts.has(row.accountId) ||
      row.userId !== evidence.userId ||
      (query.scope.accountIds !== null && !query.scope.accountIds.includes(row.accountId))
    )
      continue;
    const currency = row.currencyCode ?? accountCurrency.get(row.accountId) ?? null;
    if (currency !== "USD")
      unsupported.set(currency, [...(unsupported.get(currency) ?? []), row.id]);
  }
  const monthlyBudget = projectFinanceSpendingMonthlyBudget(
    evidence,
    query,
    groups,
    qualification ?? {
      state: "unavailable",
      reason: "qualification_required",
      qualificationRequired: true,
      candidates: [],
    },
  );
  // Unavailable qualification cannot add unrelated empty categories to the selection.
  if (monthlyBudget.state !== "qualified") {
    groups = groups
      .map((row) => ({
        ...row,
        categories: row.categories.filter((category) =>
          category.categoryIds.some((id) => activeCategoryIds.has(id)),
        ),
      }))
      .filter((row) =>
        row.kind === "bucket"
          ? row.categories.length > 0
          : row.categoryIds.some((id) => activeCategoryIds.has(id)),
      );
  }
  const positiveAreaCents = groups.reduce((total, row) => total + row.positiveAreaCents, 0);
  return financeSpendingDashboardSchema.parse({
    monthlyBudget,
    referenceRevision: createHash("sha256")
      .update(
        JSON.stringify({
          scope: snapshot.scope,
          sources: metadata.transactions
            .map((row) => ({ id: row.id, updatedAt: row.updatedAt }))
            .sort((a, b) => a.id.localeCompare(b.id)),
          contributions: [...snapshot.contributions].sort((a, b) => a.id.localeCompare(b.id)),
          groups: groups
            .map((row) => ({ id: row.id, categoryIds: [...row.categoryIds].sort() }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        }),
      )
      .digest("hex"),
    schemaVersion: 1,
    snapshot,
    effectiveGrouping,
    groupingFallback:
      query.grouping === "buckets" && effectiveGrouping === "categories"
        ? "buckets_unavailable"
        : null,
    groups,
    positiveAreaCents,
    negativeAdjustmentCents: positiveAreaCents - snapshot.netCents,
    excludedUncategorizedCents: unfiltered.netCents - snapshot.netCents,
    accounts: metadata.accounts,
    categories: metadata.categories,
    transactions: metadata.transactions.filter((row) => ids.has(row.id)),
    source: metadata.source,
    currency: {
      supported: "USD",
      unsupported: [...unsupported].map(([code, transactionIds]) => ({ code, transactionIds })),
    },
  });
}

/** Complete owner-scoped evidence, loaded once in one read-only repeatable snapshot. */
export function createFinanceSpendingService(input: {
  db: Database;
  now: () => Date;
  readBudgetQualification?:
    | ((userId: string, month: string) => Promise<FinanceBudgetBaselineQualificationRead>)
    | undefined;
}) {
  return {
    async readSpending(userId: string, requested: FinanceSpendingQuery) {
      const query = financeSpendingQuerySchema.parse(requested);
      const qualification =
        input.readBudgetQualification &&
        query.scope.from.slice(0, 7) === query.scope.through.slice(0, 7)
          ? await input.readBudgetQualification(userId, query.scope.from.slice(0, 7))
          : undefined;
      return input.db.transaction(
        async (tx) => {
          const accounts = await tx
            .select()
            .from(financeAccounts)
            .where(eq(financeAccounts.userId, userId));
          const items = await tx
            .select()
            .from(financeProviderItems)
            .where(eq(financeProviderItems.userId, userId));
          const coverageIntervals = await tx
            .select()
            .from(financeTransactionCoverage)
            .where(eq(financeTransactionCoverage.userId, userId));
          const rawTransactions = await tx
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
          const relationships = await tx
            .select()
            .from(financeTransactionRelationships)
            .where(eq(financeTransactionRelationships.userId, userId));
          const events = await tx
            .select()
            .from(financeEconomicEvents)
            .where(eq(financeEconomicEvents.userId, userId));
          const categories = await tx
            .select()
            .from(financeCategories)
            .where(eq(financeCategories.userId, userId));
          const taxonomies = await tx
            .select()
            .from(financeBudgetTaxonomies)
            .where(eq(financeBudgetTaxonomies.userId, userId));
          const buckets = await tx
            .select()
            .from(financeBudgetBuckets)
            .where(eq(financeBudgetBuckets.userId, userId));
          const assignments = await tx
            .select()
            .from(financeBudgetBucketCategories)
            .where(eq(financeBudgetBucketCategories.userId, userId));
          // Posted removals are physically deleted by sync. Removed pending rows retain a self
          // pending reference as the canonical storage marker, and must not remain spending.
          const transactions = rawTransactions.filter(
            (row) =>
              !(
                row.pending &&
                row.providerTransactionId &&
                row.pendingTransactionId === row.providerTransactionId
              ),
          );
          const eventById = new Map(events.map((row) => [row.id, row]));
          const itemById = new Map(items.map((row) => [row.id, row]));
          const selected = accounts.filter(
            (row) => query.scope.accountIds === null || query.scope.accountIds.includes(row.id),
          );
          const asOf = input.now().toISOString();
          const selectedSources = selected
            .filter((row) => row.provider === "plaid")
            .map((row) => {
              const item = row.providerItemRecordId
                ? itemById.get(row.providerItemRecordId)
                : undefined;
              return {
                status: row.status,
                syncState:
                  row.syncState !== "current" ? row.syncState : (item?.syncState ?? row.syncState),
                lastSyncedAt: item?.lastSyncedAt ?? row.lastSyncedAt,
              };
            });
          const unavailable = selectedSources.some(
            (row) =>
              row.status === "needs_reauth" ||
              row.syncState === "blocked" ||
              row.syncState === "retrying",
          );
          const stale = selectedSources.some(
            (row) =>
              row.syncState !== "current" ||
              !row.lastSyncedAt ||
              row.lastSyncedAt.getTime() < Date.parse(asOf) - 86_400_000,
          );
          const syncDates = selectedSources.flatMap((row) =>
            row.lastSyncedAt ? [row.lastSyncedAt.getTime()] : [],
          );
          const activeTaxonomy = taxonomies.find((row) => row.isActive);
          const dashboard = buildFinanceSpendingDashboard(
            {
              userId,
              asOf,
              accounts,
              transactions,
              allocations,
              reimbursements,
              matches,
              // Sync freshness cannot prove history; explicit statement intervals can.
              coverageIntervals,
              coverage: unavailable || stale ? "partial" : "unknown",
              relationships: relationships.flatMap((row) => {
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
                    ...row,
                    eventId: event.id,
                    eventUserId: event.userId,
                    createdAt: row.createdAt.toISOString(),
                    provenanceValidated: true,
                    provenance: {
                      actorType: provenance.data.actorType as "agent" | "system" | "user",
                    },
                  },
                ];
              }),
            },
            query,
            {
              accounts: accounts.map((row) => ({ id: row.id, label: row.name })),
              categories: categories.map((row) => ({
                id: row.id,
                label: row.name,
                color: row.color,
              })),
              buckets: buckets
                .filter((row) => row.taxonomyId === activeTaxonomy?.id)
                .map((row) => ({
                  id: row.id,
                  label: row.name,
                  categoryIds: assignments
                    .filter(
                      (entry) => entry.bucketId === row.id && entry.taxonomyId === row.taxonomyId,
                    )
                    .map((entry) => entry.categoryId),
                })),
              transactions: transactions.map((row) => ({
                id: row.id,
                accountId: row.accountId,
                merchant: row.merchant,
                updatedAt: row.updatedAt.toISOString(),
                date: row.transactionDate,
                pending: row.pending,
              })),
              source: {
                freshness: unavailable
                  ? "unavailable"
                  : stale
                    ? "stale"
                    : selectedSources.length
                      ? "current"
                      : "unknown",
                lastSyncedAt:
                  syncDates.length === selectedSources.length && syncDates.length
                    ? new Date(Math.min(...syncDates)).toISOString()
                    : null,
                reasons: [
                  "historical_coverage_not_certified",
                  ...(unavailable ? ["source_unavailable"] : []),
                  ...(stale ? ["stale_evidence"] : []),
                ],
              },
            },
            qualification,
          );
          if (dashboard.snapshot.coverage === "complete")
            dashboard.source.reasons = dashboard.source.reasons.filter(
              (reason) => reason !== "historical_coverage_not_certified",
            );
          return dashboard;
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
  };
}

/** Revalidate source references against the authenticated current snapshot before paging. */
export function selectFinanceSpendingReferences(
  dashboard: FinanceSpendingDashboard,
  requested: FinanceSpendingReferenceFilter,
  cursor?: string,
  limit = 50,
) {
  const filter = financeSpendingReferenceFilterSchema.parse(requested);
  if (filter.referenceRevision !== dashboard.referenceRevision)
    throw new AppError(
      "conflict",
      "Spending changed. Return to Spending and reopen this selection.",
    );
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new AppError("invalid_request", "Choose at most 100 transactions.");
  const group =
    filter.groupId === null
      ? null
      : dashboard.groups
          .flatMap((row) => [row, ...row.categories])
          .find((row) => row.id === filter.groupId);
  if (filter.groupId !== null && !group)
    throw new AppError("not_found", "The spending group was not found.");
  const ids = group ? new Set(group.drillDown.contributionIds) : null;
  const contributions = dashboard.snapshot.contributions.filter(
    (row) =>
      (ids === null || ids.has(row.id)) && row.date >= filter.from && row.date <= filter.through,
  );
  const transactionIds = [...new Set(contributions.map((row) => row.transactionId))].sort();
  const cursorRevision = createHash("sha256").update(JSON.stringify(filter)).digest("hex");
  let offset = 0;
  if (cursor) {
    const match = /^([a-f0-9]{64}):(\d+)$/.exec(cursor);
    if (!match || match[1] !== cursorRevision)
      throw new AppError("conflict", "Spending pagination is stale. Reopen the selection.");
    offset = Number(match[2]);
    if (!Number.isSafeInteger(offset) || offset > transactionIds.length)
      throw new AppError("invalid_request", "Invalid spending cursor.");
  }
  const pageIds = transactionIds.slice(offset, offset + limit);
  const pageSet = new Set(pageIds);
  return {
    transactionIds: pageIds,
    totalTransactions: transactionIds.length,
    nextCursor:
      offset + limit < transactionIds.length ? `${cursorRevision}:${offset + limit}` : null,
    referenceRevision: filter.referenceRevision,
    netCents: contributions.reduce((sum, row) => sum + row.netCents, 0),
    scope: { ...dashboard.snapshot.scope, from: filter.from, through: filter.through },
    contributions: contributions.filter((row) => pageSet.has(row.transactionId)),
  };
}
