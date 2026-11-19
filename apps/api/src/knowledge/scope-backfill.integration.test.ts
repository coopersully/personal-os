import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  accessTokens,
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  oauthAuthorizationCodes,
  oauthClients,
  oauthRefreshTokens,
  sessions,
  users,
} from "@personal-os/database";
import {
  type AccessScope,
  accessScopeSchema,
  knowledgeCoreSchema,
  knowledgeReceiptSchema,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, inArray, sql } from "drizzle-orm";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createOAuthService } from "../oauth-service.js";
import { hashToken } from "../security.js";
import type { Principal } from "../types.js";
import { createKnowledgeRecordService } from "./record-service.js";

const migrationsFolder = resolve(process.cwd(), "packages/database/migrations");
const memory: AccessScope[] = ["knowledge:read", "knowledge:write"];
const workspacePrefixes = ["tasks", "calendar", "mail", "finances", "texting", "reminders"];
const resource = "https://api.example.com/mcp";
const encryptionKey = Buffer.alloc(32, 9).toString("base64");
const hour = 60 * 60_000;

/** The exact backfill statement 0146 runs, so this test and the migration cannot drift. */
function backfillStatement() {
  const migration = readFileSync(resolve(migrationsFolder, "0146_persistent_memory.sql"), "utf8");
  const match = migration.match(
    /-- memory-scope-backfill:begin\n([\s\S]+?)-- memory-scope-backfill:end/,
  );
  if (!match?.[1]) throw new Error("0146 has no delimited memory scope backfill.");
  return match[1];
}

let container: StartedPostgreSqlContainer;
let database: DatabaseClient;

const runBackfill = () => database.db.execute(sql.raw(backfillStatement()));

function app() {
  return createApp({
    db: database.db,
    now: () => new Date(),
    config: loadConfig({
      APP_BASE_URL: "https://app.example.com",
      API_BASE_URL: "https://api.example.com",
      APP_ENCRYPTION_KEY: encryptionKey,
      MCP_INTERNAL_SECRET: "knowledge-test-internal-secret-32-chars",
      DATABASE_URL: container.getConnectionUri(),
      GOOGLE_REDIRECT_URI: "https://api.example.com/v1/connectors/google/callback",
      X_REDIRECT_URI: "https://api.example.com/v1/x-bookmarks/callback",
    }),
  });
}

async function owner() {
  const userId = randomUUID();
  await database.db.insert(users).values({
    id: userId,
    email: `${userId}@example.test`,
    displayName: "Owner",
    passwordHash: "unused",
    planningTimezone: "UTC",
  });
  return userId;
}

async function client() {
  const id = `mcp_client_${randomUUID()}`;
  await database.db
    .insert(oauthClients)
    .values({ id, name: "Fixture host", redirectUris: ["https://host.example/callback"] });
  return id;
}

async function token(
  userId: string,
  scopes: AccessScope[],
  options: { expiresAt?: Date | null; revokedAt?: Date; clientId?: string } = {},
) {
  const id = randomUUID();
  await database.db.insert(accessTokens).values({
    id,
    userId,
    name: options.clientId ? `MCP OAuth (${options.clientId})` : "Personal token",
    scopes,
    tokenHash: hashToken(randomUUID()),
    expiresAt: options.expiresAt ?? null,
    revokedAt: options.revokedAt ?? null,
    ...(options.clientId ? { clientId: options.clientId, audience: resource } : {}),
  });
  return id;
}

/** An OAuth access token and the refresh token issued with it. */
async function oauthGrant(
  userId: string,
  scopes: AccessScope[],
  state: { accessExpiresAt: Date; refreshExpiresAt: Date; refreshReplacedAt?: Date },
) {
  const clientId = await client();
  const id = await token(userId, scopes, { clientId, expiresAt: state.accessExpiresAt });
  await database.db.insert(oauthRefreshTokens).values({
    accessTokenId: id,
    clientId,
    userId,
    tokenHash: hashToken(randomUUID()),
    expiresAt: state.refreshExpiresAt,
    replacedAt: state.refreshReplacedAt ?? null,
  });
  return id;
}

