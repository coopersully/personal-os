import type { PlaidAccountSnapshot } from "@personal-os/connectors";
import {
  auditEvents,
  type Database,
  type EncryptedCredentials,
  financeAccounts,
  financeProviderItems,
} from "@personal-os/database";
import type { FinanceAccount } from "@personal-os/domain";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { AppError } from "./errors.js";
import { decryptJson, encryptJson } from "./security.js";
import type { Principal } from "./types.js";

type MutationContext = {
  principal: Principal;
  requestId: string;
};

type Options = {
  db: Database;
  encryptionKey?: string;
  now: () => Date;
};

type UpsertConnectionInput = {
  accessToken: string;
  accounts: PlaidAccountSnapshot[];
  context: MutationContext;
  institution: string;
  itemId: string;
  prepareTransaction?: (executor: Pick<Database, "insert" | "select">) => Promise<void>;
};

export type FinanceProviderItemBackfillResult = {
  blocked: number;
  complete: boolean;
  created: number;
  linked: number;
  replayDue: number;
};

type LegacyGroupCandidate = {
  groupSize: number;
  legacyGroupingKey: string;
  provider: string;
  representativeId: string;
  userId: string;
};

const backfillRequestId = "finance-provider-item-backfill";
const blockedReasons = {
  credentialInvalid: {
    code: "finance_provider_item_legacy_credential_invalid",
    message: "Legacy Plaid credentials could not be validated.",
  },
  credentialMismatch: {
    code: "finance_provider_item_legacy_credential_mismatch",
    message: "Legacy Plaid credentials conflict within this connection.",
  },
  ownershipMismatch: {
    code: "finance_provider_item_legacy_ownership_mismatch",
    message: "Legacy Plaid connection ownership is inconsistent.",
  },
  providerMismatch: {
    code: "finance_provider_item_legacy_provider_mismatch",
    message: "Legacy Plaid connection provider identity is inconsistent.",
  },
} as const;

