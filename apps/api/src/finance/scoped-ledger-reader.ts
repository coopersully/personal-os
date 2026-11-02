import { createHash } from "node:crypto";
import {
  financeAccounts,
  financeEconomicEvents,
  financeReimbursementMatches,
  financeReimbursements,
  financeTransactionAllocations,
  financeTransactionRelationships,
  financeTransactions,
  users,
} from "@personal-os/database";
import { financeProvenanceSchema } from "@personal-os/domain";
import { and, eq, gte, inArray, lte, or, type SQL, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { FinanceTransaction } from "./context.js";

/** Same per-source ceiling as cashflow; reaching it never certifies completeness. */
export const financeScopedLedgerReadLimit = 1000;
type Scope = { from: string; through: string; accountIds: string[] };
export type ScopedFinanceLedger = {
  userId: string;
  scope: Scope;
  timezone: string | null;
  revision: string;
  accounts: (typeof financeAccounts.$inferSelect)[];
  transactions: (typeof financeTransactions.$inferSelect)[];
  allocations: (typeof financeTransactionAllocations.$inferSelect)[];
  reimbursements: (typeof financeReimbursements.$inferSelect)[];
  matches: (typeof financeReimbursementMatches.$inferSelect)[];
  relationships: (typeof financeTransactionRelationships.$inferSelect)[];
  events: (typeof financeEconomicEvents.$inferSelect)[];
};
type Unavailable = {
  state: "unavailable";
  reason: "ledger_bound_exceeded" | "ledger_evidence_incomplete";
};
const limit = financeScopedLedgerReadLimit;
const unavailable = (reason: Unavailable["reason"]): Unavailable => ({
  state: "unavailable",
  reason,
});
const ids = <T extends { id: string }>(rows: T[]) => rows.map((row) => row.id);
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/** Internal snapshot input, never a public evidence/admission capability. */
export function requireScopedLedgerScope(
  ledger: ScopedFinanceLedger,
  userId: string,
  scope: Scope,
) {
  if (
    ledger.userId !== userId ||
    ledger.scope.from !== scope.from ||
    ledger.scope.through !== scope.through ||
    JSON.stringify(ledger.scope.accountIds) !==
      JSON.stringify([...new Set(scope.accountIds)].sort())
  )
    throw new AppError("conflict", "The private ledger snapshot does not match this read scope.");
}

/** Load period/account seeds and their complete recognition dependency closure in the
 * caller transaction. Relationships, replacements and reimbursements may cross either
 * boundary. Bounded rows are never silently truncated into a complete snapshot. */
export async function readScopedFinanceLedger(
  tx: FinanceTransaction,
  userId: string,
  requested: Scope,
): Promise<{ state: "complete"; ledger: ScopedFinanceLedger } | Unavailable> {
  const scope = { ...requested, accountIds: [...new Set(requested.accountIds)].sort() };
  const ledger: ScopedFinanceLedger = {
    userId,
    scope,
    timezone: null,
    revision: "",
    accounts: [],
    transactions: [],
    allocations: [],
    reimbursements: [],
    matches: [],
    relationships: [],
    events: [],
  };
  const collections = [
    "accounts",
    "transactions",
    "allocations",
    "reimbursements",
    "matches",
    "relationships",
    "events",
  ] as const;
  const complete = () => {
    ledger.revision = createHash("sha256")
      .update(
        JSON.stringify(
          {
            userId,
            scope,
            timezone: ledger.timezone,
            ...Object.fromEntries(
              collections.map((key) => [
                key,
                ledger[key].toSorted((a, b) => a.id.localeCompare(b.id)),
              ]),
            ),
          },
          (_key, value) => (typeof value === "bigint" ? value.toString() : value),
        ),
      )
      .digest("hex");
    return { state: "complete" as const, ledger };
  };
  if (!scope.accountIds.length) return complete();
  const owner = await tx.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { planningTimezone: true },
  });
  if (!owner) return unavailable("ledger_evidence_incomplete");
  ledger.timezone = owner.planningTimezone;
  // Date-only postings stay date-only. Timestamp postings use the same owner-local
  // day as Spending; lexicographic timestamp comparison would drop boundary rows.
  const postingDay = sql<string>`CASE WHEN ${financeTransactions.transactionDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    THEN ${financeTransactions.transactionDate}
    ELSE to_char(${financeTransactions.transactionDate}::timestamptz AT TIME ZONE ${owner.planningTimezone}, 'YYYY-MM-DD') END`;
  ledger.transactions = await tx
    .select()
    .from(financeTransactions)
    .where(
      and(
        eq(financeTransactions.userId, userId),
        inArray(financeTransactions.accountId, scope.accountIds),
        or(
          and(gte(postingDay, scope.from), lte(postingDay, scope.through)),
          and(
            gte(financeTransactions.transactionDate, scope.from),
            lte(financeTransactions.transactionDate, scope.through),
          ),
        ),
      ),
    )
    .limit(limit + 1);
  if (ledger.transactions.length > limit) return unavailable("ledger_bound_exceeded");
  const requiredTransactions = new Set(ids(ledger.transactions));
  const requiredAllocations = new Set<string>();
  const requiredReimbursements = new Set<string>();
  const add = (target: Set<string>, values: string[]) => {
    for (const value of values) {
      target.add(value);
      if (target.size > limit) return false;
    }
    return true;
  };
  let previous = "";
  for (let round = 0; round <= limit; round++) {
    if (requiredTransactions.size) {
      const providerIds = ledger.transactions.flatMap((row) =>
        [row.providerTransactionId, row.pendingTransactionId].filter((id): id is string => !!id),
      );
      const groups = ledger.transactions.flatMap((row) =>
        row.transferGroupId ? [row.transferGroupId] : [],
      );
      ledger.transactions = await tx
        .select()
        .from(financeTransactions)
        .where(
          and(
            eq(financeTransactions.userId, userId),
            or(
              inArray(financeTransactions.id, [...requiredTransactions]),
              ...(providerIds.length
                ? [
                    inArray(financeTransactions.providerTransactionId, providerIds),
                    inArray(financeTransactions.pendingTransactionId, providerIds),
                  ]
                : []),
              ...(groups.length ? [inArray(financeTransactions.transferGroupId, groups)] : []),
            ),
          ),
        )
        .limit(limit + 1);
      if (ledger.transactions.length > limit) return unavailable("ledger_bound_exceeded");
      if (!add(requiredTransactions, ids(ledger.transactions)))
        return unavailable("ledger_bound_exceeded");
    }
    const currentIds = ids(ledger.transactions);
    ledger.allocations =
      currentIds.length || requiredAllocations.size
        ? await tx
            .select()
            .from(financeTransactionAllocations)
            .where(
              and(
                eq(financeTransactionAllocations.userId, userId),
                or(
                  ...(currentIds.length
                    ? [inArray(financeTransactionAllocations.transactionId, currentIds)]
                    : []),
                  ...(requiredAllocations.size
                    ? [inArray(financeTransactionAllocations.id, [...requiredAllocations])]
                    : []),
                ),
              ),
            )
            .limit(limit + 1)
        : [];
    if (ledger.allocations.length > limit) return unavailable("ledger_bound_exceeded");
    const allocationIds = ids(ledger.allocations);
    ledger.reimbursements =
      allocationIds.length || requiredReimbursements.size
        ? await tx
            .select()
            .from(financeReimbursements)
            .where(
              and(
                eq(financeReimbursements.userId, userId),
                or(
                  ...(allocationIds.length
                    ? [inArray(financeReimbursements.allocationId, allocationIds)]
                    : []),
                  ...(requiredReimbursements.size
                    ? [inArray(financeReimbursements.id, [...requiredReimbursements])]
                    : []),
                ),
              ),
            )
            .limit(limit + 1)
        : [];
    if (ledger.reimbursements.length > limit) return unavailable("ledger_bound_exceeded");
    const reimbursementIds = ids(ledger.reimbursements);
    ledger.matches =
      currentIds.length || reimbursementIds.length
        ? await tx
            .select()
            .from(financeReimbursementMatches)
            .where(
              and(
                eq(financeReimbursementMatches.userId, userId),
                or(
                  ...(currentIds.length
                    ? [inArray(financeReimbursementMatches.creditTransactionId, currentIds)]
                    : []),
                  ...(reimbursementIds.length
                    ? [inArray(financeReimbursementMatches.reimbursementId, reimbursementIds)]
                    : []),
                ),
              ),
            )
            .limit(limit + 1)
        : [];
    if (ledger.matches.length > limit) return unavailable("ledger_bound_exceeded");
    const eventIds = ids(ledger.events);
    const related: SQL[] = [];
    if (currentIds.length)
      related.push(
        sql`${financeTransactionRelationships.transactionIds} ?| ARRAY[${sql.join(
          currentIds.map((id) => sql`${id}`),
          sql`, `,
        )}]::text[]`,
      );
    if (eventIds.length)
      related.push(inArray(financeTransactionRelationships.economicEventId, eventIds));
    ledger.relationships = related.length
      ? await tx
          .select()
          .from(financeTransactionRelationships)
          .where(and(eq(financeTransactionRelationships.userId, userId), or(...related)))
          .limit(limit + 1)
      : [];
    if (ledger.relationships.length > limit) return unavailable("ledger_bound_exceeded");
    const nextEvents = [...new Set(ledger.relationships.map((row) => row.economicEventId))];
    ledger.events = nextEvents.length
      ? await tx
          .select()
          .from(financeEconomicEvents)
          .where(
            and(
              eq(financeEconomicEvents.userId, userId),
              inArray(financeEconomicEvents.id, nextEvents),
            ),
          )
          .limit(limit + 1)
      : [];
    if (ledger.events.length > limit) return unavailable("ledger_bound_exceeded");
    for (const row of ledger.relationships) {
      const provenance = financeProvenanceSchema.safeParse(row.provenance);
      if (
        !Array.isArray(row.transactionIds) ||
        row.transactionIds.some((id) => typeof id !== "string" || !uuid.test(id)) ||
        !provenance.success ||
        !["agent", "user", "system"].includes(provenance.data.actorType)
      )
        return unavailable("ledger_evidence_incomplete");
      if (!add(requiredTransactions, row.transactionIds))
        return unavailable("ledger_bound_exceeded");
    }
    if (
      !add(
        requiredTransactions,
        ledger.allocations.map((row) => row.transactionId),
      ) ||
      !add(
        requiredTransactions,
        ledger.matches.map((row) => row.creditTransactionId),
      ) ||
      !add(
        requiredAllocations,
        ledger.reimbursements.map((row) => row.allocationId),
      ) ||
      !add(
        requiredReimbursements,
        ledger.matches.map((row) => row.reimbursementId),
      )
    )
      return unavailable("ledger_bound_exceeded");
    // Include IDs and all discovered edge classes: equal row counts alone cannot prove closure.
    const signature = JSON.stringify([
      [...requiredTransactions].sort(),
      [...requiredAllocations].sort(),
      [...requiredReimbursements].sort(),
      ids(ledger.transactions).sort(),
      ids(ledger.allocations).sort(),
      ids(ledger.reimbursements).sort(),
      ids(ledger.matches).sort(),
      ids(ledger.relationships).sort(),
      ids(ledger.events).sort(),
    ]);
    if (signature === previous) {
      if (
        [...requiredTransactions].some((id) => !currentIds.includes(id)) ||
        [...requiredAllocations].some((id) => !allocationIds.includes(id)) ||
        [...requiredReimbursements].some((id) => !reimbursementIds.includes(id)) ||
        nextEvents.some((id) => !ledger.events.some((row) => row.id === id))
      )
        return unavailable("ledger_evidence_incomplete");
      const accountIds = [
        ...new Set([...scope.accountIds, ...ledger.transactions.map((row) => row.accountId)]),
      ];
      ledger.accounts = await tx
        .select()
        .from(financeAccounts)
        .where(and(eq(financeAccounts.userId, userId), inArray(financeAccounts.id, accountIds)))
        .limit(limit + 1);
      if (ledger.accounts.length > limit) return unavailable("ledger_bound_exceeded");
      if (accountIds.some((id) => !ledger.accounts.some((row) => row.id === id)))
        return unavailable("ledger_evidence_incomplete");
      return complete();
    }
    previous = signature;
  }
  return unavailable("ledger_bound_exceeded");
}
