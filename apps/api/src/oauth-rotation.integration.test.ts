import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  oauthAccessTokenRotations,
  oauthRefreshTokens,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createAuthService } from "./auth-service.js";
import { readOAuthActorLineage } from "./oauth-actor-lineage.js";
import { createOAuthService } from "./oauth-service.js";
import { hashToken } from "./security.js";

/** Requires Lead's exclusive PostgreSQL slot; never run during source-only admission. */
describe.sequential("canonical OAuth rotation persistence and two-session serialization", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let current = new Date("2026-10-18T23:00:00Z");
  const resource = "https://mcp.example.com/mcp";
  const verifier = "v".repeat(43);
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  beforeEach(() => {
    current = new Date("2026-10-18T23:00:00Z");
  });
  const service = (audience = resource) =>
    createOAuthService({ db: database.db, now: () => current, resource: audience });
  async function fixture() {
    const userId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.com`,
      displayName: "OAuth",
      passwordHash: "unused",
    });
    const client = await service().registerClient("Fixture", ["https://client.example/callback"]);
    const code = await service().authorize({
      userId,
      clientId: client.client_id,
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      redirectUri: "https://client.example/callback",
      scopes: ["finances:read"],
    });
    const response = await service().exchangeCode({
      clientId: client.client_id,
      code,
      codeVerifier: verifier,
      redirectUri: "https://client.example/callback",
      resource,
    });
    const [actor] = await database.db
      .select()
      .from(accessTokens)
      .where(eq(accessTokens.tokenHash, hashToken(response.access_token)));
    if (!actor) throw new Error("actor");
    return {
      userId,
      clientId: client.client_id,
      response,
      actor,
      rotate: () =>
        service().refresh({
          clientId: client.client_id,
          refreshToken: response.refresh_token,
          resource,
        }),
    };
  }
  async function waitForBlocked(pid: number) {
    for (let i = 0; i < 100; i++) {
      const state = await database.pool.query(
        "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
        [pid],
      );
      if (state.rows[0]?.wait_event_type === "Lock") return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Expected real PostgreSQL lock wait");
  }
  // Use a dedicated one-connection pool so its PID identifies the service transaction, not a timing guess.
  async function isolated() {
    const client = createDatabaseClient({ connectionString: container.getConnectionUri(), max: 1 });
    const result = await client.pool.query("SELECT pg_backend_pid() AS pid");
    return { client, pid: result.rows[0].pid as number };
  }
  it("records one immutable owner-bound edge, preserves response/scopes, permits expired ancestors and rejects refresh replay", async () => {
    const f = await fixture();
    expect(
      await database.db
        .select()
        .from(oauthAccessTokenRotations)
        .where(eq(oauthAccessTokenRotations.userId, f.userId)),
    ).toEqual([]);
    current = new Date(current.getTime() + 2 * 3600000);
    const result = await f.rotate();
    expect(Object.keys(result).sort()).toEqual([
      "access_token",
      "expires_in",
      "refresh_token",
      "scope",
      "token_type",
    ]);
    expect(result.scope).toBe("finances:read");
    expect(result.expires_in).toBe(3600);
    const [next] = await database.db
      .select()
      .from(accessTokens)
      .where(eq(accessTokens.tokenHash, hashToken(result.access_token)));
    if (!next) throw new Error("next");
    expect(
      await readOAuthActorLineage(database.db, {
        ownerId: f.userId,
        ancestorActorId: f.actor.id,
        currentActorId: next.id,
        audience: resource,
      }),
    ).toEqual({ actorIds: [f.actor.id, next.id] });
    await expect(f.rotate()).rejects.toMatchObject({ code: "unauthorized" });
    expect(
      await database.db
        .select()
        .from(oauthAccessTokenRotations)
        .where(eq(oauthAccessTokenRotations.userId, f.userId)),
    ).toHaveLength(1);
    await expect(
      database.pool.query(
        "UPDATE oauth_access_token_rotations SET rotated_at=clock_timestamp() WHERE user_id=$1",
        [f.userId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      database.pool.query("DELETE FROM oauth_access_token_rotations WHERE user_id=$1", [f.userId]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      database.pool.query("DELETE FROM access_tokens WHERE id=$1", [f.actor.id]),
    ).rejects.toMatchObject({ code: "23503" });
    await database.db.delete(users).where(eq(users.id, f.userId));
    expect(
      await database.db
        .select()
        .from(oauthAccessTokenRotations)
        .where(eq(oauthAccessTokenRotations.userId, f.userId)),
    ).toEqual([]);
  });
  it("rolls back retirement and both inserts if edge persistence fails", async () => {
    const f = await fixture();
    await database.pool.query(
      "CREATE FUNCTION reject_test_rotation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'edge failure'; END $$; CREATE TRIGGER reject_test_rotation BEFORE INSERT ON oauth_access_token_rotations FOR EACH ROW EXECUTE FUNCTION reject_test_rotation()",
    );
    try {
      await expect(f.rotate()).rejects.toThrow();
    } finally {
      await database.pool.query(
        "DROP TRIGGER reject_test_rotation ON oauth_access_token_rotations; DROP FUNCTION reject_test_rotation()",
      );
    }
    const rows = await database.db
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.accessTokenId, f.actor.id));
    expect(rows[0]?.replacedAt).toBeNull();
    expect(
      await database.db.select().from(accessTokens).where(eq(accessTokens.userId, f.userId)),
    ).toHaveLength(1);
    await expect(f.rotate()).resolves.toHaveProperty("access_token");
  });
  it("individual revoke wins before old-access SHARE: waiting rotation rejects and retires nothing", async () => {
    const f = await fixture();
    const lock = await database.pool.connect();
    const other = await isolated();
    try {
      await lock.query("BEGIN");
      await lock.query("UPDATE access_tokens SET revoked_at=clock_timestamp() WHERE id=$1", [
        f.actor.id,
      ]);
      const rotating = createOAuthService({
        db: other.client.db,
        now: () => current,
        resource,
      }).refresh({ clientId: f.clientId, refreshToken: f.response.refresh_token, resource });
      const rejected = expect(rotating).rejects.toMatchObject({ code: "unauthorized" });
      await waitForBlocked(other.pid);
      await lock.query("COMMIT");
      await rejected;
      expect(
        (
          await database.db
            .select()
            .from(oauthRefreshTokens)
            .where(eq(oauthRefreshTokens.accessTokenId, f.actor.id))
        )[0]?.replacedAt,
      ).toBeNull();
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
      await other.client.close();
    }
  });
  it("rotation retained SHARE wins first: individual revoke waits and revokes only the old actor", async () => {
    const f = await fixture();
    const gate = await database.pool.connect();
    const other = await isolated();
    // A before-edge trigger pauses after old-access SHARE and successor insert, before commit.
    await gate.query("BEGIN");
    await gate.query("SELECT pg_advisory_xact_lock(812345678)");
    await database.pool.query(
      "CREATE FUNCTION pause_test_rotation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(812345678); RETURN NEW; END $$; CREATE TRIGGER pause_test_rotation BEFORE INSERT ON oauth_access_token_rotations FOR EACH ROW EXECUTE FUNCTION pause_test_rotation()",
    );
    try {
      const rotating = f.rotate();
      for (let i = 0; i < 100; i++) {
        const q = await database.pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%oauth_access_token_rotations%' AND pid<>pg_backend_pid()",
        );
        if (q.rowCount) break;
        if (i === 99) throw new Error("rotation did not pause");
        await new Promise((r) => setTimeout(r, 10));
      }
      const revoking = createAuthService({
        db: other.client.db,
        now: () => current,
        sessionTtlDays: 30,
      }).revokeAccessToken(f.userId, f.actor.id);
      await waitForBlocked(other.pid);
      await gate.query("COMMIT");
      const result = await rotating;
      await revoking;
      const [next] = await database.db
        .select()
        .from(accessTokens)
        .where(eq(accessTokens.tokenHash, hashToken(result.access_token)));
      expect(next?.revokedAt).toBeNull();
    } finally {
      await gate.query("ROLLBACK");
      gate.release();
      await other.client.close();
      await database.pool.query(
        "DROP TRIGGER pause_test_rotation ON oauth_access_token_rotations; DROP FUNCTION pause_test_rotation()",
      );
    }
  });
  it.each([
    "code",
    "refresh",
  ] as const)("rejects %s that expires during grant-lock wait using decision-time now", async (kind) => {
    const f = await fixture();
    const gate = await database.pool.connect();
    const other = await isolated();
    let code = "";
    if (kind === "code")
      code = await service().authorize({
        userId: f.userId,
        clientId: f.clientId,
        codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
        redirectUri: "https://client.example/callback",
        scopes: ["finances:read"],
      });
    try {
      await gate.query("BEGIN");
      await gate.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        JSON.stringify([f.userId, f.clientId, resource]),
      ]);
      const oauth = createOAuthService({ db: other.client.db, now: () => current, resource });
      const pending =
        kind === "code"
          ? oauth.exchangeCode({
              clientId: f.clientId,
              code,
              codeVerifier: verifier,
              redirectUri: "https://client.example/callback",
              resource,
            })
          : oauth.refresh({
              clientId: f.clientId,
              refreshToken: f.response.refresh_token,
              resource,
            });
      const rejected = expect(pending).rejects.toMatchObject({ code: "unauthorized" });
      await waitForBlocked(other.pid);
      current = new Date(current.getTime() + 31 * 86400000);
      await gate.query("COMMIT");
      await rejected;
    } finally {
      await gate.query("ROLLBACK");
      gate.release();
      await other.client.close();
    }
  });
  it("audience revoke preserves other resource grants and pending valid code remains new authorization", async () => {
    const f = await fixture();
    const otherResource = "https://other.example/mcp";
    const other = service(otherResource);
    const pending = await service().authorize({
      userId: f.userId,
      clientId: f.clientId,
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      redirectUri: "https://client.example/callback",
      scopes: ["finances:read"],
    });
    const code = await other.authorize({
      userId: f.userId,
      clientId: f.clientId,
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      redirectUri: "https://client.example/callback",
      scopes: ["finances:read"],
    });
    const response = await other.exchangeCode({
      clientId: f.clientId,
      code,
      codeVerifier: verifier,
      redirectUri: "https://client.example/callback",
      resource: otherResource,
    });
    await service().revokeAuthorizedClient(f.userId, f.clientId);
    await expect(f.rotate()).rejects.toMatchObject({ code: "unauthorized" });
    await expect(
      other.refresh({
        clientId: f.clientId,
        refreshToken: response.refresh_token,
        resource: otherResource,
      }),
    ).resolves.toHaveProperty("access_token");
    await expect(
      service().exchangeCode({
        clientId: f.clientId,
        code: pending,
        codeVerifier: verifier,
        redirectUri: "https://client.example/callback",
        resource,
      }),
    ).resolves.toHaveProperty("access_token");
  });
  it("owner deletion winning before issuance prevents all successor insertion", async () => {
    const f = await fixture();
    const lock = await database.pool.connect();
    const other = await isolated();
    try {
      await lock.query("BEGIN");
      await lock.query("DELETE FROM users WHERE id=$1", [f.userId]);
      const rotating = createOAuthService({
        db: other.client.db,
        now: () => current,
        resource,
      }).refresh({ clientId: f.clientId, refreshToken: f.response.refresh_token, resource });
      const rejected = expect(rotating).rejects.toMatchObject({ code: "unauthorized" });
      await waitForBlocked(other.pid);
      await lock.query("COMMIT");
      await rejected;
      expect(
        await database.db.select().from(accessTokens).where(eq(accessTokens.userId, f.userId)),
      ).toEqual([]);
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
      await other.client.close();
    }
  });
  it.each([
    "refresh",
    "code",
  ] as const)("serializes audience revoke before waiting %s issuance", async (kind) => {
    const f = await fixture();
    const code =
      kind === "code"
        ? await service().authorize({
            userId: f.userId,
            clientId: f.clientId,
            codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
            redirectUri: "https://client.example/callback",
            scopes: ["finances:read"],
          })
        : "";
    const gate = await database.pool.connect();
    const revoker = await isolated();
    const issuer = await isolated();
    await gate.query("BEGIN");
    await gate.query("SELECT pg_advisory_xact_lock(812345679)");
    await database.pool.query(
      "CREATE FUNCTION pause_test_revoke() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(812345679); RETURN NEW; END $$; CREATE TRIGGER pause_test_revoke BEFORE UPDATE ON access_tokens FOR EACH ROW EXECUTE FUNCTION pause_test_revoke()",
    );
    try {
      const revoking = createOAuthService({
        db: revoker.client.db,
        now: () => current,
        resource,
      }).revokeAuthorizedClient(f.userId, f.clientId);
      await waitForBlocked(revoker.pid);
      const oauth = createOAuthService({ db: issuer.client.db, now: () => current, resource });
      const issuing =
        kind === "refresh"
          ? oauth.refresh({
              clientId: f.clientId,
              refreshToken: f.response.refresh_token,
              resource,
            })
          : oauth.exchangeCode({
              clientId: f.clientId,
              code,
              codeVerifier: verifier,
              redirectUri: "https://client.example/callback",
              resource,
            });
      const expected =
        kind === "refresh"
          ? expect(issuing).rejects.toMatchObject({ code: "unauthorized" })
          : expect(issuing).resolves.toHaveProperty("access_token");
      await waitForBlocked(issuer.pid);
      await gate.query("COMMIT");
      await revoking;
      await expected;
    } finally {
      await gate.query("ROLLBACK");
      gate.release();
      await revoker.client.close();
      await issuer.client.close();
      await database.pool.query(
        "DROP TRIGGER pause_test_revoke ON access_tokens; DROP FUNCTION pause_test_revoke()",
      );
    }
  });
  it("rejects refresh expiry after old-access row wait and rolls retirement back", async () => {
    const f = await fixture();
    const blocker = await database.pool.connect();
    const other = await isolated();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM access_tokens WHERE id=$1 FOR UPDATE", [f.actor.id]);
      const rotating = createOAuthService({
        db: other.client.db,
        now: () => current,
        resource,
      }).refresh({ clientId: f.clientId, refreshToken: f.response.refresh_token, resource });
      const rejected = expect(rotating).rejects.toMatchObject({ code: "unauthorized" });
      await waitForBlocked(other.pid);
      current = new Date(current.getTime() + 31 * 86400000);
      await blocker.query("COMMIT");
      await rejected;
      expect(
        (
          await database.db
            .select()
            .from(oauthRefreshTokens)
            .where(eq(oauthRefreshTokens.accessTokenId, f.actor.id))
        )[0]?.replacedAt,
      ).toBeNull();
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await other.client.close();
    }
  });
  it.each([
    "refresh",
    "code",
  ] as const)("includes a committed %s successor in a waiting audience revoke", async (kind) => {
    const f = await fixture();
    const issuer = await isolated();
    const revoker = await isolated();
    const gate = await database.pool.connect();
    const code =
      kind === "code"
        ? await service().authorize({
            userId: f.userId,
            clientId: f.clientId,
            codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
            redirectUri: "https://client.example/callback",
            scopes: ["finances:read"],
          })
        : "";
    await gate.query("BEGIN");
    await gate.query("SELECT pg_advisory_xact_lock(812345680)");
    await database.pool.query(
      "CREATE FUNCTION pause_test_issue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(812345680); RETURN NEW; END $$; CREATE TRIGGER pause_test_issue BEFORE INSERT ON access_tokens FOR EACH ROW EXECUTE FUNCTION pause_test_issue()",
    );
    try {
      const oauth = createOAuthService({ db: issuer.client.db, now: () => current, resource });
      const issuing =
        kind === "refresh"
          ? oauth.refresh({
              clientId: f.clientId,
              refreshToken: f.response.refresh_token,
              resource,
            })
          : oauth.exchangeCode({
              clientId: f.clientId,
              code,
              codeVerifier: verifier,
              redirectUri: "https://client.example/callback",
              resource,
            });
      await waitForBlocked(issuer.pid);
      const revoking = createOAuthService({
        db: revoker.client.db,
        now: () => current,
        resource,
      }).revokeAuthorizedClient(f.userId, f.clientId);
      await waitForBlocked(revoker.pid);
      await gate.query("COMMIT");
      const issued = await issuing;
      await revoking;
      const [actor] = await database.db
        .select()
        .from(accessTokens)
        .where(eq(accessTokens.tokenHash, hashToken(issued.access_token)));
      expect(actor?.revokedAt).not.toBeNull();
      await expect(
        service().refresh({ clientId: f.clientId, refreshToken: issued.refresh_token, resource }),
      ).rejects.toMatchObject({ code: "unauthorized" });
    } finally {
      await gate.query("ROLLBACK");
      gate.release();
      await issuer.client.close();
      await revoker.client.close();
      await database.pool.query(
        "DROP TRIGGER pause_test_issue ON access_tokens; DROP FUNCTION pause_test_issue()",
      );
    }
  });
  it("owner erasure waits for retained issuance owner lock then removes tokens and immutable evidence", async () => {
    const f = await fixture();
    const issuer = await isolated();
    const eraser = await isolated();
    const gate = await database.pool.connect();
    await gate.query("BEGIN");
    await gate.query("SELECT pg_advisory_xact_lock(812345681)");
    await database.pool.query(
      "CREATE FUNCTION pause_test_owner() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(812345681); RETURN NEW; END $$; CREATE TRIGGER pause_test_owner BEFORE INSERT ON access_tokens FOR EACH ROW EXECUTE FUNCTION pause_test_owner()",
    );
    try {
      const issuing = createOAuthService({
        db: issuer.client.db,
        now: () => current,
        resource,
      }).refresh({ clientId: f.clientId, refreshToken: f.response.refresh_token, resource });
      await waitForBlocked(issuer.pid);
      const erasing = eraser.client.db.delete(users).where(eq(users.id, f.userId)).execute();
      await waitForBlocked(eraser.pid);
      await gate.query("COMMIT");
      await issuing;
      await erasing;
      expect(
        await database.db
          .select()
          .from(oauthAccessTokenRotations)
          .where(eq(oauthAccessTokenRotations.userId, f.userId)),
      ).toEqual([]);
      expect(
        await database.db.select().from(accessTokens).where(eq(accessTokens.userId, f.userId)),
      ).toEqual([]);
    } finally {
      await gate.query("ROLLBACK");
      gate.release();
      await issuer.client.close();
      await eraser.client.close();
      await database.pool.query(
        "DROP TRIGGER pause_test_owner ON access_tokens; DROP FUNCTION pause_test_owner()",
      );
    }
  });
  it("rejects another audience's refresh without consuming its grant", async () => {
    const f = await fixture();
    const wrong = "https://other.example/mcp";
    await expect(
      service(wrong).refresh({
        clientId: f.clientId,
        refreshToken: f.response.refresh_token,
        resource: wrong,
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
    expect(
      (
        await database.db
          .select()
          .from(oauthRefreshTokens)
          .where(eq(oauthRefreshTokens.accessTokenId, f.actor.id))
      )[0]?.replacedAt,
    ).toBeNull();
    await expect(f.rotate()).resolves.toHaveProperty("access_token");
  });
  it("rolls authorization-code consumption back if token issuance fails", async () => {
    const f = await fixture();
    const code = await service().authorize({
      userId: f.userId,
      clientId: f.clientId,
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      redirectUri: "https://client.example/callback",
      scopes: ["finances:read"],
    });
    const exchange = () =>
      service().exchangeCode({
        clientId: f.clientId,
        code,
        codeVerifier: verifier,
        redirectUri: "https://client.example/callback",
        resource,
      });
    await database.pool.query(
      "CREATE FUNCTION reject_test_issue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'issue failure'; END $$; CREATE TRIGGER reject_test_issue BEFORE INSERT ON access_tokens FOR EACH ROW EXECUTE FUNCTION reject_test_issue()",
    );
    try {
      await expect(exchange()).rejects.toThrow();
    } finally {
      await database.pool.query(
        "DROP TRIGGER reject_test_issue ON access_tokens; DROP FUNCTION reject_test_issue()",
      );
    }
    await expect(exchange()).resolves.toHaveProperty("access_token");
    expect(
      await database.db
        .select()
        .from(oauthAccessTokenRotations)
        .where(eq(oauthAccessTokenRotations.userId, f.userId)),
    ).toEqual([]);
  });
});
