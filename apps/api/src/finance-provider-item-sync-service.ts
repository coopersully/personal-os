import { randomUUID } from "node:crypto";
import {
  ConnectorError,
  type PlaidAccountSnapshot,
  type PlaidConnector,
  type PlaidTransactionSnapshot,
} from "@personal-os/connectors";
import {
  auditEvents,
  type Database,
  type EncryptedCredentials,
  financeAccounts,
  financeProviderItems,
  financeReviewCases,
  financeTransactions,
} from "@personal-os/database";
import type { MaintenanceScope } from "@personal-os/domain";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { auditValues } from "./audit.js";
import {
  classifyConnectorSyncFailure,
  connectorRetryAt,
  connectorSyncAppError,
} from "./connector-sync-health.js";
import { AppError } from "./errors.js";
import { decryptJson } from "./security.js";
import type { Principal, RequestLog } from "./types.js";

export type FinanceProviderItemSyncContext = {
  maintenance?: {
    idempotencyKey: string;
    policy: "approved_rule";
    rulebookVersion: string;
    runId: string;
  };
  maintenanceClaim?: { claimId: string; runId: string };
  principal: Principal;
  requestId: string;
};

export type FinanceSyncBatchResult = {
  attempted: number;
  failed: number;
  recovered: number;
  skipped: number;
  succeeded: number;
};

type FinanceSyncProgress = () => Promise<void>;
type FinanceWriteExecutor = Pick<Database, "delete" | "insert" | "select" | "update">;
type PlaidCredentials = { accessToken: string };

export type PreparedFinanceProviderTransaction = {
  category: string | null;
  categoryConfidence: number | null;
  categorySource: "provider" | "rule" | null;
  isTransfer: boolean;
  merchant: string;
  needsReview: boolean;
  remote: PlaidTransactionSnapshot;
};

type ProjectionLookups = { categoryId: string | null; merchantId: string | null };

type Options = {
  assertMaintenanceClaim?: (
    executor: FinanceWriteExecutor,
    context?: FinanceProviderItemSyncContext,
  ) => Promise<void>;
  db: Database;
  encryptionKey?: string;
  log?: (entry: RequestLog) => void;
  now: () => Date;
  plaid?: PlaidConnector;
  prepareTransaction: (
    remote: PlaidTransactionSnapshot,
    userId: string,
  ) => Promise<PreparedFinanceProviderTransaction>;
  resolveProjectionLookups: (
    executor: FinanceWriteExecutor,
    userId: string,
    prepared: PreparedFinanceProviderTransaction,
  ) => Promise<ProjectionLookups>;
  resolveScopeAccountId: (userId: string, scope: MaintenanceScope) => Promise<string | undefined>;
};

const claimLeaseMs = 5 * 60_000;
const syncIntervalMs = 6 * 60 * 60_000;
const batchLimit = 25;
const concurrency = 3;
const invalidCursorCodes = new Set(["plaid_invalid_cursor", "plaid_transactions_cursor_invalid"]);
const invalidCursorReplayCode = "plaid_invalid_cursor_replay_in_progress";
const invalidCursorReplayFailedCode = "plaid_invalid_cursor_replay_failed";

type ActiveClaim = {
  generation: number;
  id: string;
  owner: string;
};

class MaintenanceClaimLostError extends Error {
  public constructor() {
    super("The Finance maintenance claim expired during synchronization.");
    this.name = "MaintenanceClaimLostError";
  }
}

function isClaimConflict(error: unknown): boolean {
  return (
    error instanceof MaintenanceClaimLostError ||
    (error instanceof AppError && error.code === "conflict")
  );
}

function providerDirection(remote: PlaidTransactionSnapshot): "expense" | "income" {
  return remote.amount < 0 ? "income" : "expense";
}

function failureIsInvalidCursor(error: unknown): boolean {
  return error instanceof ConnectorError && invalidCursorCodes.has(error.code);
}

function databaseErrorCode(error: unknown): string | null {
  let current = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== "object" || current === null) return null;
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : null;
  }
  return null;
}