async function code(
  userId: string,
  scopes: AccessScope[],
  state: { expiresAt: Date; usedAt?: Date },
) {
  const id = randomUUID();
  await database.db.insert(oauthAuthorizationCodes).values({
    id,
    userId,
    clientId: await client(),
    codeChallenge: "challenge",
    codeHash: hashToken(randomUUID()),
    redirectUri: "https://host.example/callback",
    resource,
    scopes,
    expiresAt: state.expiresAt,
    usedAt: state.usedAt ?? null,
  });
  return id;
}

async function tokenScopes(ids: string[]) {
  const rows = await database.db
    .select({ id: accessTokens.id, scopes: accessTokens.scopes })
    .from(accessTokens)
    .where(inArray(accessTokens.id, ids));
  return Object.fromEntries(rows.map((row) => [row.id, row.scopes]));
}

async function codeScopes(ids: string[]) {
  const rows = await database.db
    .select({ id: oauthAuthorizationCodes.id, scopes: oauthAuthorizationCodes.scopes })
    .from(oauthAuthorizationCodes)
    .where(inArray(oauthAuthorizationCodes.id, ids));
  return Object.fromEntries(rows.map((row) => [row.id, row.scopes]));
}

const auditFor = (userId: string) =>
  database.db.select().from(auditEvents).where(eq(auditEvents.userId, userId));

