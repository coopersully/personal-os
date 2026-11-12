import { resolve } from "node:path";
import {
  accessTokens,
  createDatabaseClient,
  financeAccounts,
  financeProviderItems,
  financeTransactionCoverage,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { encryptJson } from "../security.js";
import type { Principal } from "../types.js";
import { createFinanceEvidenceRefreshService } from "./evidence-refresh-service.js";

describe.sequential("durable Finance evidence refresh", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabaseClient>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve("packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  async function fixture() {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Refresh fixture",
        email: `${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
      })
      .returning();
    if (!owner) throw new Error("Missing owner");
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        userId: owner.id,
        name: "Manual cash",
        institution: "Synthetic",
        provider: "manual",
        status: "manual",
      })
      .returning();
    if (!account) throw new Error("Missing account");
    const principal: Principal = {
      actorType: "user",
      actorId: owner.id,
      userId: owner.id,
      scopes: new Set(["finances:read", "finances:write", "finances:maintain"]),
    };
    return {
      context: { principal, requestId: crypto.randomUUID() },
      account,
      input: {
        sourceRefs: [
          { accountId: account.id, expectedAccountRevision: account.contextualRevision.toString() },
        ],
        period: "2026-11",
        idempotencyKey: crypto.randomUUID(),
      },
    };
  }
  let clock = new Date("2026-11-12T16:00:00Z");
  beforeEach(() => {
    clock = new Date("2026-11-12T16:00:00Z");
  });
  const service = () => createFinanceEvidenceRefreshService({ db: database.db, now: () => clock });
  async function connected() {
    const f = await fixture();
    const [item] = await database.db
      .insert(financeProviderItems)
      .values({
        userId: f.context.principal.userId,
        provider: "plaid",
        providerItemId: crypto.randomUUID(),
        encryptedCredentials: encryptJson(
          { accessToken: "synthetic" },
          Buffer.alloc(32, 13).toString("base64"),
        ),
        syncState: "stale",
        nextSyncAt: new Date("2026-11-13T00:00:00Z"),
      })
      .returning();
    if (!item) throw new Error("Missing item");
    const [account] = await database.db
      .update(financeAccounts)
      .set({
        provider: "plaid",
        providerItemRecordId: item.id,
        providerAccountId: crypto.randomUUID(),
        status: "connected",
        currencyCode: "USD",
      })
      .where(eq(financeAccounts.id, f.account.id))
      .returning();
    if (!account) throw new Error("Missing account");
    return {
      ...f,
      item,
      account,
      input: {
        ...f.input,
        sourceRefs: [
          { accountId: account.id, expectedAccountRevision: account.contextualRevision.toString() },
        ],
      },
    };
  }
  it("persists refresh intent across service restart and does not equate sync with coverage", async () => {
    const f = await connected();
    const request = await service().prepareEvidenceRefresh(f.context, f.input);
    expect(request.status).toBe("accepted");
    const item = await database.db.query.financeProviderItems.findFirst({
      where: eq(financeProviderItems.id, f.item.id),
    });
    expect(item?.nextSyncAt).toEqual(clock);
    clock = new Date("2026-11-12T16:01:00Z");
    await database.db
      .update(financeProviderItems)
      .set({ syncState: "current", lastSyncedAt: clock })
      .where(eq(financeProviderItems.id, f.item.id));
    await service().reconcilePending();
    expect(await service().getEvidenceRefresh(f.context, request.id)).toMatchObject({
      status: "blocked",
      sources: [{ freshness: "current", coverage: "missing", reason: "coverage_missing" }],
    });
  });
  it("finishes only after fresh sync and complete owner-local coverage", async () => {
    const f = await connected();
    const request = await service().prepareEvidenceRefresh(f.context, f.input);
    clock = new Date("2026-11-12T16:01:00Z");
    await database.db
      .update(financeProviderItems)
      .set({ syncState: "current", lastSyncedAt: clock })
      .where(eq(financeProviderItems.id, f.item.id));
    const owner = await database.db.query.users.findFirst({
      where: eq(users.id, f.context.principal.userId),
    });
    if (!owner) throw new Error("Missing owner");
    await database.db.insert(financeTransactionCoverage).values({
      userId: f.context.principal.userId,
      accountId: f.account.id,
      fromDate: "2026-11-01",
      throughDate: "2026-11-12",
      timezone: owner.planningTimezone,
      currencyCode: "USD",
      evidenceRef: "synthetic-complete-source",
      recordedAt: clock,
    });
    await service().reconcilePending();
    expect(await service().getEvidenceRefresh(f.context, request.id)).toMatchObject({
      status: "completed",
      sources: [{ freshness: "current", coverage: "complete", reason: "none" }],
    });
  });
  it("preserves provider retry backoff and reports reconnect instead of resetting it", async () => {
    const f = await connected();
    const retry = new Date("2026-11-12T17:00:00Z");
    await database.db
      .update(financeProviderItems)
      .set({
        syncState: "retrying",
        nextSyncAt: retry,
        syncFailureCount: 1,
        syncError: "Synthetic timeout",
        syncErrorCode: "timeout",
        syncErrorCategory: "transport",
        syncRecovery: "automatic",
      })
      .where(eq(financeProviderItems.id, f.item.id));
    const request = await service().prepareEvidenceRefresh(f.context, f.input);
    expect(
      (
        await database.db.query.financeProviderItems.findFirst({
          where: eq(financeProviderItems.id, f.item.id),
        })
      )?.nextSyncAt,
    ).toEqual(retry);
    await database.db
      .update(financeAccounts)
      .set({ status: "needs_reauth" })
      .where(eq(financeAccounts.id, f.account.id));
    await service().reconcilePending();
    expect(await service().getEvidenceRefresh(f.context, request.id)).toMatchObject({
      status: "blocked",
      sources: [{ reason: "source_unavailable" }],
    });
  });
  it("rejects future synchronization timestamps instead of certifying freshness", async () => {
    const f = await connected();
    const request = await service().prepareEvidenceRefresh(f.context, f.input);
    await database.db
      .update(financeProviderItems)
      .set({ syncState: "current", lastSyncedAt: new Date("2026-11-13T16:00:00Z") })
      .where(eq(financeProviderItems.id, f.item.id));
    expect(await service().getEvidenceRefresh(f.context, request.id)).toMatchObject({
      status: "blocked",
      sources: [{ freshness: "blocked", reason: "source_unavailable" }],
    });
  });
  it("stops a pending request when the originating agent is revoked", async () => {
    const f = await connected();
    const [token] = await database.db
      .insert(accessTokens)
      .values({
        userId: f.context.principal.userId,
        name: "Synthetic refresh agent",
        tokenHash: crypto.randomUUID(),
        scopes: ["finances:read", "finances:write", "finances:maintain"],
      })
      .returning();
    if (!token) throw new Error("Missing token");
    const context = {
      ...f.context,
      principal: {
        ...f.context.principal,
        actorType: "agent" as const,
        actorId: token.id,
        authorizationConnectionId: token.authorizationConnectionId,
      },
    };
    const request = await service().prepareEvidenceRefresh(context, f.input);
    await database.db
      .update(accessTokens)
      .set({ revokedAt: clock })
      .where(eq(accessTokens.id, token.id));
    await service().reconcilePending();
    expect(await service().getEvidenceRefresh(f.context, request.id)).toMatchObject({
      status: "blocked",
      sources: [{ reason: "authorization_revoked" }],
    });
  });
  it("finishes timed-out recovery with an honest retryable failure instead of waiting forever", async () => {
    const f = await connected();
    const request = await service().prepareEvidenceRefresh(f.context, f.input);
    clock = new Date("2026-11-13T16:01:00Z");
    await service().reconcilePending();
    expect(await service().getEvidenceRefresh(f.context, request.id)).toMatchObject({
      status: "failed",
      sources: [{ reason: "refresh_timeout" }],
    });
  });
  it("persists a recoverable request without pretending a manual account was synced", async () => {
    const f = await fixture();
    const result = await service().prepareEvidenceRefresh(f.context, f.input);
    expect(result).toMatchObject({
      status: "blocked",
      sources: [
        { accountId: f.account.id, reason: "manual_evidence_required", coverage: "missing" },
      ],
    });
    expect(await service().getEvidenceRefresh(f.context, result.id)).toEqual(result);
    expect(await service().prepareEvidenceRefresh(f.context, f.input)).toEqual(result);
  });
  it("rejects changed requests, wrong revisions, other owners and missing authority", async () => {
    const f = await fixture();
    const other = await fixture();
    const first = await service().prepareEvidenceRefresh(f.context, f.input);
    await expect(
      service().prepareEvidenceRefresh(f.context, { ...f.input, period: "2026-10" }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service().prepareEvidenceRefresh(f.context, {
        ...f.input,
        idempotencyKey: crypto.randomUUID(),
        sourceRefs: [{ accountId: f.account.id, expectedAccountRevision: "999" }],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(service().getEvidenceRefresh(other.context, first.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      service().prepareEvidenceRefresh(
        { ...f.context, principal: { ...f.context.principal, scopes: new Set(["finances:read"]) } },
        f.input,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