function serializeAccount(row: typeof financeAccounts.$inferSelect): FinanceAccount {
  return {
    balance: row.balance === null ? null : row.balance / 100,
    createdAt: row.createdAt.toISOString(),
    currencyCode: row.currencyCode,
    id: row.id,
    institution: row.institution,
    kind: row.kind,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    name: row.name,
    provider: row.provider,
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

function accountAuditSnapshot(row: typeof financeAccounts.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    provider: row.provider,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validatedAccessToken(value: unknown): string | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("accessToken" in value) ||
    typeof value.accessToken !== "string" ||
    value.accessToken.length === 0
  ) {
    return null;
  }
  return value.accessToken;
}

export function createFinanceProviderItemService({ db, encryptionKey, now }: Options) {
  function getEncryptionKey(): string {
    if (!encryptionKey) {
      throw new AppError("service_unavailable", "Finance credential encryption is not configured.");
    }
    return encryptionKey;
  }

  return {
    async upsertConnection(input: UpsertConnectionInput): Promise<FinanceAccount[]> {
      const connectedAt = now();
      const encryptedCredentials = encryptJson(
        { accessToken: input.accessToken },
        getEncryptionKey(),
      );
      const rows = await db.transaction(async (tx) => {
        await input.prepareTransaction?.(tx);
        const [item] = await tx
          .insert(financeProviderItems)
          .values({
            encryptedCredentials,
            lastSyncedAt: null,
            nextSyncAt: connectedAt,
            provider: "plaid",
            providerItemId: input.itemId,
            syncCursor: null,
            syncState: "stale",
            userId: input.context.principal.userId,
          })
          .onConflictDoUpdate({
            set: {
              encryptedCredentials,
              lastSyncAttemptAt: null,
              lastSyncedAt: null,
              nextSyncAt: connectedAt,
              syncClaimExpiresAt: null,
              syncClaimGeneration: null,
              syncClaimId: null,
              syncClaimOwner: null,
              syncClaimStartedAt: null,
              syncCursor: null,
              syncError: null,
              syncErrorCategory: null,
              syncErrorCode: null,
              syncFailureCount: 0,
              syncRecovery: null,
              syncState: "stale",
              updatedAt: connectedAt,
            },
            target: [
              financeProviderItems.userId,
              financeProviderItems.provider,
              financeProviderItems.providerItemId,
            ],
            targetWhere: isNotNull(financeProviderItems.providerItemId),
          })
          .returning();
        if (!item) throw new AppError("internal_error", "The Plaid Item could not be saved.");

        if (input.accounts.length > 0) {
          await tx
            .select({ id: financeAccounts.id })
            .from(financeAccounts)
            .where(
              and(
                eq(financeAccounts.userId, input.context.principal.userId),
                eq(financeAccounts.provider, "plaid"),
                inArray(
                  financeAccounts.providerAccountId,
                  input.accounts.map((account) => account.accountId),
                ),
              ),
            )
            .orderBy(financeAccounts.id)
            .for("update");
        }

        const saved: Array<typeof financeAccounts.$inferSelect> = [];
        for (const remote of input.accounts) {
          const [account] = await tx
            .insert(financeAccounts)
            .values({
              balance:
                remote.balanceCurrent === null ? null : Math.round(remote.balanceCurrent * 100),
              currencyCode: remote.currencyCode,
              encryptedCredentials,
              institution: input.institution,
              lastSyncedAt: null,
              name: remote.officialName ?? remote.name,
              nextSyncAt: connectedAt,
              provider: "plaid",
              providerAccountId: remote.accountId,
              providerItemId: input.itemId,
              providerItemRecordId: item.id,
              status: "connected",
              syncCursor: null,
              syncState: "stale",
              userId: input.context.principal.userId,
            })
            .onConflictDoUpdate({
              set: {
                balance:
                  remote.balanceCurrent === null ? null : Math.round(remote.balanceCurrent * 100),
                currencyCode: remote.currencyCode,
                encryptedCredentials,
                institution: input.institution,
                lastSyncAttemptAt: null,
                lastSyncedAt: null,
                name: remote.officialName ?? remote.name,
                nextSyncAt: connectedAt,
                providerItemId: input.itemId,
                providerItemRecordId: item.id,
                status: "connected",
                syncClaimExpiresAt: null,
                syncClaimId: null,
                syncCursor: null,
                syncError: null,
                syncErrorCategory: null,
                syncErrorCode: null,
                syncFailureCount: 0,
                syncRecovery: null,
                syncState: "stale",
                updatedAt: connectedAt,
              },
              target: [
                financeAccounts.userId,
                financeAccounts.provider,
                financeAccounts.providerAccountId,
              ],
            })
            .returning();
          if (!account)
            throw new AppError("internal_error", "The Plaid account could not be saved.");
          saved.push(account);
          await tx.insert(auditEvents).values(
            auditValues({
              action: "finance.plaid_connected",
              after: accountAuditSnapshot(account),
              before: null,
              entityId: account.id,
              entityType: "finance_account",
              ...input.context,
            }),
          );
        }
        return saved;
      });
      return rows.map(serializeAccount);
    },

    async backfillLegacyItems(limit = 100): Promise<FinanceProviderItemBackfillResult> {
      if (!Number.isInteger(limit) || limit < 1) {
        throw new AppError("invalid_request", "The Provider Item backfill limit must be positive.");
      }
      const boundedLimit = Math.min(limit, 100);
      const result = await db.transaction(async (tx) => {
        const claimed = await tx.execute<LegacyGroupCandidate>(sql`
          WITH legacy_groups AS MATERIALIZED (
            SELECT
              account.user_id,
              account.provider,
              account.provider_item_id AS legacy_grouping_key,
              min(account.id::text)::uuid AS representative_id,
              count(*)::int AS group_size
            FROM finance_accounts account
            WHERE account.provider_item_record_id IS NULL
              AND account.provider = 'plaid'
              AND account.provider_item_id IS NOT NULL
            GROUP BY account.user_id, account.provider, account.provider_item_id
          )
          SELECT
            legacy_groups.user_id AS "userId",
            legacy_groups.provider,
            legacy_groups.legacy_grouping_key AS "legacyGroupingKey",
            legacy_groups.representative_id AS "representativeId",
            legacy_groups.group_size AS "groupSize"
          FROM legacy_groups
          INNER JOIN finance_accounts representative
            ON representative.id = legacy_groups.representative_id
          ORDER BY legacy_groups.user_id, legacy_groups.legacy_grouping_key,
            legacy_groups.representative_id
          FOR UPDATE OF representative SKIP LOCKED
          LIMIT ${boundedLimit + 1}
        `);
        let blocked = 0;
        let created = 0;
        let linked = 0;
        let replayDue = 0;
        let processedGroups = 0;

        for (const candidate of claimed.rows) {
          if (processedGroups >= boundedLimit) break;
          const ownedRows = await tx
            .select()
            .from(financeAccounts)
            .where(
              and(
                eq(financeAccounts.userId, candidate.userId),
                eq(financeAccounts.provider, "plaid"),
                eq(financeAccounts.providerItemId, candidate.legacyGroupingKey),
                isNull(financeAccounts.providerItemRecordId),
              ),
            )
            .orderBy(asc(financeAccounts.id))
            .for("update", { skipLocked: true });
          if (ownedRows.length !== candidate.groupSize) continue;

          const relatedRows = await tx
            .select({ provider: financeAccounts.provider, userId: financeAccounts.userId })
            .from(financeAccounts)
            .where(eq(financeAccounts.providerItemId, candidate.legacyGroupingKey));
          let blockedReason: (typeof blockedReasons)[keyof typeof blockedReasons] | undefined;
          if (relatedRows.some((row) => row.userId !== candidate.userId)) {
            blockedReason = blockedReasons.ownershipMismatch;
          } else if (relatedRows.some((row) => row.provider !== "plaid")) {
            blockedReason = blockedReasons.providerMismatch;
          }

          let accessToken: string | null = null;
          if (!blockedReason) {
            const accessTokens: string[] = [];
            try {
              for (const row of ownedRows) {
                if (!row.encryptedCredentials) throw new Error("missing credentials");
                const decrypted = decryptJson<unknown>(
                  row.encryptedCredentials,
                  getEncryptionKey(),
                );
                const token = validatedAccessToken(decrypted);
                if (!token) throw new Error("invalid credentials");
                accessTokens.push(token);
              }
            } catch {
              blockedReason = blockedReasons.credentialInvalid;
            }
            if (!blockedReason) {
              accessToken = accessTokens[0] ?? null;
              if (!accessToken || accessTokens.some((token) => token !== accessToken)) {
                blockedReason = blockedReasons.credentialMismatch;
              }
            }
          }

          const cursors = ownedRows.map((row) => row.syncCursor);
          const preservedCursor =
            cursors.length > 0 &&
            cursors.every((cursor): cursor is string => cursor !== null) &&
            cursors.every((cursor) => cursor === cursors[0])
              ? (cursors[0] ?? null)
              : null;
          let needsReplay = !blockedReason && preservedCursor === null;
          const sourceCredential = ownedRows.find(
            (row) => row.encryptedCredentials !== null,
          )?.encryptedCredentials;
          const credentials: EncryptedCredentials =
            blockedReason === blockedReasons.credentialInvalid || !sourceCredential
              ? encryptJson({ accessToken: "" }, getEncryptionKey())
              : blockedReason || !accessToken
                ? sourceCredential
                : encryptJson({ accessToken }, getEncryptionKey());
          const [inserted] = await tx
            .insert(financeProviderItems)
            .values({
              encryptedCredentials: credentials,
              legacyGroupingKey: candidate.legacyGroupingKey,
              nextSyncAt: blockedReason ? null : now(),
              provider: "plaid",
              providerItemId: null,
              syncCursor: blockedReason ? null : preservedCursor,
              syncError: blockedReason?.message ?? null,
              syncErrorCategory: blockedReason ? "configuration" : null,
              syncErrorCode: blockedReason?.code ?? null,
              syncFailureCount: blockedReason ? 1 : 0,
              syncRecovery: blockedReason ? "operator" : null,
              syncState: blockedReason ? "blocked" : "stale",
              userId: candidate.userId,
            })
            .onConflictDoNothing()
            .returning();
          const [item] = inserted
            ? [inserted]
            : await tx
                .select()
                .from(financeProviderItems)
                .where(
                  and(
                    eq(financeProviderItems.userId, candidate.userId),
                    eq(financeProviderItems.provider, "plaid"),
                    eq(financeProviderItems.legacyGroupingKey, candidate.legacyGroupingKey),
                  ),
                )
                .limit(1)
                .for("update");
          if (!item)
            throw new AppError("internal_error", "The legacy Plaid Item could not be saved.");

          let authoritativeItem = item;
          if (!inserted) {
            if (!blockedReason) {
              try {
                const itemCredentials = decryptJson<unknown>(
                  item.encryptedCredentials,
                  getEncryptionKey(),
                );
                const itemAccessToken = validatedAccessToken(itemCredentials);
                if (!itemAccessToken) {
                  blockedReason = blockedReasons.credentialInvalid;
                } else if (itemAccessToken !== accessToken) {
                  blockedReason = blockedReasons.credentialMismatch;
                }
              } catch {
                blockedReason = blockedReasons.credentialInvalid;
              }
            }

            if (blockedReason) {
              if (
                item.syncState === "blocked" &&
                item.syncErrorCode === blockedReason.code &&
                item.syncCursor === null &&
                item.nextSyncAt === null
              ) {
                blocked += 1;
                processedGroups += 1;
                continue;
              }
              const [blockedItem] = await tx
                .update(financeProviderItems)
                .set({
                  nextSyncAt: null,
                  syncCursor: null,
                  syncError: blockedReason.message,
                  syncErrorCategory: "configuration",
                  syncErrorCode: blockedReason.code,
                  syncFailureCount: Math.max(1, item.syncFailureCount + 1),
                  syncRecovery: "operator",
                  syncState: "blocked",
                  updatedAt: now(),
                })
                .where(eq(financeProviderItems.id, item.id))
                .returning();
              if (!blockedItem)
                throw new AppError("internal_error", "The legacy Plaid Item could not be blocked.");
              authoritativeItem = blockedItem;
              needsReplay = false;
            } else if (item.syncState === "blocked") {
              blocked += 1;
              processedGroups += 1;
              continue;
            } else {
              needsReplay =
                item.syncCursor === null ||
                ownedRows.some(
                  (row) => row.syncCursor === null || row.syncCursor !== item.syncCursor,
                );
              if (needsReplay) {
                const [replayItem] = await tx
                  .update(financeProviderItems)
                  .set({
                    nextSyncAt: now(),
                    syncCursor: null,
                    syncError: null,
                    syncErrorCategory: null,
                    syncErrorCode: null,
                    syncFailureCount: 0,
                    syncRecovery: null,
                    syncState: "stale",
                    updatedAt: now(),
                  })
                  .where(eq(financeProviderItems.id, item.id))
                  .returning();
                if (!replayItem)
                  throw new AppError(
                    "internal_error",
                    "The legacy Plaid Item replay could not be scheduled.",
                  );
                authoritativeItem = replayItem;
              }
            }
          }

          const shouldLink = Boolean(inserted) || !blockedReason;
          const linkedRows = shouldLink
            ? await tx
                .update(financeAccounts)
                .set({ providerItemRecordId: authoritativeItem.id, updatedAt: now() })
                .where(
                  and(
                    inArray(
                      financeAccounts.id,
                      ownedRows.map((row) => row.id),
                    ),
                    isNull(financeAccounts.providerItemRecordId),
                  ),
                )
                .returning({ id: financeAccounts.id })
            : [];
          if (shouldLink && linkedRows.length !== ownedRows.length) {
            throw new AppError("conflict", "The legacy Plaid account group changed while linking.");
          }
          if (inserted) created += 1;
          processedGroups += 1;
          linked += linkedRows.length;
          if (blockedReason) blocked += 1;
          if (needsReplay) replayDue += 1;
          await tx.insert(auditEvents).values({
            action: blockedReason
              ? "finance.provider_item_backfill_blocked"
              : "finance.provider_item_backfilled",
            actorId: candidate.userId,
            actorType: "system",
            after: {
              accountCount: linkedRows.length,
              provider: "plaid",
              ...(blockedReason ? { failureCode: blockedReason.code } : {}),
              replayDue: needsReplay,
            },
            before: null,
            entityId: authoritativeItem.id,
            entityType: "finance_provider_item",
            requestId: backfillRequestId,
            userId: candidate.userId,
          });
        }
        return { blocked, created, linked, replayDue };
      });
      const [outstanding] = await db
        .select({ id: financeAccounts.id })
        .from(financeAccounts)
        .where(
          and(
            eq(financeAccounts.provider, "plaid"),
            isNotNull(financeAccounts.providerItemId),
            isNull(financeAccounts.providerItemRecordId),
          ),
        )
        .limit(1);
      return { ...result, complete: !outstanding };
    },

    async resolveItemForAccount(userId: string, accountId: string) {
      const [item] = await db
        .select({ item: financeProviderItems })
        .from(financeAccounts)
        .innerJoin(
          financeProviderItems,
          eq(financeProviderItems.id, financeAccounts.providerItemRecordId),
        )
        .where(
          and(
            eq(financeAccounts.id, accountId),
            eq(financeAccounts.userId, userId),
            eq(financeProviderItems.userId, userId),
            eq(financeProviderItems.provider, "plaid"),
          ),
        )
        .limit(1);
      if (!item) {
        throw new AppError("not_found", "Finance account does not have an owned Provider Item.");
      }
      return item.item;
    },
  };
}
