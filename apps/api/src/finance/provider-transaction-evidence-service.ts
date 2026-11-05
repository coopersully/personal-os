import {
  accessTokens,
  type Database,
  financeAccounts,
  financeProviderItems,
  financeTransactions,
  sessions,
  users,
} from "@personal-os/database";
import {
  type FinanceProviderTransactionEvidenceInput,
  financeProviderTransactionEvidenceInputSchema,
  financeProviderTransactionEvidenceSchema,
} from "@personal-os/domain";
import { and, eq, inArray } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { createFinanceProviderItemService } from "../finance-provider-item-service.js";
import type { Principal } from "../types.js";

type Options = {
  db: Database;
  now: () => Date;
  providerItems: Pick<
    ReturnType<typeof createFinanceProviderItemService>,
    "readTransactionHistory"
  >;
};
/** No writes, reconciliation or decisions. Network awaits never hold database locks/transactions. */
export function createFinanceProviderTransactionEvidenceService({
  db,
  now,
  providerItems,
}: Options) {
  async function snapshot(principal: Principal, ids: string[], sessionTokenHash?: string) {
    if (!principal.scopes.has("finances:read"))
      throw new AppError("forbidden", "Finance read access is required.");
    return db.transaction(
      async (tx) => {
        const [owner] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, principal.userId));
        if (!owner) throw new AppError("forbidden", "Finance read authority is no longer active.");
        if (principal.actorType === "user") {
          if (!sessionTokenHash)
            throw new AppError(
              "forbidden",
              "Present the authenticated session to read historical evidence.",
            );
          const [session] = await tx
            .select({ expiresAt: sessions.expiresAt })
            .from(sessions)
            .where(
              and(eq(sessions.userId, principal.userId), eq(sessions.tokenHash, sessionTokenHash)),
            );
          if (!session || session.expiresAt <= now())
            throw new AppError("forbidden", "Finance read authority is no longer active.");
        }
        if (principal.actorType === "agent") {
          const [token] = await tx
            .select()
            .from(accessTokens)
            .where(
              and(
                eq(accessTokens.id, principal.actorId),
                eq(accessTokens.userId, principal.userId),
              ),
            );
          if (
            !token ||
            token.revokedAt ||
            (token.expiresAt && token.expiresAt <= now()) ||
            !token.scopes.includes("finances:read") ||
            (principal.authorizationConnectionId !== undefined &&
              token.authorizationConnectionId !== principal.authorizationConnectionId)
          )
            throw new AppError("forbidden", "Finance read authority is no longer active.");
        }
        const rows = await tx
          .select({
            transactionId: financeTransactions.id,
            transactionRevision: financeTransactions.contextualRevision,
            transactionUpdatedAt: financeTransactions.updatedAt,
            providerTransactionId: financeTransactions.providerTransactionId,
            date: financeTransactions.transactionDate,
            accountId: financeAccounts.id,
            accountRevision: financeAccounts.contextualRevision,
            accountUpdatedAt: financeAccounts.updatedAt,
            providerAccountId: financeAccounts.providerAccountId,
            accountProviderItemId: financeAccounts.providerItemId,
            accountStatus: financeAccounts.status,
            provider: financeAccounts.provider,
            itemRecordId: financeProviderItems.id,
            providerItemId: financeProviderItems.providerItemId,
            itemUpdatedAt: financeProviderItems.updatedAt,
            itemProvider: financeProviderItems.provider,
          })
          .from(financeTransactions)
          .innerJoin(
            financeAccounts,
            and(
              eq(financeTransactions.accountId, financeAccounts.id),
              eq(financeAccounts.userId, principal.userId),
            ),
          )
          .innerJoin(
            financeProviderItems,
            and(
              eq(financeAccounts.providerItemRecordId, financeProviderItems.id),
              eq(financeProviderItems.userId, principal.userId),
            ),
          )
          .where(
            and(
              eq(financeTransactions.userId, principal.userId),
              inArray(financeTransactions.id, ids),
            ),
          );
        if (rows.length !== ids.length)
          throw new AppError("not_found", "The native Finance selection is unavailable.");
        return rows.sort((a, b) => a.transactionId.localeCompare(b.transactionId));
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }
  return {
    async read(
      principal: Principal,
      rawInput: FinanceProviderTransactionEvidenceInput,
      sessionTokenHash?: string,
    ) {
      const input = financeProviderTransactionEvidenceInputSchema.parse(rawInput);
      const before = await snapshot(principal, input.transactionIds, sessionTokenHash);
      const first = before[0];
      if (!first) throw new AppError("invalid_request", "A native Finance selection is required.");
      if (
        new Set(before.map((r) => r.itemRecordId)).size !== 1 ||
        new Set(before.map((r) => r.accountId)).size > 5
      )
        throw new AppError(
          "invalid_request",
          "Select at most five accounts on one Finance connection.",
        );
      if (
        before.some(
          (r) =>
            r.provider !== "plaid" ||
            r.itemProvider !== "plaid" ||
            r.accountStatus !== "connected" ||
            !r.providerAccountId ||
            !r.providerTransactionId ||
            !r.providerItemId ||
            r.accountProviderItemId !== r.providerItemId,
        )
      )
        throw new AppError(
          "conflict",
          "The Finance source is not eligible for historical evidence.",
        );
      const dates = before.map((r) => r.date).sort();
      const startDate = dates[0];
      const endDate = dates.at(-1);
      if (
        !startDate ||
        !endDate ||
        !/^\d{4}-\d{2}-\d{2}$/u.test(startDate) ||
        !/^\d{4}-\d{2}-\d{2}$/u.test(endDate) ||
        !Number.isFinite(Date.parse(startDate)) ||
        !Number.isFinite(Date.parse(endDate)) ||
        Date.parse(endDate) - Date.parse(startDate) >= 366 * 86_400_000
      )
        throw new AppError(
          "invalid_request",
          "Select a valid historical window shorter than 366 days.",
        );
      const targets = before.map((row) => {
        if (!row.providerAccountId || !row.providerTransactionId)
          throw new AppError("conflict", "The Finance source changed.");
        return { accountId: row.providerAccountId, transactionId: row.providerTransactionId };
      });
      const evidence = await providerItems.readTransactionHistory({
        userId: principal.userId,
        itemRecordId: first.itemRecordId,
        expectedUpdatedAt: first.itemUpdatedAt.toISOString(),
        targets,
        startDate,
        endDate,
      });
      const after = await snapshot(principal, input.transactionIds, sessionTokenHash);
      const serialize = (value: typeof before) =>
        JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
      if (serialize(before) !== serialize(after))
        throw new AppError("conflict", "The Finance source changed during the provider read.");
      // Never spread a provider row. Native identity is authoritative; unexpected/duplicate provider rows fail closed.
      const entries = before.map((row) => {
        const matches = evidence.entries.filter(
          (entry) =>
            entry.accountId === row.providerAccountId &&
            entry.transactionId === row.providerTransactionId,
        );
        const entry = matches.length === 1 ? matches[0] : undefined;
        return {
          transactionId: row.transactionId,
          accountId: row.accountId,
          transactionRevision: row.transactionRevision.toString(),
          accountRevision: row.accountRevision.toString(),
          status: entry?.status ?? "unobserved",
          sourceAmount: entry?.sourceAmount ?? null,
          normalizedAmount: entry?.normalizedAmount ?? null,
          economicDirection: entry?.economicDirection ?? null,
          currencyCode: entry?.currencyCode ?? null,
          date: entry?.date ?? null,
        };
      });
      const mismatch =
        evidence.entries.length !== before.length ||
        before.some(
          (row) =>
            evidence.entries.filter(
              (e) =>
                e.accountId === row.providerAccountId &&
                e.transactionId === row.providerTransactionId,
            ).length !== 1,
        );
      try {
        return financeProviderTransactionEvidenceSchema.parse({
          observedAt: evidence.observedAt,
          providerUpdatedAt: evidence.providerUpdatedAt,
          snapshotConsistency: "not_atomic",
          coverage: mismatch ? "conflict" : evidence.coverage.state,
          reason: mismatch ? "identity_mismatch" : evidence.coverage.reason,
          entries,
        });
      } catch {
        throw new AppError("service_unavailable", "Historical provider evidence is invalid.");
      }
    },
  };
}
