import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createApiClient } from "@personal-os/api-client";
import {
  accessTokens,
  createDatabaseClient,
  type DatabaseClient,
  knowledgeRecords,
  knowledgeTombstones,
  migrateDatabase,
  sessions,
  users,
} from "@personal-os/database";
import {
  type AccessScope,
  type KnowledgeMutationInput,
  knowledgeContextPackSchema,
  knowledgeCoreSchema,
  knowledgePageSchema,
  knowledgeReceiptSchema,
  knowledgeTagMergeSchema,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { createApp } from "../../apps/api/src/app.js";
import { loadConfig } from "../../apps/api/src/config.js";
import { lockKnowledgeOwner } from "../../apps/api/src/knowledge/access.js";
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

  async function fixture() {
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

    return { owner, agent, app, runtimeLifecycle, sessionToken, userId };
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
      tags: ["fixture"],
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

  it("two_agents_observe_owner_correction_trash_and_deletion", async () => {
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
        "get_context_for_intent",
        "get_knowledge",
        "merge_knowledge_tags",
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
      // Sensitive memory is readable by agents; only the person's block hides it.
      const privateReceipt = knowledgeReceiptSchema.parse(
        await tool(first.client, "save_knowledge", privateInput),
      );
      expect(privateReceipt.record).toMatchObject({
        sensitivity: "sensitive",
        content: privateInput.content,
      });
      await f.owner.updateKnowledge({
        recordId: privateReceipt.recordId,
        action: "set_access",
        expectedRevision: 1,
        mutationKey: randomUUID(),
        agentAccess: "blocked",
      });
      const privateReplay = await first.client.callTool({
        name: "save_knowledge",
        arguments: privateInput,
      });
      expect(JSON.stringify(privateReplay)).not.toContain("private appointment detail");
      expect(personalOsToolOutputSchema.parse(privateReplay.structuredContent).result).toEqual({
        receiptId: privateReceipt.receiptId,
        recordId: privateReceipt.recordId,
        outcome: "forgotten",
      });
      expect(
        await f.owner.getKnowledge({ id: privateReceipt.recordId, ...planning }),
      ).toMatchObject({
        content: privateInput.content,
        agentAccess: "blocked",
      });
      await expect(
        a.api.getKnowledge({ id: privateReceipt.recordId, ...planning }),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      await first.close();
    }

    const second = await b.connect();
    try {
      const page = knowledgePageSchema.parse(
        await tool(second.client, "search_user_knowledge", {
          ...planning,
          text: "Tuesday",
          limit: 1,
        }),
      );
      expect(page.items).toMatchObject([{ id: savedId, content: original.content }]);
      // Tags merge through MCP; the person reads the index and undoes the merge over HTTP.
      const merge = knowledgeTagMergeSchema.parse(
        await tool(second.client, "merge_knowledge_tags", {
          from: "Fixture",
          into: "meetings",
          mutationKey: randomUUID(),
        }),
      );
      expect(merge).toMatchObject({ from: "fixture", into: "meetings", undoneAt: null });
      const tagged = knowledgePageSchema.parse(
        await tool(second.client, "search_user_knowledge", { tags: ["fixture"] }),
      );
      expect(tagged.items).toMatchObject([{ id: savedId, tags: ["meetings"] }]);
      // Agents get canonical tags and counts only; the person also sees aliases.
      expect(await b.api.listKnowledgeTags()).toEqual({
        tags: [{ name: "meetings", count: 1 }],
        aliases: [],
      });
      expect(await f.owner.listKnowledgeTags()).toEqual({
        tags: [{ name: "meetings", count: 2 }],
        aliases: [{ alias: "fixture", name: "meetings", mergeId: merge.mergeId }],
      });
      const undo = { mergeId: merge.mergeId, mutationKey: randomUUID() };
      await expect(b.api.unmergeKnowledgeTags(undo)).rejects.toMatchObject({ status: 403 });
      expect(await f.owner.unmergeKnowledgeTags(undo)).toMatchObject({
        from: "fixture",
        into: "meetings",
      });
      expect(await f.owner.getKnowledge({ id: savedId })).toMatchObject({ tags: ["fixture"] });
      const prior = knowledgeContextPackSchema.parse(
        await tool(second.client, "get_context_for_intent", planning),
      );
      expect(prior.stated).toMatchObject([{ id: savedId, content: original.content }]);
      expect(JSON.stringify(prior)).not.toContain("private appointment detail");
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
      const identity = { recordId: savedId, expectedRevision: 2 };
      const trash = { ...identity, action: "trash" as const, mutationKey: randomUUID() };
      expect(await f.owner.updateKnowledge(trash)).toEqual({
        outcome: "trashed",
        receiptId: expect.any(String),
        recordId: savedId,
      });
      expect((await b.api.searchKnowledge(planning)).items).toEqual([]);
      await expect(b.api.getKnowledge({ id: savedId, ...planning })).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        b.api.updateKnowledge({ ...identity, action: "restore", mutationKey: randomUUID() }),
      ).rejects.toMatchObject({ status: 403 });
      expect(await a.api.saveKnowledge(original)).toEqual({
        outcome: "forgotten",
        receiptId: expect.any(String),
        recordId: savedId,
      });
      const [inTrash] = (await f.owner.searchKnowledge({ ...planning, status: "trashed" })).items;
      expect(inTrash).toMatchObject({ id: savedId, trashGroupId: savedId });
      const deletion = {
        ...identity,
        action: "delete_now" as const,
        expectedTrashVersion: inTrash?.trashVersion ?? -1,
        mutationKey: randomUUID(),
      };
      expect(await f.owner.updateKnowledge(deletion)).toMatchObject({
        outcome: "forgotten",
        recordId: savedId,
      });
      expect(await f.owner.updateKnowledge(trash)).toMatchObject({ outcome: "forgotten" });
      expect(await f.owner.getKnowledge({ id: savedId, ...planning })).toMatchObject({
        id: savedId,
        state: "forgotten",
      });
      // Delete now already erased the record; give the background pass one of its own to purge.
      const expiring = input("expired trash");
      expiring.evidence = [{ type: "statement", wording: "expired trash" }];
      const { recordId: expiredId } = knowledgeReceiptSchema.parse(
        await f.owner.saveKnowledge(expiring),
      );
      await f.owner.updateKnowledge({
        recordId: expiredId,
        expectedRevision: 1,
        action: "trash",
        mutationKey: randomUUID(),
      });
      await database.db
        .update(knowledgeRecords)
        .set({ trashedAt: new Date(now().getTime() - 31 * 24 * 60 * 60_000) })
        .where(eq(knowledgeRecords.id, expiredId));
      expect(
        f.runtimeLifecycle.startBackgroundTask("knowledge-purge", () => f.app.runKnowledgePurge()),
      ).toBe(true);
      await f.runtimeLifecycle.waitForIdle();
      expect(
        await database.db
          .select({ id: knowledgeTombstones.recordId })
          .from(knowledgeTombstones)
          .where(eq(knowledgeTombstones.recordId, expiredId)),
      ).toEqual([{ id: expiredId }]);
      const exported = await f.owner.exportKnowledge();
      expect(exported.items.some((row) => row.id === savedId)).toBe(false);
      expect(JSON.stringify(exported)).not.toContain("Thursday");
      expect(JSON.stringify(exported)).not.toContain("Tuesday");
    } finally {
      await fresh.close();
    }
    const afterDeletion = await b.connect();
    try {
      const after = knowledgeContextPackSchema.parse(
        await tool(afterDeletion.client, "get_context_for_intent", planning),
      );
      expect(after.stated).toEqual([]);
      await f.owner.deleteAccessToken(b.id);
      const denied = await afterDeletion.client.callTool({
        name: "search_user_knowledge",
        arguments: planning,
      });
      expect(personalOsToolOutputSchema.parse(denied.structuredContent).error).toMatchObject({
        status: 401,
      });
    } finally {
      await afterDeletion.close();
    }
  });

  it("two_agents_share_memory_across_sessions", async () => {
    const f = await fixture();
    const a = await f.agent("Agent A");
    const b = await f.agent("Agent B");
    const preference: KnowledgeMutationInput = {
      mutationKey: randomUUID(),
      content: {
        kind: "preference",
        value: {
          subject: "owner",
          key: "meeting_time",
          value: { type: "string", value: "Mornings before ten" },
        },
      },
      scope: { workspace: null },
      core: true,
      tags: ["Scheduling", "meetings"],
      evidence: [
        {
          type: "statement",
          wording: "I prefer meetings in the morning, before ten.",
          sessionRef: "agent-a-session",
          messageRef: "message-1",
        },
      ],
    };

    const sessionA = await a.connect();
    let recordId: string;
    try {
      const saved = knowledgeReceiptSchema.parse(
        await tool(sessionA.client, "save_knowledge", preference),
      );
      recordId = saved.recordId;
      expect(saved.record).toMatchObject({
        core: true,
        origin: "stated",
        tags: ["meetings", "scheduling"],
      });
    } finally {
      await sessionA.close();
    }

    // Agent B holds its own token and starts a fresh session.
    const sessionB = await b.connect();
    try {
      const context = (await tool(sessionB.client, "get_ilo_context", {})) as {
        memory?: unknown;
        mcp: { memoryGuidance?: string[] };
      };
      expect(context.mcp.memoryGuidance).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/memory core/),
          expect.stringMatching(/tag index/),
        ]),
      );
      const core = knowledgeCoreSchema.parse(context.memory);
      expect(core.records).toEqual([
        {
          id: recordId,
          text: "Meeting time: Mornings before ten",
          origin: "stated",
          ownerHeld: false,
          tags: ["meetings", "scheduling"],
          updatedAt: now().toISOString(),
        },
      ]);
      expect(core.tagIndex).toEqual(
        expect.arrayContaining([
          { name: "meetings", count: 1 },
          { name: "scheduling", count: 1 },
        ]),
      );
      const byTag = knowledgePageSchema.parse(
        await tool(sessionB.client, "search_user_knowledge", { tags: ["scheduling"] }),
      );
      expect(byTag.items).toMatchObject([{ id: recordId, content: preference.content }]);

      // The person trashes it from a signed-in session over HTTP.
      const trash = await f.app.request(`/v1/knowledge/${recordId}/actions`, {
        method: "POST",
        headers: {
          authorization: `Session ${f.sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "trash",
          expectedRevision: 1,
          mutationKey: randomUUID(),
        }),
      });
      expect(trash.status).toBe(200);
      expect(await trash.json()).toMatchObject({ outcome: "trashed", recordId });

      const afterTrash = knowledgePageSchema.parse(
        await tool(sessionB.client, "search_user_knowledge", { tags: ["scheduling"] }),
      );
      expect(afterTrash.items).toEqual([]);
      const freshCore = knowledgeCoreSchema.parse(
        ((await tool(sessionB.client, "get_ilo_context", {})) as { memory?: unknown }).memory,
      );
      expect(freshCore.records).toEqual([]);
      expect(JSON.stringify(freshCore)).not.toContain("Mornings before ten");
    } finally {
      await sessionB.close();
    }
  });

  it("rejects repeated purposes and omits the removed learning routes", async () => {
    const f = await fixture();
    const a = await f.agent("Scoped agent");
    expect(
      (
        await f.app.request("/v1/knowledge?purpose=planning&purpose=review", {
          headers: { authorization: `Bearer ${a.token}` },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.app.request("/v1/knowledge/settings", {
          headers: { authorization: `Session ${f.sessionToken}` },
        })
      ).status,
    ).toBe(404);
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
    // Longer than the five-second lock poll, so setup plus a slow poll can still finish.
  }, 20_000);

  it("denies memory reads and writes outside the credential's grant", async () => {
    const f = await fixture();
    const ungranted = await f.agent("Unrelated grant", ["tasks:read"]);
    const reader = await f.agent("Read grant", ["knowledge:read"]);
    const original = input("Tuesday");
    original.evidence = [{ type: "statement", wording: "Tuesday" }];
    const { recordId } = knowledgeReceiptSchema.parse(await f.owner.saveKnowledge(original));
    for (const read of [
      () => ungranted.api.searchKnowledge(planning),
      () => ungranted.api.getKnowledge({ id: recordId, ...planning }),
      () => ungranted.api.getKnowledgeContext(planning),
    ]) {
      await expect(read()).rejects.toMatchObject({ status: 403 });
    }
    expect((await reader.api.searchKnowledge(planning)).items).toMatchObject([{ id: recordId }]);
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
