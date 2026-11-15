import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createApiClient } from "@personal-os/api-client";
import {
  accessTokens,
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  sessions,
  users,
} from "@personal-os/database";
import {
  type AccessScope,
  type KnowledgeMutationInput,
  knowledgeContextExplanationSchema,
  knowledgeContextPackSchema,
  knowledgePageSchema,
  knowledgePendingReviewReceiptSchema,
  knowledgePreferenceClaimKey,
  knowledgeReceiptSchema,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { createApp } from "../../apps/api/src/app.js";
import { loadConfig } from "../../apps/api/src/config.js";
import { lockKnowledgeOwner } from "../../apps/api/src/knowledge/access.js";
import type { KnowledgeDeletionLedgerEntry } from "../../apps/api/src/knowledge/forget-service.js";
import { createRuntimeLifecycle } from "../../apps/api/src/runtime-lifecycle.js";
import { hashToken } from "../../apps/api/src/security.js";
import { createPersonalOsMcpServer } from "../../apps/mcp/src/server.js";
import { personalOsToolOutputSchema } from "../../apps/mcp/src/tool-surface.js";

describe.sequential("registered memory lifecycle", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  const now = () => new Date("2026-11-12T15:00:00Z");
  const planning = { purpose: "planning" } as const;
  const scopes = ["knowledge:read", "knowledge:write"] satisfies AccessScope[];

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

  async function fixture(ledgerMode: "available" | "missing" | "unreachable" = "available") {
    const userId = randomUUID();
    const sessionToken = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
      displayName: "Memory owner",
      passwordHash: "unused",
    });
    await database.db.insert(sessions).values({
      userId,
      tokenHash: hashToken(sessionToken),
      expiresAt: new Date(now().getTime() + 60 * 60_000),
    });
    const ledger = new Map<string, KnowledgeDeletionLedgerEntry>();
    const runtimeLifecycle = createRuntimeLifecycle();
    const app = createApp({
      db: database.db,
      now,
      runtimeLifecycle,
      config: loadConfig({
        APP_BASE_URL: "https://app.example.test",
        API_BASE_URL: "https://api.example.test",
        APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
        DATABASE_URL: container.getConnectionUri(),
        GOOGLE_REDIRECT_URI: "https://api.example.test/v1/connectors/google/callback",
        X_REDIRECT_URI: "https://api.example.test/v1/x-bookmarks/callback",
      }),
      ...(ledgerMode !== "missing"
        ? {
            knowledgeForget: {
              suppressionKey: Buffer.alloc(32, 11),
              ledger: {
                async append(entry: KnowledgeDeletionLedgerEntry) {
                  if (ledgerMode === "unreachable") throw new Error("Fixture ledger offline");
                  ledger.set(entry.operationId, structuredClone(entry));
                },
                async readReceipt(id: string) {
                  return ledger.get(id) ?? null;
                },
              },
            },
          }
        : {}),
    });
    const transport = {
      baseUrl: "https://api.example.test",
      fetch: (url: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(app.request(String(url), init)),
    };
    const owner = createApiClient({ ...transport, sessionToken });

    async function agent(name: string, grants: AccessScope[] = scopes) {
      const id = randomUUID();
      const token = randomUUID();
      await database.db
        .insert(accessTokens)
        .values({ id, userId, name, tokenHash: hashToken(token), scopes: grants });
      const api = createApiClient({ ...transport, token });
      async function connect(readOnly = false) {
        const client = new Client({ name, version: "1" });
        const server = createPersonalOsMcpServer({
          api,
          scopes: new Set(grants),
          timeZone: "UTC",
          readOnly,
        });
        const [ct, st] = InMemoryTransport.createLinkedPair();
        await Promise.all([server.connect(st), client.connect(ct)]);
        return {
          client,
          async close() {
            await client.close();
            await server.close();
          },
        };
      }
      return { id, token, api, connect };
    }

    return { owner, agent, app, ledger, runtimeLifecycle, sessionToken, userId };
  }

  function content(value: string): KnowledgeMutationInput["content"] {
    return {
      kind: "fact",
      value: { subject: "owner", predicate: "meeting day", value: { type: "string", value } },
    };
  }

  function input(value: string, sensitive = false): KnowledgeMutationInput {
    return {
      mutationKey: randomUUID(),
      content: content(value),
      scope: { workspace: null },
      sensitivity: sensitive ? "sensitive" : "standard",
      purposes: ["planning"],
      evidence: [
        { type: "statement", wording: value, sessionRef: "agent-session", messageRef: "message-1" },
      ],
      relatedRecordIds: [],
    };
  }

  async function tool(client: Client, name: string, args: Record<string, unknown>) {
    const response = await client.callTool({ name, arguments: args });
    expect(response.isError).not.toBe(true);
    return personalOsToolOutputSchema.parse(response.structuredContent).result;
  }

  it("two_agents_observe_owner_correction_and_forgetting", async () => {
    const f = await fixture();
    const a = await f.agent("Agent A");
    const b = await f.agent("Agent B");
    const first = await a.connect();
    let savedId: string;
    const original = input("Tuesday");
    const privateInput = input("private appointment detail", true);
    try {
      const tools = (await first.client.listTools()).tools;
      expect(await tool(first.client, "get_ilo_context", {})).toMatchObject({
        mcp: {
          availableTools: expect.arrayContaining([
            "get_context_for_intent",
            "search_user_knowledge",
          ]),
          memoryGuidance: expect.arrayContaining([expect.stringMatching(/supporting sources/)]),
        },
      });
      expect(
        tools
          .filter((entry) => entry._meta?.["ilo/domain"] === "knowledge")
          .map(({ name }) => name)
          .sort(),
      ).toEqual([
        "explain_context",
        "get_context_for_intent",
        "get_knowledge",
        "save_knowledge",
        "search_user_knowledge",
        "update_knowledge",
      ]);
      const saved = knowledgeReceiptSchema.parse(
        await tool(first.client, "save_knowledge", original),
      );
      savedId = saved.recordId;
      const replay = await f.app.request("/v1/knowledge", {
        method: "POST",
        headers: { authorization: `Bearer ${a.token}`, "content-type": "application/json" },
        body: JSON.stringify(original),
      });
      expect(replay.headers.get("X-Knowledge-Receipt-Version")).toBe("1");
      expect(replay.headers.get("Cache-Control")).toBe("no-store");
      expect(await replay.json()).toEqual(saved);
      const privateSave = await first.client.callTool({
        name: "save_knowledge",
        arguments: privateInput,
      });
      expect(privateSave.isError).not.toBe(true);
      expect(JSON.stringify(privateSave)).not.toContain("private appointment detail");
      const privateReceipt = knowledgePendingReviewReceiptSchema.parse(
        personalOsToolOutputSchema.parse(privateSave.structuredContent).result,
      );
      const privateReplay = await first.client.callTool({
        name: "save_knowledge",
        arguments: privateInput,
      });
      expect(JSON.stringify(privateReplay)).not.toContain("private appointment detail");
      expect(personalOsToolOutputSchema.parse(privateReplay.structuredContent).result).toEqual(
        privateReceipt,
      );
      expect(
        await f.owner.getKnowledge({ id: privateReceipt.recordId, ...planning }),
      ).toMatchObject({
        content: privateInput.content,
      });
      await expect(
        a.api.getKnowledge({ id: privateReceipt.recordId, ...planning }),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      await first.close();
    }

    const second = await b.connect();
    let previousContextId: string;
    try {
      const page = knowledgePageSchema.parse(
        await tool(second.client, "search_user_knowledge", {
          ...planning,
          text: "Tuesday",
          limit: 1,
        }),
      );
      expect(page.items).toMatchObject([{ id: savedId, content: original.content }]);
      const prior = knowledgeContextPackSchema.parse(
        await tool(second.client, "get_context_for_intent", planning),
      );
      expect(prior.stated).toMatchObject([{ id: savedId, content: original.content }]);
      expect(JSON.stringify(prior)).not.toContain("private appointment detail");
      previousContextId = prior.contextUseId;
      expect(
        knowledgeContextExplanationSchema.parse(
          await tool(second.client, "explain_context", { contextUseId: previousContextId }),
        ),
      ).toMatchObject({
        state: "available",
        references: [{ recordId: savedId, revision: 1, origin: "stated" }],
      });
    } finally {
      await second.close();
    }

    const corrected = content("Thursday");
    const revision = knowledgeReceiptSchema.parse(
      await f.owner.updateKnowledge({
        recordId: savedId,
        action: "revise",
        expectedRevision: 1,
        mutationKey: randomUUID(),
        content: corrected,
        evidence: [{ type: "statement", wording: "Thursday" }],
      }),
    );
    expect(revision.record.revision).toBe(2);
    const fresh = await b.connect();
    try {
      const pack = knowledgeContextPackSchema.parse(
        await tool(fresh.client, "get_context_for_intent", planning),
      );
      expect(pack.stated).toMatchObject([{ id: savedId, content: corrected, revision: 2 }]);
      expect(JSON.stringify(pack)).not.toContain("Tuesday");
      const stale = await fresh.client.callTool({
        name: "update_knowledge",
        arguments: {
          action: "dispute",
          recordId: savedId,
          expectedRevision: 1,
          mutationKey: randomUUID(),
        },
      });
      expect(personalOsToolOutputSchema.parse(stale.structuredContent).error).toMatchObject({
        status: 409,
      });
      const confirm = {
        action: "confirm",
        recordId: savedId,
        expectedRevision: 2,
        mutationKey: randomUUID(),
      } as const;
      expect(
        (await fresh.client.callTool({ name: "update_knowledge", arguments: confirm })).isError,
      ).toBe(true);
      await expect(b.api.updateKnowledge(confirm)).rejects.toMatchObject({ status: 403 });
      expect(
        (await f.owner.getKnowledgeHistory({ recordId: savedId, ...planning })).items.map(
          (row) => row.revision,
        ),
      ).toEqual([2, 1]);
      await expect(b.api.exportKnowledge()).rejects.toMatchObject({ status: 403 });
      const preview = await f.owner.previewKnowledgeForget({ recordId: savedId });
      expect(preview).toMatchObject({
        affected: [
          { recordId: savedId, revision: 1 },
          { recordId: savedId, revision: 2 },
        ],
        historyCount: 2,
      });
      const request = {
        previewId: preview.previewId,
        ownerEpoch: preview.ownerEpoch,
        mutationKey: randomUUID(),
      };
      const pending = await f.owner.forgetKnowledge(request);
      if (pending.outcome !== "pending_erasure") throw new Error("Expected pending erasure");
      const operation = { operationId: pending.operationId };
      expect(await f.owner.getKnowledgeForgetStatus(operation)).toMatchObject({
        status: "pending",
      });
      await expect(b.api.searchKnowledge(planning)).rejects.toMatchObject({ status: 503 });
      expect(
        f.runtimeLifecycle.startBackgroundTask("knowledge-forget", () =>
          f.app.runKnowledgeForgetting(),
        ),
      ).toBe(true);
      await f.runtimeLifecycle.waitForIdle();
      expect(await f.owner.getKnowledgeForgetStatus(operation)).toMatchObject({
        status: "completed",
      });
      expect(await f.owner.retryKnowledgeForget(operation)).toMatchObject({ status: "completed" });
      expect(await f.owner.forgetKnowledge(request)).toMatchObject({
        outcome: "forgotten",
        recordId: savedId,
      });
      expect(await a.api.saveKnowledge(original)).toEqual({
        outcome: "forgotten",
        receiptId: expect.any(String),
        recordId: savedId,
      });
      const exported = await f.owner.exportKnowledge();
      expect(exported.items.some((row) => row.id === savedId)).toBe(false);
      expect(JSON.stringify(exported)).not.toContain("Thursday");
      expect(JSON.stringify(exported)).not.toContain("Tuesday");
      expect(JSON.stringify([...f.ledger.values()])).not.toContain("Thursday");
    } finally {
      await fresh.close();
    }
    const afterForget = await b.connect();
    try {
      expect(
        await tool(afterForget.client, "explain_context", { contextUseId: previousContextId }),
      ).toEqual({ contextUseId: previousContextId, state: "unavailable" });
      const after = knowledgeContextPackSchema.parse(
        await tool(afterForget.client, "get_context_for_intent", planning),
      );
      expect(after.stated).toEqual([]);
      await f.owner.deleteAccessToken(b.id);
      const denied = await afterForget.client.callTool({
        name: "search_user_knowledge",
        arguments: planning,
      });
      expect(personalOsToolOutputSchema.parse(denied.structuredContent).error).toMatchObject({
        status: 401,
      });
    } finally {
      await afterForget.close();
    }
  });

  it("serves human-only settings and selections with strict public inputs", async () => {
    const f = await fixture();
    const a = await f.agent("Scoped agent");
    expect(await f.owner.getKnowledgeSettings()).toEqual({
      automaticPreferenceAcceptance: true,
      revision: 0,
    });
    expect(
      await f.owner.updateKnowledgeSettings({
        automaticPreferenceAcceptance: false,
        expectedRevision: 0,
        mutationKey: randomUUID(),
      }),
    ).toEqual({ automaticPreferenceAcceptance: false, revision: 1 });
    await expect(a.api.getKnowledgeSettings()).rejects.toMatchObject({ status: 403 });
    await expect(a.api.issueKnowledgeSelectionInteraction()).rejects.toMatchObject({ status: 403 });
    const { sourceEventId } = await f.owner.issueKnowledgeSelectionInteraction();
    const selection = { key: "presentation.detail", value: "concise", sourceEventId } as const;
    expect(await f.owner.recordKnowledgeSelection(selection)).toMatchObject({
      outcome: "readable",
      record: { status: "proposed", origin: "inferred" },
    });
    const context = await a.api.getKnowledgeContext(planning);
    expect(context.recentSelections).toMatchObject([selection]);
    expect(
      await a.api.explainKnowledgeContext({ contextUseId: context.contextUseId }),
    ).toMatchObject({
      state: "available",
      selectionReferences: [{ sourceEventId, validUntil: "2026-11-13T15:00:00.000Z" }],
    });
    const reset = {
      claimKey: knowledgePreferenceClaimKey(selection.key),
      expectedEpoch: context.epoch,
      mutationKey: randomUUID(),
    };
    await expect(a.api.resetKnowledgeLearning(reset)).rejects.toMatchObject({ status: 403 });
    expect(await f.owner.resetKnowledgeLearning(reset)).toEqual({ epoch: context.epoch });
    expect(
      (
        await f.app.request("/v1/knowledge?purpose=planning&purpose=review", {
          headers: { authorization: `Bearer ${a.token}` },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.app.request("/v1/knowledge/settings?unknown=true", {
          headers: { authorization: `Session ${f.sessionToken}` },
        })
      ).status,
    ).toBe(400);
  });

  it("refuses unconfigured erasure before fencing memory", async () => {
    const f = await fixture("missing");
    const original = input("Tuesday");
    original.evidence = [{ type: "statement", wording: "Tuesday" }];
    const { recordId } = knowledgeReceiptSchema.parse(await f.owner.saveKnowledge(original));
    const preview = await f.owner.previewKnowledgeForget({ recordId });
    await expect(
      f.owner.forgetKnowledge({
        previewId: preview.previewId,
        ownerEpoch: preview.ownerEpoch,
        mutationKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(await f.owner.getKnowledge({ id: recordId, ...planning })).toMatchObject({
      content: original.content,
    });
    expect((await f.owner.searchKnowledge(planning)).epoch).toBe(preview.ownerEpoch);
  });

  it("denies a registered owner mutation queued before logout commits", async () => {
    const f = await fixture();
    const reader = await f.agent("Read grant", ["knowledge:read"]);
    const original = input("Tuesday");
    original.evidence = [{ type: "statement", wording: "Tuesday" }];
    const { recordId } = knowledgeReceiptSchema.parse(await f.owner.saveKnowledge(original));
    const { queued } = await database.db.transaction(async (tx) => {
      await lockKnowledgeOwner(tx, f.userId);
      const queued = Promise.resolve(
        f.app.request(`/v1/knowledge/${recordId}/actions`, {
          method: "POST",
          headers: {
            authorization: `Session ${f.sessionToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "revise",
            expectedRevision: 1,
            mutationKey: randomUUID(),
            content: content("Thursday"),
          }),
        }),
      );
      await vi.waitFor(
        async () => {
          const waiting = await tx.execute(sql`
          SELECT pid FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
            AND pg_backend_pid() = ANY(pg_blocking_pids(pid))
        `);
          expect(waiting.rows).toHaveLength(1);
        },
        { timeout: 5000 },
      );
      await tx.delete(sessions).where(eq(sessions.tokenHash, hashToken(f.sessionToken)));
      return { queued };
    });
    const response = await queued;
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
    expect(await reader.api.getKnowledge({ id: recordId, ...planning })).toMatchObject({
      revision: 1,
      content: original.content,
    });
  });

  it("keeps an admitted erasure pending during a configured ledger outage", async () => {
    const f = await fixture("unreachable");
    const ungranted = await f.agent("Unrelated grant", ["tasks:read"]);
    const reader = await f.agent("Read grant", ["knowledge:read"]);
    const original = input("Tuesday");
    original.evidence = [{ type: "statement", wording: "Tuesday" }];
    const { recordId } = knowledgeReceiptSchema.parse(await f.owner.saveKnowledge(original));
    const { previewId, ownerEpoch } = await f.owner.previewKnowledgeForget({ recordId });
    const request = { previewId, ownerEpoch, mutationKey: randomUUID() };
    const pending = await f.owner.forgetKnowledge(request);
    if (pending.outcome !== "pending_erasure") throw new Error("Expected pending erasure");
    await f.app.runKnowledgeForgetting();
    expect(
      await f.owner.getKnowledgeForgetStatus({ operationId: pending.operationId }),
    ).toMatchObject({ status: "pending" });
    expect(await f.owner.listActiveKnowledgeForgetOperations()).toEqual([
      { operationId: pending.operationId, status: "pending" },
    ]);
    await expect(reader.api.listActiveKnowledgeForgetOperations()).rejects.toMatchObject({
      status: 403,
    });
    expect(await f.owner.forgetKnowledge(request)).toEqual(pending);
    await expect(f.owner.searchKnowledge(planning)).rejects.toMatchObject({
      status: 503,
      details: { reason: "knowledge_erasure_pending" },
    });
    for (const read of [
      () => ungranted.api.searchKnowledge(planning),
      () => ungranted.api.getKnowledge({ id: recordId, ...planning }),
      () => ungranted.api.getKnowledgeContext(planning),
    ]) {
      await expect(read()).rejects.toMatchObject({ status: 403 });
    }
    await expect(reader.api.searchKnowledge(planning)).rejects.toMatchObject({ status: 503 });
    await expect(reader.api.saveKnowledge(input("Wednesday"))).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      reader.api.updateKnowledge({
        action: "dispute",
        recordId,
        expectedRevision: 1,
        mutationKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
