import {
  auditEvents,
  type Database,
  financeAccountConnections,
  financeAccounts,
} from "@personal-os/database";
import type {
  FinanceAccount,
  FinanceAccountConnection,
  FinanceAccountList,
  FinanceAccountQuery,
  FinanceToolResult,
} from "@personal-os/domain";
import { and, eq } from "drizzle-orm";
import { AppError } from "../errors.js";
import { accountMatchesQuery, summarizeFinanceAccounts } from "./account-semantics.js";
import { executeFinanceIdempotently, type FinanceMutationContext } from "./context.js";

type AccountChange = {
  balance?: number | null | undefined;
  includeInPlanning?: boolean | undefined;
  institution?: string | undefined;
  kind?: "cash" | "investment" | "debt" | "other" | undefined;
  name?: string | undefined;
  ownershipShare?: number | null | undefined;
  ownershipType?: "individual" | "joint" | "unknown" | undefined;
};

function result<T>(
  data: T,
  headline: string,
  changes: FinanceToolResult<T>["changes"] = [],
): FinanceToolResult<T> {
  return {
    changes,
    communication: { headline, optionalDetails: [], requiredDisclosures: [] },
    data,
    outcome: "completed",
    remainingWork: { categories: [], count: 0 },
    schemaVersion: 1,
  };
}

function account(row: typeof financeAccounts.$inferSelect): FinanceAccount {
  return {
    balance: row.balance === null ? null : row.balance / 100,
    createdAt: row.createdAt.toISOString(),
    currencyCode: row.currencyCode,
    id: row.id,
    includeInPlanning: row.includeInPlanning,
    institution: row.institution,
    kind: row.kind,
    kindSource: row.kindSource,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    name: row.name,
    ownershipShare: row.ownershipShareBps === null ? null : row.ownershipShareBps / 10_000,
    ownershipType: row.ownershipType,
    provider: row.provider,
    providerSubtype: row.providerSubtype,
    providerType: row.providerType,
    status: row.status,
    synchronization: {
      failureCode: row.syncErrorCode,
      failureCount: row.syncFailureCount,
      lastAttemptAt: row.lastSyncAttemptAt?.toISOString() ?? null,
      lastSuccessAt: row.lastSyncedAt?.toISOString() ?? null,
      message: row.syncError,
      nextRetryAt: row.syncFailureCount > 0 ? (row.nextSyncAt?.toISOString() ?? null) : null,
      recovery: row.syncRecovery,
      state: row.syncState,
    },
    updatedAt: row.updatedAt.toISOString(),
  };
}