describe.sequential("memory scope backfill", () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, migrationsFolder);
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  it("backfill_workspace_scopes_follow_the_access_scope_schema", () => {
    const literal = backfillStatement().match(/workspace_scopes AS \(\s*SELECT ARRAY\[([^\]]+)\]/);
    const listed = [...(literal?.[1] ?? "").matchAll(/'([a-z]+:[a-z]+)'/g)].map(([, s]) => s);
    const expected = accessScopeSchema.options.filter((scope) =>
      workspacePrefixes.includes(scope.split(":")[0] ?? ""),
    );
    expect(expected).toContain("reminders:read");
    expect(listed.toSorted()).toEqual(expected.toSorted());
  });

  it("backfill_adds_memory_to_live_workspace_tokens", async () => {
    const userId = await owner();
    const now = Date.now();
    const live = {
      personal: await token(userId, ["tasks:read"]),
      personalUntil: await token(userId, ["finances:read", "mail:write"], {
        expiresAt: new Date(now + 24 * hour),
      }),
      reminders: await token(userId, ["reminders:read", "goals:read"]),
      oauth: await oauthGrant(userId, ["calendar:read"], {
        accessExpiresAt: new Date(now + hour),
        refreshExpiresAt: new Date(now + 30 * 24 * hour),
      }),
      // An idle OAuth or automation-host connection: its short access token has lapsed, but the
      // refresh token issued with it is live and copies this row's scopes when it refreshes.
      refreshable: await oauthGrant(userId, ["texting:read", "finances:maintain"], {
        accessExpiresAt: new Date(now - hour),
        refreshExpiresAt: new Date(now + 29 * 24 * hour),
      }),
    };
    const pendingCode = await code(userId, ["tasks:write"], {
      expiresAt: new Date(now + 5 * 60_000),
    });

    await runBackfill();

    expect(await tokenScopes(Object.values(live))).toEqual({
      [live.personal]: ["tasks:read", ...memory],
      [live.personalUntil]: ["finances:read", "mail:write", ...memory],
      [live.reminders]: ["reminders:read", "goals:read", ...memory],
      [live.oauth]: ["calendar:read", ...memory],
      [live.refreshable]: ["texting:read", "finances:maintain", ...memory],
    });
    expect(await codeScopes([pendingCode])).toEqual({ [pendingCode]: ["tasks:write", ...memory] });

    const audit = await auditFor(userId);
    expect(audit).toHaveLength(6);
    const personalAudit = audit.find((row) => row.entityId === live.personal);
    expect(personalAudit).toMatchObject({
      actorType: "system",
      actorId: "migration:0146_persistent_memory",
      requestId: "migration:0146_persistent_memory:memory-scope-backfill",
      action: "access_token.memory_scopes_granted",
      entityType: "access_token",
      before: { scopes: ["tasks:read"] },
      after: { scopes: ["tasks:read", ...memory], addedScopes: memory },
    });
    expect(audit.find((row) => row.entityId === pendingCode)).toMatchObject({
      actorType: "system",
      action: "oauth_authorization_code.memory_scopes_granted",
      entityType: "oauth_authorization_code",
      before: { scopes: ["tasks:write"] },
      after: { scopes: ["tasks:write", ...memory], addedScopes: memory },
    });

    // Idempotent: a second run widens nothing and audits nothing.
    await runBackfill();
    expect(await tokenScopes([live.personal, live.refreshable])).toEqual({
      [live.personal]: ["tasks:read", ...memory],
      [live.refreshable]: ["texting:read", "finances:maintain", ...memory],
    });
    expect(await auditFor(userId)).toHaveLength(6);
  });

  it("backfill_skips_revoked_expired_and_non_workspace_tokens", async () => {
    const userId = await owner();
    const now = Date.now();
    const skipped: Record<string, AccessScope[]> = {};
    const keep = async (scopes: AccessScope[], create: (s: AccessScope[]) => Promise<string>) => {
      skipped[await create(scopes)] = scopes;
    };
    await keep(["tasks:read"], (s) => token(userId, s, { revokedAt: new Date(now - hour) }));
    await keep(["tasks:read"], (s) => token(userId, s, { expiresAt: new Date(now - hour) }));
    await keep(["mail:read"], (s) =>
      oauthGrant(userId, s, {
        accessExpiresAt: new Date(now - 2 * hour),
        refreshExpiresAt: new Date(now + 24 * hour),
        refreshReplacedAt: new Date(now - hour),
      }),
    );
    await keep(["mail:read"], (s) =>
      oauthGrant(userId, s, {
        accessExpiresAt: new Date(now - 31 * 24 * hour),
        refreshExpiresAt: new Date(now - hour),
      }),
    );
    await keep(["calendar:read"], async (s) => {
      const id = await oauthGrant(userId, s, {
        accessExpiresAt: new Date(now + hour),
        refreshExpiresAt: new Date(now + 24 * hour),
      });
      await database.db
        .update(accessTokens)
        .set({ revokedAt: new Date(now - 60_000) })
        .where(eq(accessTokens.id, id));
      return id;
    });
    await keep(["goals:read", "audit:read", "bookmarks:read", "automations:read"], (s) =>
      token(userId, s),
    );
    await keep(["tracking:read"], (s) => token(userId, s));
    // The person already decided memory for these connections.
    await keep(["tasks:read", "knowledge:read"], (s) => token(userId, s));
    await keep(["tasks:read", "knowledge:write"], (s) => token(userId, s));
    await keep(["tasks:read", ...memory], (s) => token(userId, s));
    const codes: Record<string, AccessScope[]> = {};
    codes[await code(userId, ["tasks:read"], { expiresAt: new Date(now - 60_000) })] = [
      "tasks:read",
    ];
    codes[
      await code(userId, ["tasks:read"], {
        expiresAt: new Date(now + 60_000),
        usedAt: new Date(now - 1_000),
      })
    ] = ["tasks:read"];
    codes[await code(userId, ["goals:read"], { expiresAt: new Date(now + 60_000) })] = [
      "goals:read",
    ];

    await runBackfill();

    expect(await tokenScopes(Object.keys(skipped))).toEqual(skipped);
    expect(await codeScopes(Object.keys(codes))).toEqual(codes);
    expect(await auditFor(userId)).toEqual([]);
  });

  it("refresh_preserves_backfilled_scopes", async () => {
    const userId = await owner();
    // The grant was issued two hours ago, so its access token has lapsed and only refresh is live.
    let clock = new Date(Date.now() - 2 * hour);
    const oauth = createOAuthService({ db: database.db, now: () => clock, resource });
    const registered = await oauth.registerClient("Idle host", ["https://host.example/callback"]);
    const verifier = "v".repeat(64);
    const issued = await oauth.exchangeCode({
      clientId: registered.client_id,
      code: await oauth.authorize({
        userId,
        clientId: registered.client_id,
        codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
        redirectUri: "https://host.example/callback",
        scopes: ["finances:read", "finances:maintain"],
      }),
      codeVerifier: verifier,
      redirectUri: "https://host.example/callback",
      resource,
    });
    expect(issued.scope).toBe("finances:read finances:maintain");

    await runBackfill();
    clock = new Date();
    const refreshed = await oauth.refresh({
      clientId: registered.client_id,
      refreshToken: issued.refresh_token,
      resource,
    });

    expect(refreshed.scope.split(" ")).toEqual(["finances:read", "finances:maintain", ...memory]);
    const [successor] = await database.db
      .select({ scopes: accessTokens.scopes })
      .from(accessTokens)
      .where(eq(accessTokens.tokenHash, hashToken(refreshed.access_token)));
    expect(successor?.scopes).toEqual(["finances:read", "finances:maintain", ...memory]);
  });

  it("removed_memory_scope_blocks_core", async () => {
    const userId = await owner();
    const sessionId = randomUUID();
    await database.db.insert(sessions).values({
      id: sessionId,
      userId,
      tokenHash: hashToken(randomUUID()),
      expiresAt: new Date(Date.now() + hour),
    });
    const person: Principal = {
      userId,
      actorId: userId,
      actorType: "user",
      sessionId,
      scopes: new Set(),
    };
    const records = createKnowledgeRecordService({ db: database.db, now: () => new Date() });
    const saved = knowledgeReceiptSchema.parse(
      await records.create(person, {
        mutationKey: randomUUID(),
        content: {
          kind: "preference",
          value: { subject: "owner", key: "tea", value: { type: "string", value: "Green" } },
        },
        scope: { workspace: null },
        core: true,
        tags: ["tea"],
        evidence: [
          { type: "statement", wording: "Green tea.", sessionRef: "chat", messageRef: "m" },
        ],
      }),
    ).record;
    const bearer = randomUUID();
    const agentId = randomUUID();
    await database.db.insert(accessTokens).values({
      id: agentId,
      userId,
      name: "Existing agent",
      scopes: ["tasks:read"],
      tokenHash: hashToken(bearer),
    });
    const context = async () => {
      const response = await app().request("https://api.example.com/v1/assistant/context", {
        headers: { authorization: `Bearer ${bearer}` },
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as { context: Record<string, unknown> }).context;
    };
    const search = () =>
      app().request("https://api.example.com/v1/knowledge/search", {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({ text: "tea" }),
      });

    await runBackfill();
    expect(knowledgeCoreSchema.parse((await context()).memory).records.map((r) => r.id)).toEqual([
      saved.id,
    ]);
    expect((await search()).status).toBe(200);

    // The person removes memory reading from this connection.
    await database.db
      .update(accessTokens)
      .set({ scopes: sql`${accessTokens.scopes} - 'knowledge:read'` })
      .where(eq(accessTokens.id, agentId));

    expect(await context()).not.toHaveProperty("memory");
    expect((await search()).status).toBe(403);
    // Removal sticks: the backfill never re-adds memory to a connection that holds a memory scope.
    await runBackfill();
    expect(await tokenScopes([agentId])).toEqual({ [agentId]: ["tasks:read", "knowledge:write"] });
  });
});
