import {
  auditEvents,
  type Database,
  financeAccountConnections,
  financeAccounts,
  financeProviderItems,
} from "@personal-os/database";
import type {
  FinanceAccount,
  FinanceAccountConnection,
  FinanceAccountList,
  FinanceAccountQuery,
  FinanceToolResult,
} from "@personal-os/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import { accountMatchesQuery, summarizeFinanceAccounts } from "./account-semantics.js";
import { executeFinanceIdempotently, type FinanceMutationContext } from "./context.js";

type AccountChange = {
  expectedUpdatedAt?: string | undefined;
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

function account(
  row: typeof financeAccounts.$inferSelect,
  item?: typeof financeProviderItems.$inferSelect,
): FinanceAccount {
  // A healthy Item cannot certify an account absent from its latest snapshot.
  // Item-wide failures still take precedence so repair targets the connection.
  const synchronization =
    item?.syncState === "current" && row.syncState === "blocked" ? row : (item ?? row);
  return {
    balance: row.balance === null ? null : row.balance / 100,
    createdAt: row.createdAt.toISOString(),
    currencyCode: row.currencyCode,
    id: row.id,
    includeInPlanning: row.includeInPlanning,
    institution: row.institution,
    kind: row.kind,
    kindSource: row.kindSource,
    lastSyncedAt: synchronization.lastSyncedAt?.toISOString() ?? null,
    name: row.name,
    ownershipShare: row.ownershipShareBps === null ? null : row.ownershipShareBps / 10_000,
    ownershipType: row.ownershipType,
    provider: row.provider,
    providerSubtype: row.providerSubtype,
    providerType: row.providerType,
    status:
      synchronization === row
        ? row.status
        : item?.syncRecovery === "reconnect"
          ? "needs_reauth"
          : "connected",
    synchronization: {
      failureCode: synchronization.syncErrorCode,
      failureCount: synchronization.syncFailureCount,
      lastAttemptAt: synchronization.lastSyncAttemptAt?.toISOString() ?? null,
      lastSuccessAt: synchronization.lastSyncedAt?.toISOString() ?? null,
      message: synchronization.syncError,
      nextRetryAt:
        synchronization.syncFailureCount > 0
          ? (synchronization.nextSyncAt?.toISOString() ?? null)
          : null,
      recovery: synchronization.syncRecovery,
      state: synchronization.syncState,
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
      .for("update")
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
      const itemIds = [
        ...new Set(
          rows.flatMap((row) => (row.providerItemRecordId ? [row.providerItemRecordId] : [])),
        ),
      ];
      const items =
        itemIds.length === 0
          ? []
          : await db
              .select()
              .from(financeProviderItems)
              .where(inArray(financeProviderItems.id, itemIds));
      const itemById = new Map(items.map((item) => [item.id, item]));
      if (
        rows.some((row) => {
          if (!row.providerItemRecordId) return false;
          const item = itemById.get(row.providerItemRecordId);
          return (
            !item ||
            row.provider !== "plaid" ||
            item.provider !== "plaid" ||
            item.userId !== row.userId
          );
        })
      ) {
        throw new AppError("conflict", "The Plaid connection topology is inconsistent.");
      }
      const matching = rows
        .map((row) =>
          account(
            row,
            row.providerItemRecordId ? itemById.get(row.providerItemRecordId) : undefined,
          ),
        )
        .filter((item) => accountMatchesQuery(item, query));
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
          if (
            change.expectedUpdatedAt &&
            before.updatedAt.toISOString() !== change.expectedUpdatedAt
          ) {
            throw new AppError(
              "conflict",
              "This account changed. Reload it before saving your changes.",
            );
          }
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
              updatedAt: new Date(Math.max(now().getTime(), before.updatedAt.getTime() + 1)),
            })
            .where(eq(financeAccounts.id, before.id))
            .returning();
          if (!updated)
            throw new AppError(
              "conflict",
              "This account changed. Reload it before saving your changes.",
            );
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
          lockIdentities: [`finance-provider-topology:${context.userId}`],
          operation: "finance.account.disconnect",
          payload: { id },
        },
        async (tx) => {
          // Match connection/relink lock order: topology, Item, then accounts.
          const [candidate] = await tx
            .select()
            .from(financeAccounts)
            .where(and(eq(financeAccounts.id, id), eq(financeAccounts.userId, context.userId)))
            .limit(1);
          if (!candidate) throw new AppError("not_found", "The financial account was not found.");
          const itemId = candidate.providerItemRecordId;
          let lastLinkedAccount = false;
          if (itemId) {
            const [item] = await tx
              .select({
                userId: financeProviderItems.userId,
                activeClaim: sql<boolean>`${financeProviderItems.syncClaimId} IS NOT NULL AND ${financeProviderItems.syncClaimExpiresAt} > CURRENT_TIMESTAMP`,
              })
              .from(financeProviderItems)
              .where(eq(financeProviderItems.id, itemId))
              .for("update");
            if (!item || item.userId !== context.userId || candidate.provider !== "plaid") {
              throw new AppError("conflict", "The Plaid connection topology is inconsistent.");
            }
            if (item.activeClaim) {
              throw new AppError(
                "conflict",
                "The Plaid connection is synchronizing. Retry disconnection after it finishes.",
              );
            }
            const siblings = await tx
              .select()
              .from(financeAccounts)
              .where(eq(financeAccounts.providerItemRecordId, itemId))
              .orderBy(financeAccounts.id)
              .for("update");
            if (siblings.some((row) => row.userId !== context.userId || row.provider !== "plaid")) {
              throw new AppError("conflict", "The Plaid connection topology is inconsistent.");
            }
            lastLinkedAccount = siblings.length === 1;
          }
          const before = await owned(tx, context.userId, id);
          if (before.providerItemRecordId !== itemId) {
            throw new AppError("conflict", "The Plaid connection topology changed. Try again.");
          }
          const [activeAccountClaim] = await tx
            .select({ id: financeAccounts.id })
            .from(financeAccounts)
            .where(
              and(
                eq(financeAccounts.id, id),
                sql`${financeAccounts.syncClaimId} IS NOT NULL AND ${financeAccounts.syncClaimExpiresAt} > CURRENT_TIMESTAMP`,
              ),
            );
          if (activeAccountClaim) {
            throw new AppError(
              "conflict",
              "The account is synchronizing. Retry disconnection after it finishes.",
            );
          }
          const [updated] = await tx
            .update(financeAccounts)
            .set({
              encryptedCredentials: null,
              // Keep remote identity so a later consented reconnect reuses ledger history.
              providerItemId: null,
              providerItemRecordId: null,
              status: before.provider === "manual" ? "manual" : "needs_reauth",
              syncCursor: null,
              syncClaimId: null,
              syncClaimExpiresAt: null,
              nextSyncAt: null,
              ...(before.provider === "plaid"
                ? {
                    syncState: "blocked" as const,
                    syncError:
                      "This account is disconnected. Connect it again to resume synchronization.",
                    syncErrorCode: "finance_account_disconnected",
                    syncErrorCategory: "authorization" as const,
                    syncRecovery: "reconnect" as const,
                    syncFailureCount: 1,
                  }
                : {}),
              updatedAt: new Date(Math.max(now().getTime(), before.updatedAt.getTime() + 1)),
            })
            .where(eq(financeAccounts.id, before.id))
            .returning();
          if (!updated)
            throw new AppError(
              "internal_error",
              "The financial account could not be disconnected.",
            );
          if (itemId && lastLinkedAccount) {
            await tx.delete(financeProviderItems).where(eq(financeProviderItems.id, itemId));
          }
          const connections = await tx
            .select()
            .from(financeAccountConnections)
            .where(
              and(
                eq(financeAccountConnections.userId, context.userId),
                eq(financeAccountConnections.provider, before.provider),
              ),
            );
          for (const connection of connections.filter((connection) =>
            connection.accountIds.includes(id),
          )) {
            const remainingIds = connection.accountIds.filter((accountId) => accountId !== id);
            await tx
              .update(financeAccountConnections)
              .set({
                accountIds: remainingIds,
                status: remainingIds.length === 0 ? "disconnected" : connection.status,
                updatedAt: now(),
              })
              .where(eq(financeAccountConnections.id, connection.id));
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
                "Stopped local synchronization while preserving the account and its transactions. Provider consent is managed at the institution.",
              reversible: true,
              type: "account_disconnected",
            },
          ]);
        },
      );
    },
  };
}