export function createFinanceProviderItemSyncService(options: Options) {
  const { db, log, now, prepareTransaction, resolveProjectionLookups, resolveScopeAccountId } =
    options;
  const claimOwner = randomUUID();

  function claimableFailureState() {
    return and(
      or(
        isNull(financeProviderItems.syncRecovery),
        eq(financeProviderItems.syncRecovery, "automatic"),
        and(
          eq(financeProviderItems.syncRecovery, "operator"),
          isNotNull(financeProviderItems.nextSyncAt),
        ),
      ),
      or(
        isNull(financeProviderItems.syncErrorCode),
        ne(financeProviderItems.syncErrorCode, invalidCursorReplayFailedCode),
      ),
    );
  }

  async function assertMaintenanceClaim(
    executor: FinanceWriteExecutor,
    context?: FinanceProviderItemSyncContext,
  ) {
    try {
      await options.assertMaintenanceClaim?.(executor, context);
    } catch {
      throw new MaintenanceClaimLostError();
    }
  }

  function getPlaid(): PlaidConnector {
    if (!options.plaid) {
      throw new ConnectorError({
        category: "configuration",
        code: "plaid_configuration_missing",
        disposition: "operator",
        message: "Plaid is not configured for this ilo instance.",
        status: 503,
      });
    }
    return options.plaid;
  }

  function credentials(value: EncryptedCredentials): PlaidCredentials {
    if (!options.encryptionKey) {
      throw new ConnectorError({
        category: "configuration",
        code: "finance_encryption_configuration_missing",
        disposition: "operator",
        message: "Finance credential encryption is not configured.",
        status: 503,
      });
    }
    return decryptJson<PlaidCredentials>(value, options.encryptionKey);
  }

  async function preserveProgress(onProgress?: FinanceSyncProgress) {
    if (!onProgress) return;
    try {
      await onProgress();
    } catch {
      throw new MaintenanceClaimLostError();
    }
  }

  async function lockActiveClaim(
    executor: FinanceWriteExecutor,
    itemId: string,
    claim: ActiveClaim,
    userId: string,
  ) {
    const [item] = await executor
      .select()
      .from(financeProviderItems)
      .where(
        and(
          eq(financeProviderItems.id, itemId),
          eq(financeProviderItems.userId, userId),
          eq(financeProviderItems.provider, "plaid"),
          eq(financeProviderItems.syncClaimId, claim.id),
          eq(financeProviderItems.syncClaimOwner, claim.owner),
          eq(financeProviderItems.syncClaimGeneration, claim.generation),
          sql`${financeProviderItems.syncClaimExpiresAt} > NOW()`,
        ),
      )
      .limit(1)
      .for("update");
    if (!item) {
      throw new AppError(
        "conflict",
        "The Finance Provider Item synchronization claim is no longer current.",
      );
    }
    await executor
      .update(financeProviderItems)
      .set({
        syncClaimExpiresAt: sql`NOW() + ${claimLeaseMs} * INTERVAL '1 millisecond'`,
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(financeProviderItems.id, itemId),
          eq(financeProviderItems.syncClaimId, claim.id),
          eq(financeProviderItems.syncClaimOwner, claim.owner),
          eq(financeProviderItems.syncClaimGeneration, claim.generation),
        ),
      );
    return item;
  }

  async function lockLinkedAccounts(
    executor: FinanceWriteExecutor,
    itemId: string,
    userId: string,
  ) {
    const accounts = await executor
      .select()
      .from(financeAccounts)
      .where(eq(financeAccounts.providerItemRecordId, itemId))
      .orderBy(asc(financeAccounts.id))
      .for("update");
    if (accounts.some((account) => account.userId !== userId || account.provider !== "plaid")) {
      throw new AppError("conflict", "The Plaid connection topology is inconsistent.");
    }
    return accounts;
  }

  async function claimItem(
    itemId: string,
    context: FinanceProviderItemSyncContext,
  ): Promise<{
    accounts: Array<typeof financeAccounts.$inferSelect>;
    claim: ActiveClaim;
    item: typeof financeProviderItems.$inferSelect;
  }> {
    const claimId = randomUUID();
    return db.transaction(async (tx) => {
      await assertMaintenanceClaim(tx, context);
      const [claimed] = await tx
        .update(financeProviderItems)
        .set({
          lastSyncAttemptAt: sql`NOW()`,
          syncClaimExpiresAt: sql`NOW() + ${claimLeaseMs} * INTERVAL '1 millisecond'`,
          syncClaimGeneration: sql`COALESCE(${financeProviderItems.syncClaimGeneration} + 1, 0)`,
          syncClaimId: claimId,
          syncClaimOwner: claimOwner,
          syncClaimStartedAt: sql`NOW()`,
          updatedAt: sql`NOW()`,
        })
        .where(
          and(
            eq(financeProviderItems.id, itemId),
            eq(financeProviderItems.userId, context.principal.userId),
            eq(financeProviderItems.provider, "plaid"),
            claimableFailureState(),
            or(
              isNull(financeProviderItems.syncClaimId),
              sql`${financeProviderItems.syncClaimExpiresAt} <= NOW()`,
            ),
          ),
        )
        .returning();
      if (!claimed || claimed.syncClaimGeneration === null) {
        const [blocked] = await tx
          .select({ error: financeProviderItems.syncError, state: financeProviderItems.syncState })
          .from(financeProviderItems)
          .where(
            and(
              eq(financeProviderItems.id, itemId),
              eq(financeProviderItems.userId, context.principal.userId),
              eq(financeProviderItems.syncState, "blocked"),
            ),
          )
          .for("update")
          .limit(1);
        if (blocked) {
          throw new AppError(
            "service_unavailable",
            blocked.error ?? "This Finance Provider Item requires explicit repair before syncing.",
            { itemId },
          );
        }
        throw new AppError("conflict", "This Finance Provider Item is already synchronizing.", {
          itemId,
        });
      }
      const accounts = await lockLinkedAccounts(tx, itemId, context.principal.userId);
      if (accounts.length === 0) {
        throw new AppError(
          "conflict",
          "The Plaid connection changed while this sync was in progress. Retry against the current connection.",
        );
      }
      return {
        accounts,
        claim: { generation: claimed.syncClaimGeneration, id: claimId, owner: claimOwner },
        item: claimed,
      };
    });
  }

  async function resolveLegacyIdentity(
    itemId: string,
    claim: ActiveClaim,
    context: FinanceProviderItemSyncContext,
    accessToken: string,
  ) {
    const snapshot = await getPlaid().getItem(accessToken);
    try {
      await db.transaction(async (tx) => {
        await assertMaintenanceClaim(tx, context);
        const item = await lockActiveClaim(tx, itemId, claim, context.principal.userId);
        await lockLinkedAccounts(tx, itemId, context.principal.userId);
        if (item.providerItemId !== null && item.providerItemId !== snapshot.itemId) {
          throw new ConnectorError({
            category: "configuration",
            code: "finance_provider_item_identity_mismatch",
            disposition: "operator",
            message: "The Plaid Item identity requires operator review.",
          });
        }
        await tx
          .update(financeProviderItems)
          .set({ providerItemId: snapshot.itemId, updatedAt: now() })
          .where(eq(financeProviderItems.id, itemId));
        await tx
          .update(financeAccounts)
          .set({ providerItemId: snapshot.itemId, updatedAt: now() })
          .where(eq(financeAccounts.providerItemRecordId, itemId));
      });
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      if (databaseErrorCode(error) === "23505") {
        throw new ConnectorError({
          category: "configuration",
          code: "finance_provider_item_identity_conflict",
          disposition: "operator",
          message: "The Plaid Item identity conflicts with an existing connection.",
        });
      }
      throw error;
    }
  }

  async function projectPage(input: {
    claim: ActiveClaim;
    context: FinanceProviderItemSyncContext;
    itemId: string;
    page: Awaited<ReturnType<PlaidConnector["syncTransactions"]>>;
    prepared: PreparedFinanceProviderTransaction[];
  }): Promise<number> {
    return db.transaction(async (tx) => {
      await assertMaintenanceClaim(tx, input.context);
      await lockActiveClaim(tx, input.itemId, input.claim, input.context.principal.userId);
      const accounts = await lockLinkedAccounts(tx, input.itemId, input.context.principal.userId);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`finance-provider-lookups:${input.context.principal.userId}`}, 0))`,
      );
      const accountByProviderId = new Map(
        accounts.flatMap((account) =>
          account.providerAccountId ? [[account.providerAccountId, account]] : [],
        ),
      );
      const preparedForLinkedAccounts = input.prepared.filter((prepared) =>
        accountByProviderId.has(prepared.remote.accountId),
      );
      const lookupByTransactionId = new Map<string, ProjectionLookups>();
      const lookupOrder = [...preparedForLinkedAccounts].sort(
        (left, right) =>
          left.merchant.localeCompare(right.merchant) ||
          left.remote.transactionId.localeCompare(right.remote.transactionId),
      );
      for (const prepared of lookupOrder) {
        lookupByTransactionId.set(
          prepared.remote.transactionId,
          await resolveProjectionLookups(tx, input.context.principal.userId, prepared),
        );
      }

      let changed = 0;
      const removed = input.page.removed.map((entry) => entry.transactionId).sort();
      const replacements = new Set(
        preparedForLinkedAccounts.flatMap((prepared) =>
          prepared.remote.pendingTransactionId ? [prepared.remote.pendingTransactionId] : [],
        ),
      );
      const removedRows =
        removed.length === 0
          ? []
          : await tx
              .select()
              .from(financeTransactions)
              .where(
                and(
                  inArray(
                    financeTransactions.accountId,
                    accounts.map((account) => account.id),
                  ),
                  inArray(financeTransactions.providerTransactionId, removed),
                ),
              )
              .orderBy(financeTransactions.id)
              .for("update");
      const deletable = removedRows.flatMap((transaction) =>
        !transaction.pending &&
        transaction.providerTransactionId &&
        !replacements.has(transaction.providerTransactionId)
          ? [transaction.providerTransactionId]
          : [],
      );
      for (const transaction of removedRows) {
        if (!transaction.pending || !transaction.providerTransactionId) continue;
        await tx
          .update(financeTransactions)
          .set({
            pendingTransactionId: transaction.providerTransactionId,
            updatedAt: now(),
          })
          .where(eq(financeTransactions.id, transaction.id));
      }
      for (let offset = 0; offset < deletable.length; offset += 1_000) {
        const deleted = await tx
          .delete(financeTransactions)
          .where(
            and(
              inArray(
                financeTransactions.accountId,
                accounts.map((account) => account.id),
              ),
              inArray(
                financeTransactions.providerTransactionId,
                deletable.slice(offset, offset + 1_000),
              ),
            ),
          )
          .returning({ id: financeTransactions.id });
        changed += deleted.length;
      }

      for (const prepared of [...preparedForLinkedAccounts].sort((left, right) =>
        left.remote.transactionId.localeCompare(right.remote.transactionId),
      )) {
        const remote = prepared.remote;
        const localAccount = accountByProviderId.get(remote.accountId);
        if (!localAccount) continue;
        const lookups = lookupByTransactionId.get(remote.transactionId) ?? {
          categoryId: null,
          merchantId: null,
        };
        let [existing] = await tx
          .select()
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.accountId, localAccount.id),
              eq(financeTransactions.providerTransactionId, remote.transactionId),
            ),
          )
          .for("update")
          .limit(1);
        if (!existing && remote.pendingTransactionId) {
          [existing] = await tx
            .select()
            .from(financeTransactions)
            .where(
              and(
                eq(financeTransactions.accountId, localAccount.id),
                eq(financeTransactions.providerTransactionId, remote.pendingTransactionId),
              ),
            )
            .for("update")
            .limit(1);
          if (existing) {
            await tx
              .update(financeTransactions)
              .set({ providerTransactionId: remote.transactionId })
              .where(eq(financeTransactions.id, existing.id));
          }
        }
        const protectedTransaction =
          existing &&
          existing.categoryDecidedAt !== null &&
          (existing.categorySource === "user" || existing.categorySource === "agent")
            ? existing
            : null;
        const direction = providerDirection(remote);
        const previousDirection =
          protectedTransaction?.providerDirection ??
          (protectedTransaction?.direction === "expense" ||
          protectedTransaction?.direction === "income"
            ? protectedTransaction.direction
            : null);
        const signChanged =
          protectedTransaction !== null &&
          previousDirection !== null &&
          previousDirection !== direction;
        await tx
          .insert(financeTransactions)
          .values({
            accountId: localAccount.id,
            amount: Math.round(Math.abs(remote.amount) * 100),
            category: prepared.category,
            categoryConfidence: prepared.categoryConfidence,
            categoryId: lookups.categoryId,
            categorySource: prepared.categorySource,
            currencyCode: remote.currencyCode,
            direction,
            merchant: prepared.merchant,
            merchantId: lookups.merchantId,
            needsReview: prepared.isTransfer || prepared.needsReview,
            pending: remote.pending,
            pendingTransactionId: remote.pendingTransactionId,
            providerCategory: remote.personalFinanceCategory?.primary ?? null,
            providerCategoryConfidence: remote.personalFinanceCategory?.confidenceLevel ?? null,
            providerCategoryDetailed: remote.personalFinanceCategory?.detailed ?? null,
            providerDirection: direction,
            providerTransactionId: remote.transactionId,
            reconciliationStatus: prepared.isTransfer ? "candidate" : "not_applicable",
            transactionDate: remote.date,
            userId: input.context.principal.userId,
          })
          .onConflictDoUpdate({
            set: {
              amount: Math.round(Math.abs(remote.amount) * 100),
              category: protectedTransaction ? protectedTransaction.category : prepared.category,
              categoryConfidence: protectedTransaction
                ? protectedTransaction.categoryConfidence
                : prepared.categoryConfidence,
              categoryDecidedAt: protectedTransaction
                ? protectedTransaction.categoryDecidedAt
                : null,
              categoryId: protectedTransaction
                ? protectedTransaction.categoryId
                : lookups.categoryId,
              categoryRationale: protectedTransaction
                ? protectedTransaction.categoryRationale
                : null,
              categorySource: protectedTransaction
                ? protectedTransaction.categorySource
                : prepared.categorySource,
              currencyCode: remote.currencyCode,
              direction: protectedTransaction
                ? signChanged && protectedTransaction.direction !== "transfer"
                  ? direction
                  : protectedTransaction.direction
                : direction,
              merchant: prepared.merchant,
              merchantId: lookups.merchantId,
              needsReview: protectedTransaction
                ? signChanged || protectedTransaction.needsReview
                : prepared.isTransfer || prepared.needsReview,
              pending: remote.pending,
              pendingTransactionId: remote.pendingTransactionId,
              providerCategory: remote.personalFinanceCategory?.primary ?? null,
              providerCategoryConfidence: remote.personalFinanceCategory?.confidenceLevel ?? null,
              providerCategoryDetailed: remote.personalFinanceCategory?.detailed ?? null,
              providerDirection: direction,
              reconciliationStatus: protectedTransaction
                ? protectedTransaction.reconciliationStatus
                : prepared.isTransfer
                  ? "candidate"
                  : "not_applicable",
              transactionDate: remote.date,
              transferGroupId: protectedTransaction ? protectedTransaction.transferGroupId : null,
              updatedAt: now(),
            },
            target: [financeTransactions.accountId, financeTransactions.providerTransactionId],
          });
        if (signChanged && existing) {
          const [review] = await tx
            .select()
            .from(financeReviewCases)
            .where(
              and(
                eq(financeReviewCases.transactionId, existing.id),
                inArray(financeReviewCases.status, ["deferred", "open"]),
              ),
            )
            .orderBy(desc(financeReviewCases.updatedAt))
            .for("update")
            .limit(1);
          if (review) {
            await tx
              .update(financeReviewCases)
              .set({
                rationale: "The provider changed the transaction direction after categorization.",
                reason: "refund_or_reversal",
                suggestedCategoryId: existing.categoryId,
                updatedAt: now(),
              })
              .where(eq(financeReviewCases.id, review.id));
          } else {
            await tx.insert(financeReviewCases).values({
              rationale: "The provider changed the transaction direction after categorization.",
              reason: "refund_or_reversal",
              status: "open",
              suggestedCategoryId: existing.categoryId,
              transactionId: existing.id,
              userId: input.context.principal.userId,
            });
          }
        }
        changed += 1;
      }

      if (!input.page.hasMore) {
        const deletedDeferred = await tx
          .delete(financeTransactions)
          .where(
            and(
              inArray(
                financeTransactions.accountId,
                accounts.map((account) => account.id),
              ),
              eq(financeTransactions.pending, true),
              sql`${financeTransactions.pendingTransactionId} = ${financeTransactions.providerTransactionId}`,
            ),
          )
          .returning({ id: financeTransactions.id });
        changed += deletedDeferred.length;
      }

      const updatedAt = now();
      await tx
        .update(financeProviderItems)
        .set({ syncCursor: input.page.nextCursor, updatedAt })
        .where(eq(financeProviderItems.id, input.itemId));
      await tx
        .update(financeAccounts)
        .set({ syncCursor: input.page.nextCursor, updatedAt })
        .where(eq(financeAccounts.providerItemRecordId, input.itemId));
      await tx.insert(auditEvents).values(
        auditValues({
          action: "finance.plaid_page_projected",
          after: {
            added: input.page.added.filter((remote) => accountByProviderId.has(remote.accountId))
              .length,
            changed,
            hasMore: input.page.hasMore,
            modified: input.page.modified.filter((remote) =>
              accountByProviderId.has(remote.accountId),
            ).length,
            removed: removedRows.length,
          },
          before: null,
          entityId: input.itemId,
          entityType: "finance_provider_item",
          ...input.context,
        }),
      );
      return changed;
    });
  }

  async function projectAccounts(input: {
    accounts: PlaidAccountSnapshot[];
    claim: ActiveClaim;
    context: FinanceProviderItemSyncContext;
    itemId: string;
  }) {
    await db.transaction(async (tx) => {
      await assertMaintenanceClaim(tx, input.context);
      await lockActiveClaim(tx, input.itemId, input.claim, input.context.principal.userId);
      const linkedAccounts = await lockLinkedAccounts(
        tx,
        input.itemId,
        input.context.principal.userId,
      );
      const snapshotByProviderId = new Map(
        input.accounts.map((account) => [account.accountId, account]),
      );
      let projected = 0;
      for (const linkedAccount of linkedAccounts) {
        if (!linkedAccount.providerAccountId) continue;
        const snapshot = snapshotByProviderId.get(linkedAccount.providerAccountId);
        if (!snapshot) continue;
        await tx
          .update(financeAccounts)
          .set({
            balance:
              snapshot.balanceCurrent === null ? null : Math.round(snapshot.balanceCurrent * 100),
            currencyCode: snapshot.currencyCode,
            name: snapshot.officialName ?? snapshot.name,
            updatedAt: now(),
          })
          .where(eq(financeAccounts.id, linkedAccount.id));
        projected += 1;
      }
      if (projected > 0) {
        await tx.insert(auditEvents).values(
          auditValues({
            action: "finance.plaid_accounts_projected",
            after: { projected },
            before: null,
            entityId: input.itemId,
            entityType: "finance_provider_item",
            ...input.context,
          }),
        );
      }
    });
  }

  async function settleSuccess(input: {
    accountId: string;
    changed: number;
    claim: ActiveClaim;
    context: FinanceProviderItemSyncContext;
    itemId: string;
  }) {
    const completedAt = now();
    await db.transaction(async (tx) => {
      await assertMaintenanceClaim(tx, input.context);
      await lockActiveClaim(tx, input.itemId, input.claim, input.context.principal.userId);
      await lockLinkedAccounts(tx, input.itemId, input.context.principal.userId);
      const nextSyncAt = new Date(completedAt.getTime() + syncIntervalMs);
      await tx
        .update(financeProviderItems)
        .set({
          lastSyncedAt: completedAt,
          nextSyncAt,
          syncClaimExpiresAt: null,
          syncClaimGeneration: null,
          syncClaimId: null,
          syncClaimOwner: null,
          syncClaimStartedAt: null,
          syncError: null,
          syncErrorCategory: null,
          syncErrorCode: null,
          syncFailureCount: 0,
          syncRecovery: null,
          syncState: "current",
          updatedAt: completedAt,
        })
        .where(eq(financeProviderItems.id, input.itemId));
      await tx
        .update(financeAccounts)
        .set({
          lastSyncedAt: completedAt,
          nextSyncAt,
          syncClaimExpiresAt: null,
          syncClaimId: null,
          syncError: null,
          syncErrorCategory: null,
          syncErrorCode: null,
          syncFailureCount: 0,
          syncRecovery: null,
          syncState: "current",
          status: "connected",
          updatedAt: completedAt,
        })
        .where(eq(financeAccounts.providerItemRecordId, input.itemId));
      await tx.insert(auditEvents).values(
        auditValues({
          action: "finance.plaid_synced",
          after: { changed: input.changed },
          before: null,
          entityId: input.accountId,
          entityType: "finance_account",
          ...input.context,
        }),
      );
    });
  }

  async function settleFailure(input: {
    accountId: string;
    claim: ActiveClaim;
    context: FinanceProviderItemSyncContext;
    error: unknown;
    itemId: string;
  }): Promise<{
    failure: ReturnType<typeof classifyConnectorSyncFailure>;
    nextSyncAt: Date | null;
  }> {
    const failedAt = now();
    const invalidCursorReported = failureIsInvalidCursor(input.error);
    let failure = classifyConnectorSyncFailure(input.error, "plaid");
    let nextSyncAt: Date | null = null;
    await db.transaction(async (tx) => {
      await assertMaintenanceClaim(tx, input.context);
      const item = await lockActiveClaim(
        tx,
        input.itemId,
        input.claim,
        input.context.principal.userId,
      );
      await lockLinkedAccounts(tx, input.itemId, input.context.principal.userId);
      const replayInProgress = item.syncErrorCode === invalidCursorReplayCode;
      const replayScheduled =
        invalidCursorReported && !replayInProgress && item.syncCursor !== null;
      const replayFailed = invalidCursorReported && (replayInProgress || item.syncCursor === null);
      if (replayFailed) {
        failure = {
          ...failure,
          code: invalidCursorReplayFailedCode,
          message: "Plaid could not restart transaction synchronization. ilo is resolving this.",
          recovery: "operator",
        };
      }
      const failureCount = item.syncFailureCount + 1;
      nextSyncAt = replayFailed
        ? null
        : replayScheduled
          ? failedAt
          : failure.recovery === "reconnect"
            ? null
            : connectorRetryAt({
                accountId: item.id,
                failureCount,
                now: failedAt,
                retryAfterMs: failure.retryAfterMs,
              });
      const preserveReplayMarker =
        replayInProgress && !invalidCursorReported && failure.recovery === "automatic";
      const itemValues = replayScheduled
        ? {
            nextSyncAt: failedAt,
            syncCursor: null,
            syncError: "Plaid transaction history is being replayed from a safe checkpoint.",
            syncErrorCategory: "rejected" as const,
            syncErrorCode: invalidCursorReplayCode,
            syncFailureCount: failureCount,
            syncRecovery: "automatic" as const,
            syncState: "retrying" as const,
          }
        : preserveReplayMarker
          ? {
              nextSyncAt,
              syncError: item.syncError,
              syncErrorCategory: item.syncErrorCategory,
              syncErrorCode: invalidCursorReplayCode,
              syncFailureCount: failureCount,
              syncRecovery: "automatic" as const,
              syncState: "retrying" as const,
            }
          : {
              nextSyncAt,
              syncError: failure.message,
              syncErrorCategory: failure.category,
              syncErrorCode: failure.code,
              syncFailureCount: failureCount,
              syncRecovery: failure.recovery,
              syncState:
                failure.recovery === "automatic" ? ("retrying" as const) : ("blocked" as const),
            };
      await tx
        .update(financeProviderItems)
        .set({
          ...itemValues,
          syncClaimExpiresAt: null,
          syncClaimGeneration: null,
          syncClaimId: null,
          syncClaimOwner: null,
          syncClaimStartedAt: null,
          updatedAt: failedAt,
        })
        .where(eq(financeProviderItems.id, input.itemId));
      await tx
        .update(financeAccounts)
        .set({
          ...(replayScheduled ? { syncCursor: null } : {}),
          ...(failure.recovery === "reconnect" && !replayScheduled
            ? { status: "needs_reauth" as const }
            : {}),
          nextSyncAt: itemValues.nextSyncAt,
          syncClaimExpiresAt: null,
          syncClaimId: null,
          syncError: itemValues.syncError,
          syncErrorCategory: itemValues.syncErrorCategory,
          syncErrorCode: itemValues.syncErrorCode,
          syncFailureCount: itemValues.syncFailureCount,
          syncRecovery: itemValues.syncRecovery,
          syncState: itemValues.syncState,
          updatedAt: failedAt,
        })
        .where(eq(financeAccounts.providerItemRecordId, input.itemId));
      await tx.insert(auditEvents).values(
        auditValues({
          action: replayScheduled
            ? "finance.plaid_cursor_replay_scheduled"
            : "finance.plaid_sync_failed",
          after: replayScheduled
            ? { replayScheduled: true }
            : { failureCode: failure.code, recovery: failure.recovery },
          before: null,
          entityId: input.itemId,
          entityType: "finance_provider_item",
          ...input.context,
        }),
      );
    });
    return { failure, nextSyncAt };
  }

  async function synchronizeItem(
    itemId: string,
    accountId: string,
    context: FinanceProviderItemSyncContext,
    onProgress?: FinanceSyncProgress,
  ) {
    const startedAt = Date.now();
    const claimed = await claimItem(itemId, context);
    const previousFailureCount = claimed.item.syncFailureCount;
    const linkedProviderAccountIds = new Set(
      claimed.accounts.flatMap((account) =>
        account.providerAccountId ? [account.providerAccountId] : [],
      ),
    );
    try {
      await preserveProgress(onProgress);
      const accessToken = credentials(claimed.item.encryptedCredentials).accessToken;
      if (!claimed.item.providerItemId) {
        await resolveLegacyIdentity(itemId, claimed.claim, context, accessToken);
      }
      await preserveProgress(onProgress);
      const accountSnapshots = await getPlaid().getAccounts(accessToken);
      await preserveProgress(onProgress);
      await projectAccounts({
        accounts: accountSnapshots,
        claim: claimed.claim,
        context,
        itemId,
      });
      let cursor = claimed.item.syncCursor;
      let hasMore = true;
      let changed = 0;
      while (hasMore) {
        await preserveProgress(onProgress);
        const providerPage = await getPlaid().syncTransactions({ accessToken, cursor });
        await preserveProgress(onProgress);
        if (
          [...providerPage.added, ...providerPage.modified].some(
            (remote) => remote.pendingTransactionId === remote.transactionId,
          )
        ) {
          throw new ConnectorError({
            category: "invalid_response",
            code: "plaid_invalid_response",
            disposition: "retry",
            message: "Plaid returned an invalid response.",
          });
        }
        const page = {
          ...providerPage,
          added: providerPage.added.filter((remote) =>
            linkedProviderAccountIds.has(remote.accountId),
          ),
          modified: providerPage.modified.filter((remote) =>
            linkedProviderAccountIds.has(remote.accountId),
          ),
        };
        const prepared = await Promise.all(
          [...page.added, ...page.modified].map((remote) =>
            prepareTransaction(remote, context.principal.userId),
          ),
        );
        changed += await projectPage({
          claim: claimed.claim,
          context,
          itemId,
          page,
          prepared,
        });
        cursor = page.nextCursor;
        hasMore = page.hasMore;
      }
      await preserveProgress(onProgress);
      await settleSuccess({ accountId, changed, claim: claimed.claim, context, itemId });
      log?.({
        accountId,
        durationMs: Date.now() - startedAt,
        event: "connector_sync_completed",
        method: "CONNECTOR",
        path: `/internal/finances/provider-items/${itemId}/sync`,
        provider: "plaid",
        requestId: `sync:finance:${claimed.claim.id}`,
        status: 200,
      });
      if (previousFailureCount > 0) {
        log?.({
          accountId,
          durationMs: Date.now() - startedAt,
          event: "connector_sync_recovered",
          failureCount: previousFailureCount,
          method: "CONNECTOR",
          path: `/internal/finances/provider-items/${itemId}/sync`,
          provider: "plaid",
          requestId: `sync:finance:${claimed.claim.id}`,
          status: 200,
        });
      }
      return { changed };
    } catch (error) {
      if (isClaimConflict(error)) {
        throw new AppError(
          "conflict",
          error instanceof Error ? error.message : "The synchronization claim was lost.",
        );
      }
      let settled: Awaited<ReturnType<typeof settleFailure>>;
      try {
        settled = await settleFailure({ accountId, claim: claimed.claim, context, error, itemId });
      } catch (settlementError) {
        if (isClaimConflict(settlementError)) {
          throw new AppError(
            "conflict",
            settlementError instanceof Error
              ? settlementError.message
              : "The synchronization claim was lost.",
          );
        }
        throw settlementError;
      }
      log?.({
        accountId,
        category: settled.failure.category,
        code: settled.failure.code,
        disposition: settled.failure.recovery,
        durationMs: Date.now() - startedAt,
        event: "connector_sync_failed",
        failureCount: claimed.item.syncFailureCount + 1,
        method: "CONNECTOR",
        nextSyncAt: settled.nextSyncAt?.toISOString() ?? null,
        path: `/internal/finances/provider-items/${itemId}/sync`,
        provider: "plaid",
        requestId: `sync:finance:${claimed.claim.id}`,
        status: settled.failure.status ?? 503,
      });
      throw connectorSyncAppError(settled.failure, accountId, "plaid", settled.nextSyncAt);
    }
  }

  async function selectedDueItems(userId?: string, targetAccountId?: string) {
    const selectedAt = now();
    if (targetAccountId) {
      return db
        .select({
          accountId: financeAccounts.id,
          item: financeProviderItems,
        })
        .from(financeAccounts)
        .innerJoin(
          financeProviderItems,
          eq(financeProviderItems.id, financeAccounts.providerItemRecordId),
        )
        .where(
          and(
            eq(financeAccounts.id, targetAccountId),
            userId ? eq(financeAccounts.userId, userId) : undefined,
            eq(financeAccounts.provider, "plaid"),
            eq(financeProviderItems.userId, financeAccounts.userId),
            eq(financeProviderItems.provider, "plaid"),
            claimableFailureState(),
            lte(financeProviderItems.nextSyncAt, selectedAt),
          ),
        )
        .limit(1);
    }
    const items = await db
      .select()
      .from(financeProviderItems)
      .where(
        and(
          userId ? eq(financeProviderItems.userId, userId) : undefined,
          eq(financeProviderItems.provider, "plaid"),
          claimableFailureState(),
          lte(financeProviderItems.nextSyncAt, selectedAt),
          exists(
            db
              .select({ id: financeAccounts.id })
              .from(financeAccounts)
              .where(
                and(
                  eq(financeAccounts.providerItemRecordId, financeProviderItems.id),
                  eq(financeAccounts.userId, financeProviderItems.userId),
                  eq(financeAccounts.provider, "plaid"),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(financeProviderItems.nextSyncAt), asc(financeProviderItems.updatedAt))
      .limit(batchLimit);
    if (items.length === 0) return [];
    const representatives = await db
      .select({ id: financeAccounts.id, itemId: financeAccounts.providerItemRecordId })
      .from(financeAccounts)
      .innerJoin(
        financeProviderItems,
        eq(financeProviderItems.id, financeAccounts.providerItemRecordId),
      )
      .where(
        and(
          inArray(
            financeAccounts.providerItemRecordId,
            items.map((item) => item.id),
          ),
          eq(financeAccounts.userId, financeProviderItems.userId),
          eq(financeAccounts.provider, "plaid"),
        ),
      )
      .orderBy(asc(financeAccounts.id));
    const accountByItem = new Map<string, string>();
    for (const row of representatives) {
      if (row.itemId && !accountByItem.has(row.itemId)) accountByItem.set(row.itemId, row.id);
    }
    return items.flatMap((item) => {
      const accountId = accountByItem.get(item.id);
      return accountId ? [{ accountId, item }] : [];
    });
  }

  async function syncSelected(
    selected: Awaited<ReturnType<typeof selectedDueItems>>,
    contextFor: (entry: (typeof selected)[number]) => FinanceProviderItemSyncContext,
    onProgress?: FinanceSyncProgress,
  ): Promise<FinanceSyncBatchResult> {
    const result: FinanceSyncBatchResult = {
      attempted: selected.length,
      failed: 0,
      recovered: 0,
      skipped: 0,
      succeeded: 0,
    };
    let cursor = 0;
    const worker = async () => {
      while (cursor < selected.length) {
        const entry = selected[cursor];
        cursor += 1;
        if (!entry) continue;
        try {
          await synchronizeItem(entry.item.id, entry.accountId, contextFor(entry), onProgress);
          result.succeeded += 1;
          if (entry.item.syncFailureCount > 0) result.recovered += 1;
        } catch (error) {
          if (error instanceof AppError && error.code === "conflict") result.skipped += 1;
          else result.failed += 1;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, selected.length) }, async () => worker()),
    );
    return result;
  }

  return {
    async syncAccount(
      accountId: string,
      context: FinanceProviderItemSyncContext,
      onProgress?: FinanceSyncProgress,
      _scope: MaintenanceScope = { type: "all_outstanding" },
    ) {
      const [owned] = await db
        .select({
          itemId: financeAccounts.providerItemRecordId,
          provider: financeAccounts.provider,
        })
        .from(financeAccounts)
        .where(
          and(
            eq(financeAccounts.id, accountId),
            eq(financeAccounts.userId, context.principal.userId),
          ),
        )
        .limit(1);
      if (!owned) throw new AppError("not_found", "The financial account was not found.");
      if (owned.provider !== "plaid" || !owned.itemId) {
        throw new AppError("invalid_request", "This is not a connected Plaid account.");
      }
      const [ownedItem] = await db
        .select({ id: financeProviderItems.id })
        .from(financeProviderItems)
        .where(
          and(
            eq(financeProviderItems.id, owned.itemId),
            eq(financeProviderItems.userId, context.principal.userId),
            eq(financeProviderItems.provider, "plaid"),
          ),
        )
        .limit(1);
      if (!ownedItem) {
        throw new AppError("conflict", "The Plaid connection topology is inconsistent.");
      }
      return synchronizeItem(owned.itemId, accountId, context, onProgress);
    },

    async syncDueItems(): Promise<FinanceSyncBatchResult> {
      const selected = await selectedDueItems();
      const selectedAt = now();
      const result = await syncSelected(selected, (entry) => ({
        principal: {
          actorId: entry.item.userId,
          actorType: "user",
          scopes: new Set(["finances:read", "finances:write"]),
          userId: entry.item.userId,
        },
        requestId: `scheduler:finance:${entry.item.id}:${selectedAt.toISOString()}`,
      }));
      const allItems = await db
        .select()
        .from(financeProviderItems)
        .where(
          exists(
            db
              .select({ id: financeAccounts.id })
              .from(financeAccounts)
              .where(
                and(
                  eq(financeAccounts.providerItemRecordId, financeProviderItems.id),
                  eq(financeAccounts.userId, financeProviderItems.userId),
                  eq(financeAccounts.provider, "plaid"),
                ),
              ),
          ),
        );
      const freshnessAgeMs =
        allItems.length === 0
          ? undefined
          : allItems.reduce(
              (maximum, item) =>
                Math.max(
                  maximum,
                  Math.max(
                    0,
                    selectedAt.getTime() - (item.lastSyncedAt ?? item.createdAt).getTime(),
                  ),
                ),
              0,
            );
      log?.({
        durationMs: 0,
        eligibleAccountCount: allItems.length,
        event: "connector_sync_freshness_observed",
        ...(freshnessAgeMs === undefined ? {} : { freshnessAgeMs }),
        method: "SCHEDULER",
        path: "/internal/finances/freshness",
        provider: "plaid",
        requestId: randomUUID(),
        status: 200,
      });
      return result;
    },

    async syncDueItemsForUser(
      userId: string,
      scope: MaintenanceScope,
      context?: FinanceProviderItemSyncContext,
      onProgress?: FinanceSyncProgress,
    ): Promise<FinanceSyncBatchResult> {
      await preserveProgress(onProgress);
      const targetAccountId = await resolveScopeAccountId(userId, scope);
      const selected = await selectedDueItems(userId, targetAccountId);
      const selectedAt = now();
      return syncSelected(
        selected,
        (entry) =>
          context ?? {
            principal: {
              actorId: userId,
              actorType: "agent",
              scopes: new Set(["finances:read", "finances:write"]),
              userId,
            },
            requestId: `maintenance:finance:sync:${entry.item.id}:${selectedAt.toISOString()}`,
          },
        onProgress,
      );
    },
  };
}

export type FinanceProviderItemSyncService = ReturnType<
  typeof createFinanceProviderItemSyncService
>;
