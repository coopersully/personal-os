import { createHash } from "node:crypto";
import {
  accessTokens,
  auditEvents,
  type Database,
  financeAccounts,
  financeEvidenceRefreshRequests,
  financeProviderItems,
  financeTransactionCoverage,
  users,
} from "@personal-os/database";
import {
  type FinanceEvidenceRefresh,
  financeEvidenceRefreshSchema,
  prepareFinanceEvidenceRefreshInputSchema,
} from "@personal-os/domain";
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import { budgetPlanningDate } from "./budget-plan-projection.js";
import type { FinanceTransaction } from "./context.js";
import { guardFinanceExecutionTransaction } from "./execution-owner-guard.js";

type Context = { principal: Principal; requestId: string };
type Row = typeof financeEvidenceRefreshRequests.$inferSelect;
/** Refresh schedules existing read-only provider synchronization, never financial decisions. */
export function createFinanceEvidenceRefreshService({
  db,
  now,
}: {
  db: Database;
  now: () => Date;
}) {
  async function authorize(tx: Database | FinanceTransaction, context: Context, write: boolean) {
    const { principal } = context;
    const scopes = write
      ? ["finances:read", "finances:write", "finances:maintain"]
      : ["finances:read"];
    if (scopes.some((scope) => !principal.scopes.has(scope as "finances:read")))
      throw new AppError(
        "forbidden",
        "This operation requires the appropriate Finance permissions.",
      );
    if (principal.actorType === "agent") {
      const token = await tx.query.accessTokens.findFirst({
        where: and(
          eq(accessTokens.id, principal.actorId),
          eq(accessTokens.userId, principal.userId),
        ),
      });
      if (
        !token ||
        token.revokedAt ||
        (token.expiresAt && token.expiresAt <= now()) ||
        scopes.some((scope) => !token.scopes.includes(scope as "finances:read")) ||
        (principal.authorizationConnectionId &&
          token.authorizationConnectionId !== principal.authorizationConnectionId)
      )
        throw new AppError(
          "forbidden",
          "The connected agent's Finance access is no longer active.",
        );
    } else if (principal.actorId !== principal.userId)
      throw new AppError("forbidden", "Account ownership is required.");
  }
  async function observe(
    tx: Database | FinanceTransaction,
    row: Row,
  ): Promise<FinanceEvidenceRefresh> {
    const observedAt = now();
    const terminal = (
      reason: "authorization_revoked" | "refresh_timeout",
      status: "blocked" | "failed",
    ) =>
      financeEvidenceRefreshSchema.parse({
        id: row.id,
        period: row.period,
        requestedAt: row.requestedAt.toISOString(),
        observedAt: observedAt.toISOString(),
        status,
        sources: row.sources.map((ref) => ({
          accountId: ref.accountId,
          freshness: "blocked",
          coverage: "missing",
          reason,
        })),
      });
    if (row.actorType === "agent") {
      const token = await tx.query.accessTokens.findFirst({
        where: and(eq(accessTokens.id, row.actorId), eq(accessTokens.userId, row.userId)),
      });
      if (
        !token ||
        token.revokedAt ||
        (token.expiresAt && token.expiresAt <= observedAt) ||
        !["finances:read", "finances:write", "finances:maintain"].every((scope) =>
          token.scopes.includes(scope as "finances:read"),
        )
      )
        return terminal("authorization_revoked", "blocked");
    }
    if (observedAt.getTime() - row.requestedAt.getTime() > 86400000)
      return terminal("refresh_timeout", "failed");
    const today = budgetPlanningDate(observedAt, row.timezone);
    const from = `${row.period}-01`;
    const year = Number(row.period.slice(0, 4));
    const month = Number(row.period.slice(5));
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const through = end < today ? end : today;
    const sources: FinanceEvidenceRefresh["sources"] = [];
    for (const ref of row.sources) {
      const account = await tx.query.financeAccounts.findFirst({
        where: and(eq(financeAccounts.userId, row.userId), eq(financeAccounts.id, ref.accountId)),
      });
      const base = {
        accountId: ref.accountId,
        freshness: "blocked" as const,
        coverage: "missing" as const,
      };
      if (
        !account ||
        account.providerItemRecordId !== ref.itemId ||
        account.providerAccountId !== ref.providerAccountId
      ) {
        sources.push({ ...base, reason: "source_changed" });
        continue;
      }
      if (account.provider !== "plaid" || !ref.itemId) {
        sources.push({ ...base, reason: "manual_evidence_required" });
        continue;
      }
      const item = await tx.query.financeProviderItems.findFirst({
        where: and(
          eq(financeProviderItems.id, ref.itemId),
          eq(financeProviderItems.userId, row.userId),
        ),
      });
      if (
        !item ||
        account.status === "needs_reauth" ||
        item.syncState === "blocked" ||
        (item.lastSyncedAt && item.lastSyncedAt > observedAt)
      ) {
        sources.push({ ...base, reason: "source_unavailable" });
        continue;
      }
      if (
        item.syncState !== "current" ||
        !item.lastSyncedAt ||
        item.lastSyncedAt <= row.requestedAt
      ) {
        sources.push({ ...base, freshness: "pending", reason: "sync_pending" });
        continue;
      }
      const intervals = await tx
        .select()
        .from(financeTransactionCoverage)
        .where(
          and(
            eq(financeTransactionCoverage.userId, row.userId),
            eq(financeTransactionCoverage.accountId, ref.accountId),
            eq(financeTransactionCoverage.timezone, row.timezone),
            eq(financeTransactionCoverage.currencyCode, "USD"),
          ),
        );
      let covered = Date.parse(`${from}T00:00:00Z`) - 86_400_000;
      for (const interval of intervals.sort((a, b) => a.fromDate.localeCompare(b.fromDate))) {
        if (interval.recordedAt > now() || !interval.evidenceRef.trim()) continue;
        if (Date.parse(`${interval.fromDate}T00:00:00Z`) > covered + 86_400_000) break;
        covered = Math.max(covered, Date.parse(`${interval.throughDate}T00:00:00Z`));
      }
      const complete =
        account.currencyCode === "USD" &&
        through >= from &&
        covered >= Date.parse(`${through}T00:00:00Z`);
      sources.push({
        accountId: ref.accountId,
        freshness: "current",
        coverage: complete ? "complete" : "missing",
        reason: complete ? "none" : "coverage_missing",
      });
    }
    return financeEvidenceRefreshSchema.parse({
      id: row.id,
      period: row.period,
      requestedAt: row.requestedAt.toISOString(),
      observedAt: observedAt.toISOString(),
      sources,
      status: sources.some((source) => source.freshness === "pending")
        ? "accepted"
        : sources.every((source) => source.reason === "none")
          ? "completed"
          : "blocked",
    });
  }
  return {
    async prepareEvidenceRefresh(context: Context, raw: unknown) {
      const input = prepareFinanceEvidenceRefreshInputSchema.parse(raw);
      return db.transaction(async (tx) => {
        await guardFinanceExecutionTransaction(tx, context.principal.userId, {
          actorIds: context.principal.actorType === "agent" ? [context.principal.actorId] : [],
          connectionIds: context.principal.authorizationConnectionId
            ? [context.principal.authorizationConnectionId]
            : [],
        });
        await authorize(tx, context, true);
        const [owner] = await tx
          .select()
          .from(users)
          .where(eq(users.id, context.principal.userId))
          .limit(1);
        if (!owner) throw new AppError("not_found", "Account not found.");
        const fingerprint = createHash("sha256")
          .update(
            JSON.stringify({
              ...input,
              actorId: context.principal.actorId,
              actorType: context.principal.actorType,
            }),
          )
          .digest("hex");
        const existing = await tx.query.financeEvidenceRefreshRequests.findFirst({
          where: and(
            eq(financeEvidenceRefreshRequests.userId, owner.id),
            eq(financeEvidenceRefreshRequests.idempotencyKey, input.idempotencyKey),
          ),
        });
        if (existing) {
          if (existing.fingerprint !== fingerprint)
            throw new AppError("conflict", "The refresh key belongs to a different request.");
          return existing.result ?? observe(tx, existing);
        }
        let accounts = await tx
          .select()
          .from(financeAccounts)
          .where(
            and(
              eq(financeAccounts.userId, owner.id),
              inArray(
                financeAccounts.id,
                input.sourceRefs.map((ref) => ref.accountId),
              ),
            ),
          );
        const initialItems = [
          ...new Set(
            accounts.flatMap((account) =>
              account.providerItemRecordId ? [account.providerItemRecordId] : [],
            ),
          ),
        ].sort();
        // Provider synchronization locks Item before Account; preserve that order.
        if (initialItems.length)
          await tx
            .select({ id: financeProviderItems.id })
            .from(financeProviderItems)
            .where(
              and(
                eq(financeProviderItems.userId, owner.id),
                inArray(financeProviderItems.id, initialItems),
              ),
            )
            .orderBy(financeProviderItems.id)
            .for("update");
        accounts = await tx
          .select()
          .from(financeAccounts)
          .where(
            and(
              eq(financeAccounts.userId, owner.id),
              inArray(
                financeAccounts.id,
                input.sourceRefs.map((ref) => ref.accountId),
              ),
            ),
          )
          .orderBy(financeAccounts.id)
          .for("share");
        if (
          accounts.some(
            (account) =>
              account.providerItemRecordId && !initialItems.includes(account.providerItemRecordId),
          )
        )
          throw new AppError(
            "conflict",
            "An account connection changed; refresh its evidence first.",
          );
        if (accounts.length !== input.sourceRefs.length)
          throw new AppError("not_found", "A requested account was not found.");
        const sources = input.sourceRefs.map((ref) => {
          const account = accounts.find((account) => account.id === ref.accountId);
          if (!account || account.contextualRevision.toString() !== ref.expectedAccountRevision)
            throw new AppError("conflict", "An account changed; refresh its evidence first.");
          return {
            accountId: account.id,
            accountRevision: ref.expectedAccountRevision,
            itemId: account.providerItemRecordId,
            providerAccountId: account.providerAccountId,
          };
        });
        const [row] = await tx
          .insert(financeEvidenceRefreshRequests)
          .values({
            userId: owner.id,
            actorId: context.principal.actorId,
            actorType: context.principal.actorType,
            idempotencyKey: input.idempotencyKey,
            fingerprint,
            period: input.period,
            timezone: owner.planningTimezone,
            sources,
            requestedAt: now(),
            nextObservationAt: now(),
          })
          .returning();
        if (!row) throw new AppError("internal_error", "The evidence refresh was not saved.");
        await tx.insert(auditEvents).values(
          auditValues({
            action: "finance.evidence_refresh.requested",
            entityType: "finance_evidence_refresh",
            entityId: row.id,
            principal: context.principal,
            requestId: context.requestId,
            before: null,
            after: { period: row.period, sources: row.sources },
          }),
        );
        const itemIds = [
          ...new Set(sources.flatMap((source) => (source.itemId ? [source.itemId] : []))),
        ];
        if (itemIds.length)
          await tx
            .update(financeProviderItems)
            .set({ nextSyncAt: now() })
            .where(
              and(
                eq(financeProviderItems.userId, owner.id),
                inArray(financeProviderItems.id, itemIds),
                inArray(financeProviderItems.syncState, ["current", "stale"]),
              ),
            );
        const result = await observe(tx, row);
        if (result.status !== "accepted")
          await tx
            .update(financeEvidenceRefreshRequests)
            .set({ result })
            .where(eq(financeEvidenceRefreshRequests.id, row.id));
        return result;
      });
    },
    async getEvidenceRefresh(context: Context, id: string) {
      await authorize(db, context, false);
      const row = await db.query.financeEvidenceRefreshRequests.findFirst({
        where: and(
          eq(financeEvidenceRefreshRequests.id, id),
          eq(financeEvidenceRefreshRequests.userId, context.principal.userId),
        ),
      });
      if (!row) throw new AppError("not_found", "Evidence refresh not found.");
      return row.result ?? observe(db, row);
    },
    async reconcilePending() {
      return db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(financeEvidenceRefreshRequests)
          .where(
            and(
              isNull(financeEvidenceRefreshRequests.result),
              lte(financeEvidenceRefreshRequests.nextObservationAt, now()),
            ),
          )
          .orderBy(
            financeEvidenceRefreshRequests.nextObservationAt,
            financeEvidenceRefreshRequests.id,
          )
          .limit(25)
          .for("update", { skipLocked: true });
        for (const row of rows) {
          const result = await observe(tx, row);
          await tx
            .update(financeEvidenceRefreshRequests)
            .set({
              result: result.status === "accepted" ? null : result,
              nextObservationAt: new Date(now().getTime() + 60_000),
            })
            .where(eq(financeEvidenceRefreshRequests.id, row.id));
        }
        return { inspected: rows.length };
      });
    },
  };
}
