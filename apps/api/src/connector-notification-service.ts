import { randomUUID } from "node:crypto";
import {
  calendarAccounts,
  type Database,
  connectorSyncTriggers,
} from "@personal-os/database";
import type { ConnectorSyncTriggerReason } from "@personal-os/domain";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";

const TRIGGER_CLAIM_LEASE_MS = 5 * 60_000;

export type ClaimedConnectorTrigger = {
  accountId: string;
  claimId: string;
  notificationCount: number;
  observedAt: Date;
  reason: ConnectorSyncTriggerReason;
};

type Options = {
  db: Database;
  now: () => Date;
};
type NotificationDatabase = Pick<Database, "insert">;

const reasonRank = (value: ReturnType<typeof sql.raw>) => sql`CASE ${value}
  WHEN 'notification' THEN 6
  WHEN 'initial' THEN 5
  WHEN 'manual' THEN 4
  WHEN 'recovery' THEN 3
  WHEN 'retry' THEN 2
  ELSE 1
END`;

export function createConnectorNotificationService({ db, now }: Options) {
  return {
    async claimDueTriggers(
      options: { limit?: number } = {},
    ): Promise<ClaimedConnectorTrigger[]> {
      const claimedAt = now();
      const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
      return db.transaction(async (transaction) => {
        const available = await transaction
          .select()
          .from(connectorSyncTriggers)
          .where(
            and(
              lte(connectorSyncTriggers.availableAt, claimedAt),
              or(
                isNull(connectorSyncTriggers.claimId),
                lte(connectorSyncTriggers.claimExpiresAt, claimedAt),
              ),
            ),
          )
          .orderBy(asc(connectorSyncTriggers.availableAt))
          .limit(limit)
          .for("update", { skipLocked: true });
        const claims: ClaimedConnectorTrigger[] = [];
        for (const trigger of available) {
          const claimId = randomUUID();
          const [claimed] = await transaction
            .update(connectorSyncTriggers)
            .set({
              claimExpiresAt: new Date(claimedAt.getTime() + TRIGGER_CLAIM_LEASE_MS),
              claimId,
              updatedAt: claimedAt,
            })
            .where(eq(connectorSyncTriggers.accountId, trigger.accountId))
            .returning();
          if (claimed) {
            claims.push({
              accountId: claimed.accountId,
              claimId,
              notificationCount: claimed.notificationCount,
              observedAt: claimed.lastTriggeredAt,
              reason: claimed.reason,
            });
          }
        }
        return claims;
      });
    },

    async completeTrigger(claim: ClaimedConnectorTrigger): Promise<void> {
      const removed = await db
        .delete(connectorSyncTriggers)
        .where(
          and(
            eq(connectorSyncTriggers.accountId, claim.accountId),
            eq(connectorSyncTriggers.claimId, claim.claimId),
            lte(connectorSyncTriggers.lastTriggeredAt, claim.observedAt),
          ),
        )
        .returning({ accountId: connectorSyncTriggers.accountId });
      if (removed.length > 0) return;
      await db
        .update(connectorSyncTriggers)
        .set({
          availableAt: now(),
          claimExpiresAt: null,
          claimId: null,
          updatedAt: now(),
        })
        .where(
          and(
            eq(connectorSyncTriggers.accountId, claim.accountId),
            eq(connectorSyncTriggers.claimId, claim.claimId),
          ),
        );
    },

    async dispatchTriggeredSyncs(
      syncAccount: (userId: string, accountId: string) => Promise<unknown>,
      options: { concurrency?: number; limit?: number } = {},
    ): Promise<{ attempted: number; failed: number; succeeded: number }> {
      const claims = await this.claimDueTriggers(
        options.limit === undefined ? {} : { limit: options.limit },
      );
      const result = { attempted: claims.length, failed: 0, succeeded: 0 };
      const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 10));
      let cursor = 0;
      const worker = async () => {
        while (cursor < claims.length) {
          const claim = claims[cursor];
          cursor += 1;
          if (!claim) continue;
          const [account] = await db
            .select({
              syncRecovery: calendarAccounts.syncRecovery,
              userId: calendarAccounts.userId,
            })
            .from(calendarAccounts)
            .where(eq(calendarAccounts.id, claim.accountId))
            .limit(1);
          if (!account || account.syncRecovery === "reconnect") {
            await this.completeTrigger(claim);
            continue;
          }
          try {
            await syncAccount(account.userId, claim.accountId);
            await this.completeTrigger(claim);
            result.succeeded += 1;
          } catch {
            await this.releaseTrigger(claim, new Date(now().getTime() + 60_000));
            result.failed += 1;
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, claims.length) }, async () => worker()),
      );
      return result;
    },

    async enqueue(
      accountId: string,
      reason: ConnectorSyncTriggerReason,
      at: Date = now(),
      executor: NotificationDatabase = db,
    ): Promise<void> {
      const currentReason = sql.raw('"connector_sync_triggers"."reason"');
      const incomingReason = sql.raw('excluded."reason"');
      await executor
        .insert(connectorSyncTriggers)
        .values({
          accountId,
          availableAt: at,
          firstTriggeredAt: at,
          lastTriggeredAt: at,
          reason,
        })
        .onConflictDoUpdate({
          set: {
            availableAt: sql`LEAST(${connectorSyncTriggers.availableAt}, excluded."available_at")`,
            firstTriggeredAt: sql`LEAST(${connectorSyncTriggers.firstTriggeredAt}, excluded."first_triggered_at")`,
            lastTriggeredAt: sql`GREATEST(${connectorSyncTriggers.lastTriggeredAt}, excluded."last_triggered_at")`,
            notificationCount: sql`LEAST(1000000, ${connectorSyncTriggers.notificationCount} + 1)`,
            reason: sql`CASE WHEN ${reasonRank(incomingReason)} > ${reasonRank(currentReason)} THEN excluded."reason" ELSE ${connectorSyncTriggers.reason} END`,
            updatedAt: at,
          },
          target: connectorSyncTriggers.accountId,
        });
    },

    async releaseTrigger(claim: ClaimedConnectorTrigger, availableAt: Date): Promise<void> {
      await db
        .update(connectorSyncTriggers)
        .set({ claimExpiresAt: null, claimId: null, availableAt, updatedAt: now() })
        .where(
          and(
            eq(connectorSyncTriggers.accountId, claim.accountId),
            eq(connectorSyncTriggers.claimId, claim.claimId),
          ),
        );
    },
  };
}
