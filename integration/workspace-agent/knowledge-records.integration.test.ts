import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createApiClient } from "@personal-os/api-client";
import {
  accessTokens,
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  knowledgeReceipts,
  knowledgeRecords,
  knowledgeRevisions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import {
  type AccessScope,
  type KnowledgeMutationInput,
  knowledgeReceiptSchema,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createApp } from "../../apps/api/src/app.js";
import { loadConfig } from "../../apps/api/src/config.js";
import { hashToken } from "../../apps/api/src/security.js";
import type { Principal } from "../../apps/api/src/types.js";
import { createPersonalOsMcpServer } from "../../apps/mcp/src/server.js";

describe.sequential("persistent scoped knowledge", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  const now = () => new Date("2026-10-25T12:00:00Z");
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  beforeEach(async () => {
    await database.db.delete(users);
  });
  async function fixture(scopes: AccessScope[] = ["knowledge:read", "knowledge:write"]) {
    const userId = randomUUID(),
      actorId = randomUUID(),
      token = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
      displayName: "Owner",
      passwordHash: "unused",
    });
    await database.db.insert(accessTokens).values({
      id: actorId,
      userId,
      name: "Knowledge caller",
      tokenHash: hashToken(token),
      scopes,
    });
    const human: Principal = { userId, actorId: userId, actorType: "user", scopes: new Set() };
    const agent: Principal = { userId, actorId, actorType: "agent", scopes: new Set(scopes) };
    return { human, agent, token };
  }
  const input = (overrides: Partial<KnowledgeMutationInput> = {}): KnowledgeMutationInput => ({
    mutationKey: randomUUID(),
    content: {
      kind: "fact",
      value: {
        subject: "owner",
        predicate: "preferred day",
        value: { type: "string", value: "Tuesday" },
      },
    },
    scope: { workspace: null },
    sensitivity: "standard",
    purposes: ["planning"],
    evidence: [{ type: "statement", wording: "I prefer Tuesday." }],
    relatedRecordIds: [],
    ...overrides,
  });
  function app() {
    return createApp({
      db: database.db,
      now,
      config: loadConfig({
        APP_BASE_URL: "https://app.example.com",
        API_BASE_URL: "https://api.example.com",
        APP_ENCRYPTION_KEY: "test-only-secret",
        DATABASE_URL: container.getConnectionUri(),
        GOOGLE_REDIRECT_URI: "https://api.example.com/v1/connectors/google/callback",
        X_REDIRECT_URI: "https://api.example.com/v1/x-bookmarks/callback",
      }),
    });
  }
  it.each([
    "maximum fields",
    "maximum serialized bytes",
  ])("preserves %s losslessly when an agent fact becomes an inference", async (boundary) => {
    const f = await fixture();
    const apiApp = app();
    const api = createApiClient({
      baseUrl: "https://api.example.com",
      token: f.token,
      fetch: (url, init) => Promise.resolve(apiApp.request(String(url), init)),
    });
    const request = input({
      content: {
        kind: "fact",
        value: {
          subject: "s".repeat(2048),
          predicate: "p".repeat(2048),
          value: { type: "string", value: "v".repeat(2048) },
        },
      },
      evidence: [],
    });
    if (request.content.kind !== "fact") throw new Error("Expected fact fixture");
    if (boundary === "maximum serialized bytes") {
      request.content.value.value = { type: "string", value: '"'.repeat(2048) };
      request.content.value.subject = "";
      const overhead = new TextEncoder().encode(JSON.stringify(request.content.value)).byteLength;
      request.content.value.subject = "s".repeat(8192 - overhead);
      expect(new TextEncoder().encode(JSON.stringify(request.content.value))).toHaveLength(8192);
      const oversized = structuredClone(request);
      if (oversized.content.kind !== "fact") throw new Error("Expected fact fixture");
      oversized.content.value.subject += "s";
      await expect(api.saveKnowledge(oversized)).rejects.toMatchObject({ status: 400 });
    }
    const expectedProposition = JSON.stringify(request.content);
    expect(expectedProposition.length).toBeGreaterThan(2048);
    const server = createPersonalOsMcpServer({ api, scopes: f.agent.scopes, timeZone: "UTC" });
    const client = new Client({ name: "knowledge-boundary", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    try {
      const saved = await client.callTool({ name: "save_knowledge", arguments: request });
      expect(saved.isError, JSON.stringify(saved)).not.toBe(true);
      const receipt = knowledgeReceiptSchema.parse(
        (saved.structuredContent as { result: unknown })?.result,
      );
      expect(receipt.record).toMatchObject({
        content: { kind: "inference", value: { proposition: expectedProposition } },
        status: "proposed",
      });
      if (receipt.record.content.kind !== "inference") throw new Error("Expected inference");
      expect(JSON.parse(receipt.record.content.value.proposition)).toEqual(request.content);
      const read = await client.callTool({
        name: "get_knowledge",
        arguments: { id: receipt.record.id, purpose: "planning" },
      });
      expect(read.isError, JSON.stringify(read)).not.toBe(true);
      expect((read.structuredContent as { result: unknown })?.result).toEqual(receipt.record);
      // A fresh API composition and an exact retry must recover the same persisted result.
      const restarted = createApiClient({
        baseUrl: "https://api.example.com",
        token: f.token,
        fetch: (url, init) => Promise.resolve(app().request(String(url), init)),
      });
      expect(await restarted.saveKnowledge(request)).toEqual(receipt);
      expect(await restarted.getKnowledge({ id: receipt.record.id, purpose: "planning" })).toEqual(
        receipt.record,
      );
      expect(await database.db.select().from(knowledgeRecords)).toHaveLength(1);
      expect(await database.db.select().from(knowledgeReceipts)).toHaveLength(1);
      expect(
        await database.db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.action, "knowledge.created")),
      ).toHaveLength(1);
      const revisions = await database.db.select().from(knowledgeRevisions);
      expect(revisions).toHaveLength(1);
      expect(revisions[0]?.snapshot).toEqual(receipt.record);
    } finally {
      await client.close();
      await server.close();
    }
  }, 20_000);
  it("saves and reads persisted knowledge through normal MCP discovery, client and registered API", async () => {
    const f = await fixture();
    const apiApp = app();
    expect(
      (
        await apiApp.request("/v1/knowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input()),
        })
      ).status,
    ).toBe(401);
    expect((await apiApp.request(`/v1/knowledge/${randomUUID()}?purpose=planning`)).status).toBe(
      401,
    );
    const api = createApiClient({
      baseUrl: "https://api.example.com",
      token: f.token,
      fetch: (url, init) => Promise.resolve(apiApp.request(String(url), init)),
    });
    const server = createPersonalOsMcpServer({ api, scopes: f.agent.scopes, timeZone: "UTC" });
    const client = new Client({ name: "knowledge-acceptance", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(["save_knowledge", "get_knowledge"]),
      );
      const request = input({
        evidence: [
          {
            type: "statement",
            wording: "I prefer Tuesday",
            sessionRef: "external-session",
            messageRef: "external-message",
          },
        ],
      });
      const saved = await client.callTool({ name: "save_knowledge", arguments: request });
      expect(saved.isError, JSON.stringify(saved)).not.toBe(true);
      const receipt = (saved.structuredContent as { result: unknown })?.result as {
        record: { id: string };
        receiptId: string;
      };
      expect(receipt.record.id).toBeTruthy();
      const read = await client.callTool({
        name: "get_knowledge",
        arguments: { id: receipt.record.id, purpose: "planning" },
      });
      expect((read.structuredContent as { result: unknown })?.result).toMatchObject({
        id: receipt.record.id,
        status: "active",
      });
      const malformed = await client.callTool({
        name: "get_knowledge",
        arguments: { id: receipt.record.id, purpose: "planning", userId: randomUUID() },
      });
      expect(malformed.isError).toBe(true);
      const restarted = createApiClient({
        baseUrl: "https://api.example.com",
        token: f.token,
        fetch: (url, init) => Promise.resolve(app().request(String(url), init)),
      });
      expect(
        (await restarted.getKnowledge({ id: receipt.record.id, purpose: "planning" })).id,
      ).toBe(receipt.record.id);
      await database.db
        .update(accessTokens)
        .set({ scopes: ["knowledge:read"] })
        .where(eq(accessTokens.id, f.agent.actorId));
      await expect(api.saveKnowledge(request)).rejects.toMatchObject({ status: 403 });
    } finally {
      await client.close();
      await server.close();
    }
  }, 20_000);
});
