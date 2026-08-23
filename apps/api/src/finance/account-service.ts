import {
  auditEvents,
  type Database,
  financeAccountConnections,
  financeAccounts,
} from "@personal-os/database";
import type {
  FinanceAccount,
  FinanceAccountConnection,
  FinanceToolResult,
} from "@personal-os/domain";
import { and, eq } from "drizzle-orm";
import { AppError } from "../errors.js";
import { executeFinanceIdempotently, type FinanceMutationContext } from "./context.js";

type AccountChange = {
  balance?: number | null | undefined;
  institution?: string | undefined;
  kind?: "cash" | "investment" | "debt" | "other" | undefined;
  name?: string | undefined;
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
    id: row.id,
    institution: row.institution,
    kind: row.kind,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    name: row.name,
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
          expiresAt: row.externalHandoffExpiresAt?.toISOString() ?? null,
          provider: row.provider,
          url: row.externalHandoffUrl,
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

  async function owned(userId: string, id: string) {
    const [row] = await db
      .select()
      .from(financeAccounts)
      .where(and(eq(financeAccounts.id, id), eq(financeAccounts.userId, userId)))
      .limit(1);
    if (!row) throw new AppError("not_found", "The financial account was not found.");
    return row;
  }

  return {
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
        async () => {
          const before = await owned(context.userId, id);
          const [updated] = await db
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
              name: change.name,
              updatedAt: now(),
            })
            .where(eq(financeAccounts.id, before.id))
            .returning();
          if (!updated)
            throw new AppError("internal_error", "The financial account could not be updated.");
          await db.insert(auditEvents).values({
            action: "finance.account_updated",
            actorId: context.actorId,
            actorType: context.actorType,
            after: account(updated),
            before: account(before),
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
        async () => {
          const before = await owned(context.userId, id);
          const [updated] = await db
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
          const connections = await db
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
            await db
              .update(financeAccountConnections)
              .set({ status: "disconnected", updatedAt: now() })
              .where(eq(financeAccountConnections.id, connectionId));
          }
          await db.insert(auditEvents).values({
            action: "finance.account_disconnected",
            actorId: context.actorId,
            actorType: context.actorType,
            after: account(updated),
            before: account(before),
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
