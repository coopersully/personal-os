import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type Database,
  type DatabaseClient,
  migrateDatabase,
  oauthStates,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createConnectorAuthorizationService } from "./connector-authorization-service.js";
import { decryptJson, hashToken } from "./security.js";

const encryptionKey = Buffer.alloc(32, 19).toString("base64");
const initialNow = new Date("2026-08-06T12:00:00.000Z");

function scriptedAuthorizationDatabase(options: {
  selects?: unknown[][];
  updates?: unknown[][];
}): Database {
  const selects = [...(options.selects ?? [])];
  const updates = [...(options.updates ?? [])];
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selects.shift() ?? [],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => updates.shift() ?? [],
        }),
      }),
    }),
  } as unknown as Database;
}

describe.sequential("connector authorization attempt service", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let now = initialNow;
  let ownerId: string;
  let otherUserId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    const created = await database.db
      .insert(users)
      .values([
        {
          displayName: "Authorization owner",
          email: "authorization-owner@example.com",
          passwordHash: "unused",
          planningTimezone: "UTC",
        },
        {
          displayName: "Other authorization user",
          email: "authorization-other@example.com",
          passwordHash: "unused",
          planningTimezone: "UTC",
        },
      ])
      .returning({ id: users.id });
    const owner = created[0];
    const other = created[1];
    if (!owner || !other) throw new Error("Authorization test users were not created.");
    ownerId = owner.id;
    otherUserId = other.id;
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  beforeEach(async () => {
    now = initialNow;
    await database.db.delete(oauthStates);
  });

  function service() {
    return createConnectorAuthorizationService({
      db: database.db,
      encryptionKey,
      now: () => now,
    });
  }

  it("stores only a hash of state and an encrypted PKCE verifier", async () => {
    const created = await service().create({
      provider: "google",
      redirectUri: "https://api.example.com/v1/connectors/google/callback",
      requestedServices: ["calendar", "mail"],
      returnPath: "/setup",
      targetAccountId: null,
      userId: ownerId,
    });
    const [stored] = await database.db
      .select()
      .from(oauthStates)
      .where(eq(oauthStates.id, created.attemptId));

    expect(stored).toMatchObject({
      provider: "google",
      redirectUri: "https://api.example.com/v1/connectors/google/callback",
      requestedServices: ["calendar", "mail"],
      returnPath: "/setup",
      status: "pending",
      tokenHash: hashToken(created.state),
      userId: ownerId,
    });
    expect(JSON.stringify(stored)).not.toContain(created.state);
    expect(JSON.stringify(stored)).not.toContain(created.codeVerifier);
    if (!stored?.encryptedVerifier) throw new Error("Encrypted PKCE verifier was not stored.");
    expect(decryptJson<{ codeVerifier: string }>(stored.encryptedVerifier, encryptionKey)).toEqual({
      codeVerifier: created.codeVerifier,
    });
    expect(created.codeChallenge).toBe(
      createHash("sha256").update(created.codeVerifier).digest("base64url"),
    );
    expect(stored?.expiresAt).toEqual(new Date("2026-08-06T12:30:00.000Z"));
  });

  it("allows exactly one concurrent consumer and keeps an active replay pending", async () => {
    const created = await service().create({
      provider: "x",
      redirectUri: "https://api.example.com/v1/x-bookmarks/callback",
      requestedServices: null,
      returnPath: "/settings?section=connections",
      targetAccountId: null,
      userId: ownerId,
    });

    const results = await Promise.all([
      service().consume("x", created.state, "request-one"),
      service().consume("x", created.state, "request-two"),
    ]);

    expect(results.filter((result) => result.kind === "ready")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "processing")).toHaveLength(1);
    const ready = results.find((result) => result.kind === "ready");
    if (ready?.kind !== "ready") throw new Error("No attempt consumer won the claim.");
    expect(ready.codeVerifier).toBe(created.codeVerifier);
  });

  it("closes recognized expiry and stale processing without replaying provider work", async () => {
    const expired = await service().create({
      provider: "google",
      redirectUri: "https://api.example.com/v1/connectors/google/callback",
      requestedServices: ["calendar"],
      returnPath: "/settings?section=connections",
      targetAccountId: null,
      userId: ownerId,
    });
    now = new Date("2026-08-06T12:31:00.000Z");
    const expiredResult = await service().consume("google", expired.state, "expired-request");
    expect(expiredResult).toMatchObject({ kind: "expired", attempt: { status: "expired" } });

    now = initialNow;
    const interrupted = await service().create({
      provider: "google",
      redirectUri: "https://api.example.com/v1/connectors/google/callback",
      requestedServices: ["mail"],
      returnPath: "/settings?section=connections",
      targetAccountId: null,
      userId: ownerId,
    });
    expect(await service().consume("google", interrupted.state, "first-request")).toMatchObject({
      kind: "ready",
    });
    now = new Date("2026-08-06T12:03:00.000Z");
    const staleResult = await service().consume("google", interrupted.state, "recovery-request");
    expect(staleResult).toMatchObject({
      kind: "closed",
      attempt: { outcomeCode: "authorization_interrupted", status: "failed" },
    });
  });

  it("returns only an owner-visible public outcome for twenty-four hours", async () => {
    const created = await service().create({
      provider: "google",
      redirectUri: "https://api.example.com/v1/connectors/google/callback",
      requestedServices: ["calendar"],
      returnPath: "/settings?section=connections",
      targetAccountId: null,
      userId: ownerId,
    });
    expect(await service().consume("google", created.state, "callback-request")).toMatchObject({
      kind: "ready",
    });
    await service().close({
      accountId: "33333333-3333-4333-8333-333333333333",
      attemptId: created.attemptId,
      outcomeCode: "authorization_connected",
      status: "connected",
    });

    expect(await service().publicOutcome(ownerId, created.attemptId)).toEqual({
      accountId: "33333333-3333-4333-8333-333333333333",
      provider: "google",
      retryable: false,
      status: "connected",
    });
    await expect(service().publicOutcome(otherUserId, created.attemptId)).rejects.toMatchObject({
      code: "not_found",
    });
    now = new Date("2026-08-07T12:00:01.000Z");
    await expect(service().publicOutcome(ownerId, created.attemptId)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("maps active X attempts and retryable failures to the public contract", async () => {
    const created = await service().create({
      provider: "x",
      redirectUri: "https://api.example.com/v1/x-bookmarks/callback",
      requestedServices: null,
      returnPath: "/settings?section=connections",
      targetAccountId: null,
      userId: ownerId,
    });

    expect(await service().publicOutcome(ownerId, created.attemptId)).toEqual({
      accountId: null,
      provider: "x",
      retryable: false,
      status: "pending",
    });
    expect(await service().consume("x", created.state, "callback-request")).toMatchObject({
      kind: "ready",
    });
    expect(await service().publicOutcome(ownerId, created.attemptId)).toMatchObject({
      provider: "x",
      status: "pending",
    });
    await service().close({
      accountId: null,
      attemptId: created.attemptId,
      outcomeCode: "provider_transport_failure",
      status: "failed",
    });
    expect(await service().publicOutcome(ownerId, created.attemptId)).toEqual({
      accountId: null,
      provider: "x",
      retryable: true,
      status: "failed",
    });
  });

  it("fails closed when a pending attempt has lost its verifier", async () => {
    const created = await service().create({
      provider: "google",
      redirectUri: "https://api.example.com/v1/connectors/google/callback",
      requestedServices: ["calendar"],
      returnPath: "/settings?section=connections",
      targetAccountId: null,
      userId: ownerId,
    });
    await database.db
      .update(oauthStates)
      .set({ encryptedVerifier: null })
      .where(eq(oauthStates.id, created.attemptId));

    expect(await service().consume("google", created.state, "callback-request")).toMatchObject({
      kind: "closed",
      attempt: {
        outcomeCode: "authorization_verifier_missing",
        status: "failed",
      },
    });
  });

  it("distinguishes invalid, active, and closed callback replays", async () => {
    expect(await service().consume("google", "oauth_unknown", "unknown-request")).toEqual({
      kind: "invalid",
    });

    const created = await service().create({
      provider: "google",
      redirectUri: "https://api.example.com/v1/connectors/google/callback",
      requestedServices: ["calendar"],
      returnPath: "/settings?section=connections",
      targetAccountId: null,
      userId: ownerId,
    });
    expect(await service().consume("google", created.state, "first-request")).toMatchObject({
      kind: "ready",
    });
    expect(await service().consume("google", created.state, "active-replay")).toMatchObject({
      kind: "processing",
    });
    await service().close({
      accountId: null,
      attemptId: created.attemptId,
      outcomeCode: "authorization_denied",
      status: "cancelled",
    });
    expect(await service().consume("google", created.state, "closed-replay")).toMatchObject({
      kind: "closed",
      attempt: { status: "cancelled" },
    });
    await expect(
      service().close({
        accountId: null,
        attemptId: created.attemptId,
        outcomeCode: "authorization_denied",
        status: "cancelled",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("resolves expiry and processing races from the latest durable state", async () => {
    const expiredPending = {
      consumedAt: null,
      expiresAt: new Date("2026-08-06T11:59:00.000Z"),
      id: "11111111-1111-4111-8111-111111111111",
      status: "pending",
    };
    const concurrentlyClosed = { ...expiredPending, status: "failed" };
    const closedExpiry = createConnectorAuthorizationService({
      db: scriptedAuthorizationDatabase({
        selects: [[expiredPending], [concurrentlyClosed]],
        updates: [[], []],
      }),
      encryptionKey,
      now: () => initialNow,
    });
    await expect(closedExpiry.consume("google", "oauth_state", "request-id")).resolves.toEqual({
      attempt: concurrentlyClosed,
      kind: "closed",
    });

    const removedExpiry = createConnectorAuthorizationService({
      db: scriptedAuthorizationDatabase({
        selects: [[expiredPending], []],
        updates: [[], []],
      }),
      encryptionKey,
      now: () => initialNow,
    });
    await expect(removedExpiry.consume("google", "oauth_state", "request-id")).resolves.toEqual({
      kind: "invalid",
    });

    const processing = {
      consumedAt: initialNow,
      expiresAt: new Date("2026-08-06T12:30:00.000Z"),
      id: "22222222-2222-4222-8222-222222222222",
      status: "processing",
    };
    const closedProcessing = { ...processing, status: "cancelled" };
    const changedProcessing = createConnectorAuthorizationService({
      db: scriptedAuthorizationDatabase({
        selects: [[processing], [closedProcessing]],
        updates: [[]],
      }),
      encryptionKey,
      now: () => initialNow,
    });
    await expect(changedProcessing.consume("google", "oauth_state", "request-id")).resolves.toEqual(
      { attempt: closedProcessing, kind: "closed" },
    );

    const removedProcessing = createConnectorAuthorizationService({
      db: scriptedAuthorizationDatabase({
        selects: [[processing], []],
        updates: [[]],
      }),
      encryptionKey,
      now: () => initialNow,
    });
    await expect(removedProcessing.consume("google", "oauth_state", "request-id")).resolves.toEqual(
      { kind: "invalid" },
    );
  });

  it("fails safely when attempt persistence returns no record", async () => {
    const failedInsert = {
      insert: () => ({
        values: () => ({
          returning: async () => [],
        }),
      }),
    } as unknown as Database;
    const authorization = createConnectorAuthorizationService({
      db: failedInsert,
      encryptionKey,
      now: () => initialNow,
    });

    await expect(
      authorization.create({
        provider: "google",
        redirectUri: "https://api.example.com/v1/connectors/google/callback",
        requestedServices: ["calendar"],
        returnPath: "/settings?section=connections",
        targetAccountId: null,
        userId: ownerId,
      }),
    ).rejects.toMatchObject({ code: "internal_error" });
  });

  it("hides a completed outcome after its independent visibility deadline", async () => {
    const created = await service().create({
      provider: "google",
      redirectUri: "https://api.example.com/v1/connectors/google/callback",
      requestedServices: ["calendar"],
      returnPath: "/settings?section=connections",
      targetAccountId: null,
      userId: ownerId,
    });
    expect(await service().consume("google", created.state, "callback-request")).toMatchObject({
      kind: "ready",
    });
    await service().close({
      accountId: null,
      attemptId: created.attemptId,
      outcomeCode: "authorization_denied",
      status: "cancelled",
    });
    await database.db
      .update(oauthStates)
      .set({ createdAt: new Date("2026-08-07T11:00:00.000Z") })
      .where(eq(oauthStates.id, created.attemptId));
    now = new Date("2026-08-07T12:00:01.000Z");

    await expect(service().publicOutcome(ownerId, created.attemptId)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("purges attempts only after the seven-day retention window", async () => {
    const retained = await service().create({
      provider: "google",
      redirectUri: "https://api.example.com/v1/connectors/google/callback",
      requestedServices: ["calendar"],
      returnPath: "/settings?section=connections",
      targetAccountId: null,
      userId: ownerId,
    });
    now = new Date("2026-08-13T12:29:59.000Z");
    expect(await service().purgeExpired()).toBe(0);
    now = new Date("2026-08-13T12:30:01.000Z");
    expect(await service().purgeExpired()).toBe(1);
    expect(
      await database.db.select().from(oauthStates).where(eq(oauthStates.id, retained.attemptId)),
    ).toHaveLength(0);
  });
});
