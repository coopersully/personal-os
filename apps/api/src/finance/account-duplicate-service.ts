import { createHash } from "node:crypto";
import {
  type Database,
  financeAccounts,
  financeProviderItems,
  financeTransactions,
} from "@personal-os/database";
import { and, eq, inArray, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import { plaidAccountsHaveSameIdentity } from "../finance-provider-item-service.js";
import type { FinanceTransaction } from "./context.js";

const normalized = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("en-US");

/** Provider evidence survives user-editable display names; never expose remote IDs. */
export function financeProviderDuplicateGroups(
  rows: Array<typeof financeAccounts.$inferSelect>,
): string[][] {
  const buckets = new Map<string, Array<typeof financeAccounts.$inferSelect>>();
  const groups: string[][] = [];
  for (const row of rows) {
    if (row.provider !== "plaid") continue;
    const identity = {
      institutionId: row.providerInstitutionId,
      mask: row.providerAccountMask,
      persistentAccountId: row.providerPersistentAccountId,
      name: row.providerAccountName ?? "",
    };
    const keys = [
      ...(identity.persistentAccountId ? [`persistent:${identity.persistentAccountId}`] : []),
      ...(identity.institutionId && identity.mask && identity.name
        ? [
            `composite:${JSON.stringify([identity.institutionId, identity.mask.trim(), identity.name.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US")])}`,
          ]
        : []),
    ];
    for (const key of keys) {
      const previous = buckets.get(key) ?? [];
      for (const other of previous) {
        if (
          plaidAccountsHaveSameIdentity(identity, {
            institutionId: other.providerInstitutionId,
            mask: other.providerAccountMask,
            persistentAccountId: other.providerPersistentAccountId,
            name: other.providerAccountName ?? "",
          })
        )
          groups.push([other.id, row.id]);
      }
      buckets.set(key, [...previous, row]);
    }
  }
  return groups;
}

/** Owner-scoped evidence only. Equal ledger entries are candidates, never permission to delete. */
export async function inspectFinanceAccountDuplicate(
  db: Database | FinanceTransaction,
  userId: string,
  redundantId: string,
  keepId: string,
  lock = false,
) {
  if (redundantId === keepId)
    throw new AppError("invalid_request", "Choose two different accounts.");
  const query = db
    .select()
    .from(financeAccounts)
    .where(
      and(eq(financeAccounts.userId, userId), inArray(financeAccounts.id, [redundantId, keepId])),
    )
    .orderBy(financeAccounts.id);
  const rows = await (lock ? query.for("update") : query);
  const redundant = rows.find((row) => row.id === redundantId);
  const kept = rows.find((row) => row.id === keepId);
  if (!redundant || !kept) throw new AppError("not_found", "The financial account was not found.");
  if (redundant.provider !== "plaid" || kept.provider !== "plaid")
    throw new AppError(
      "invalid_request",
      "Only Plaid accounts can be compared as duplicate connections.",
    );
  const item = kept.providerItemRecordId
    ? (
        await db
          .select()
          .from(financeProviderItems)
          .where(
            and(
              eq(financeProviderItems.userId, userId),
              eq(financeProviderItems.id, kept.providerItemRecordId),
            ),
          )
          .limit(1)
      )[0]
    : undefined;
  if (
    kept.status !== "connected" ||
    kept.syncState !== "current" ||
    !item ||
    item.syncState !== "current"
  )
    throw new AppError("conflict", "Choose a connected, current account to keep.");
  const identity = (row: typeof kept) => ({
    institutionId: row.providerInstitutionId,
    mask: row.providerAccountMask,
    persistentAccountId: row.providerPersistentAccountId,
    name: row.providerAccountName ?? row.name,
  });
  const strong = plaidAccountsHaveSameIdentity(identity(redundant), identity(kept));
  const conflicting =
    (redundant.providerAccountMask &&
      kept.providerAccountMask &&
      redundant.providerAccountMask !== kept.providerAccountMask) ||
    (redundant.providerInstitutionId &&
      kept.providerInstitutionId &&
      redundant.providerInstitutionId !== kept.providerInstitutionId) ||
    (redundant.providerPersistentAccountId &&
      kept.providerPersistentAccountId &&
      redundant.providerPersistentAccountId !== kept.providerPersistentAccountId);
  const possible =
    normalized(redundant.institution) === normalized(kept.institution) &&
    normalized(redundant.name) === normalized(kept.name);
  if (
    (!strong && (!possible || conflicting)) ||
    (redundant.currencyCode && kept.currencyCode && redundant.currencyCode !== kept.currencyCode)
  )
    throw new AppError(
      "invalid_request",
      "These accounts do not have compatible duplicate evidence.",
    );
  if (lock) {
    // Bound the attended operation and fence edits while rechecking its preview.
    const transactions = await db
      .select({ id: financeTransactions.id })
      .from(financeTransactions)
      .where(
        and(
          eq(financeTransactions.userId, userId),
          inArray(financeTransactions.accountId, [redundantId, keepId]),
        ),
      )
      .orderBy(financeTransactions.id)
      .limit(50_001)
      .for("update");
    if (transactions.length > 50_000)
      throw new AppError(
        "conflict",
        "This account history needs an attended reconciliation before resolving duplicates.",
      );
  }
  const stats = await db.execute<{ account_id: string; count: number; fingerprint: string }>(sql`
    SELECT account_id, count(*)::int AS count,
      coalesce(sum(hashtextextended(to_jsonb(t)::text, 0)::numeric), 0)::text AS fingerprint
    FROM finance_transactions t WHERE user_id = ${userId} AND account_id IN (${redundantId}, ${keepId}) GROUP BY account_id
  `);
  const overlap = await db.execute<{ count: number }>(sql`
    WITH grouped AS (
      SELECT transaction_date, amount_cents, currency_code, direction, merchant, pending,
        count(*) FILTER (WHERE account_id = ${redundantId}) AS redundant_count,
        count(*) FILTER (WHERE account_id = ${keepId}) AS kept_count
      FROM finance_transactions WHERE user_id = ${userId} AND account_id IN (${redundantId}, ${keepId})
      GROUP BY transaction_date, amount_cents, currency_code, direction, merchant, pending
    ) SELECT coalesce(sum(least(redundant_count, kept_count)), 0)::int AS count FROM grouped
  `);
  const redundantTransactionCount =
    stats.rows.find((row) => row.account_id === redundantId)?.count ?? 0;
  const keptTransactionCount = stats.rows.find((row) => row.account_id === keepId)?.count ?? 0;
  const overlappingTransactionCount = overlap.rows[0]?.count ?? 0;
  const revision = createHash("sha256")
    .update(
      JSON.stringify({
        rows: rows.map((row) => ({ ...row, contextualRevision: String(row.contextualRevision) })),
        stats: stats.rows.sort((a, b) => a.account_id.localeCompare(b.account_id)),
        item: { id: item.id, state: item.syncState, updatedAt: item.updatedAt },
      }),
    )
    .digest("hex");
  return {
    redundant,
    kept,
    redundantTransactionCount,
    keptTransactionCount,
    overlappingTransactionCount,
    uniqueRedundantTransactionCount: redundantTransactionCount - overlappingTransactionCount,
    match: strong ? ("provider_identity" as const) : ("possible" as const),
    revision,
  };
}