function accountAudit(row: typeof financeAccounts.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    includeInPlanning: row.includeInPlanning,
    kindSource: row.kindSource,
    ownershipShareBps: row.ownershipShareBps,
    ownershipType: row.ownershipType,
    provider: row.provider,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function connection(row: typeof financeAccountConnections.$inferSelect): FinanceAccountConnection {
  const lastError = row.lastError;
  return {
    accountIds: row.accountIds,
    externalHandoff: row.externalHandoffUrl
      ? {
          artifact: row.externalHandoffUrl,
          expiresAt: row.externalHandoffExpiresAt?.toISOString() ?? null,
          provider: row.provider,
        }
      : null,
    id: row.id,
    lastError:
      lastError &&
      typeof lastError.code === "string" &&
      typeof lastError.message === "string" &&
      typeof lastError.retryable === "boolean"
        ? { code: lastError.code, message: lastError.message, retryable: lastError.retryable }
        : null,
    provider: row.provider,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createFinanceAccountService(input: { db: Database; now: () => Date }) {
  const { db, now } = input;

  async function owned(executor: Pick<Database, "select">, userId: string, id: string) {
    const [row] = await executor
      .select()
      .from(financeAccounts)
      .where(and(eq(financeAccounts.id, id), eq(financeAccounts.userId, userId)))
      .limit(1);
    if (!row) throw new AppError("not_found", "The financial account was not found.");
    return row;
  }

  return {
    async list(userId: string, query: FinanceAccountQuery): Promise<FinanceAccountList> {
      const rows = await db
        .select()
        .from(financeAccounts)
        .where(eq(financeAccounts.userId, userId));
      const matching = rows.map(account).filter((item) => accountMatchesQuery(item, query));
      const { accountSemantics, totals } = summarizeFinanceAccounts(matching);
      return {
        accounts: query.includeExcluded
          ? matching
          : matching.filter((item) => item.includeInPlanning),
        accountSemantics,
        totals,
      };
    },

    async getConnection(userId: string, id: string) {
      const [row] = await db
        .select()
        .from(financeAccountConnections)
        .where(
          and(eq(financeAccountConnections.id, id), eq(financeAccountConnections.userId, userId)),
        )
        .limit(1);
      if (!row) throw new AppError("not_found", "The account connection was not found.");
      return result(connection(row), "Account connection loaded.");
    },

    async update(
      id: string,
      change: AccountChange & { idempotencyKey: string },
      context: FinanceMutationContext,
    ) {
      return executeFinanceIdempotently(
        db,
        context,
        {
          idempotencyKey: change.idempotencyKey,
          operation: "finance.account.update",
          payload: { ...change, id },
        },
        async (tx) => {
          const before = await owned(tx, context.userId, id);
          const ownershipType = change.ownershipType ?? before.ownershipType;
          const ownershipShareBps =
            change.ownershipShare === undefined
              ? before.ownershipShareBps
              : change.ownershipShare === null
                ? null
                : Math.round(change.ownershipShare * 10_000);
          if (
            (ownershipType === "individual" && ownershipShareBps !== 10_000) ||
            (ownershipType === "joint" && (ownershipShareBps === null || ownershipShareBps <= 0)) ||
            (ownershipType === "unknown" && ownershipShareBps !== null)
          ) {
            throw new AppError("invalid_request", "The account ownership type and share conflict.");
          }
          const [updated] = await tx
            .update(financeAccounts)
            .set({
              balance:
                change.balance === undefined
                  ? undefined
                  : change.balance === null
                    ? null
                    : Math.round(change.balance * 100),
              institution: change.institution,
              kind: change.kind,
              kindSource: change.kind === undefined ? undefined : "user",
              includeInPlanning: change.includeInPlanning,
              name: change.name,
              ownershipShareBps,
              ownershipType,
              updatedAt: now(),
            })
            .where(eq(financeAccounts.id, before.id))
            .returning();
          if (!updated)
            throw new AppError("internal_error", "The financial account could not be updated.");
          await tx.insert(auditEvents).values({
            action: "finance.account_updated",
            actorId: context.actorId,
            actorType: context.actorType,
            after: accountAudit(updated),
            before: accountAudit(before),
            entityId: id,
            entityType: "finance_account",
            requestId: context.requestId,
            userId: context.userId,
          });
          return result(account(updated), "Account updated.", [
            {
              affectedEntityId: id,
              description: "Updated the account details.",
              reversible: true,
              type: "account_updated",
            },
          ]);
        },
      );
    },

    async disconnect(id: string, idempotencyKey: string, context: FinanceMutationContext) {
      return executeFinanceIdempotently(
        db,
        context,
        {
          idempotencyKey,
          operation: "finance.account.disconnect",
          payload: { id },
        },
        async (tx) => {
          const before = await owned(tx, context.userId, id);
          const [updated] = await tx
            .update(financeAccounts)
            .set({
              encryptedCredentials: null,
              providerAccountId: null,
              providerItemId: null,
              status: before.provider === "manual" ? "manual" : "needs_reauth",
              syncCursor: null,
              updatedAt: now(),
            })
            .where(eq(financeAccounts.id, before.id))
            .returning();
          if (!updated)
            throw new AppError(
              "internal_error",
              "The financial account could not be disconnected.",
            );
          const connections = await tx
            .select()
            .from(financeAccountConnections)
            .where(
              and(
                eq(financeAccountConnections.userId, context.userId),
                eq(financeAccountConnections.provider, before.provider),
              ),
            );
          const connectionIds = connections
            .filter((connection) => connection.accountIds.includes(id))
            .map((connection) => connection.id);
          for (const connectionId of connectionIds) {
            await tx
              .update(financeAccountConnections)
              .set({ status: "disconnected", updatedAt: now() })
              .where(eq(financeAccountConnections.id, connectionId));
          }
          await tx.insert(auditEvents).values({
            action: "finance.account_disconnected",
            actorId: context.actorId,
            actorType: context.actorType,
            after: accountAudit(updated),
            before: accountAudit(before),
            entityId: id,
            entityType: "finance_account",
            requestId: context.requestId,
            userId: context.userId,
          });
          return result(account(updated), "Account disconnected; ledger history was preserved.", [
            {
              affectedEntityId: id,
              description:
                "Removed provider access while preserving the account and its transactions.",
              reversible: true,
              type: "account_disconnected",
            },
          ]);
        },
      );
    },
  };
}
