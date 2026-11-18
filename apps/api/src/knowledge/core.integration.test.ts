import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  createDatabaseClient,
  type DatabaseClient,
  knowledgeRecords,
  migrateDatabase,
  sessions,
  users,
} from "@personal-os/database";
import {
  type AccessScope,
  type KnowledgeCore,
  type KnowledgeLifecycleInput,
  type KnowledgeMutationInput,
  type KnowledgeRecord,
  knowledgeCoreHint,
  knowledgeCoreMaxBytes,
  knowledgeCoreSchema,
  knowledgeCoreTagBytes,
  knowledgeReceiptSchema,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { hashToken } from "../security.js";
import type { Principal } from "../types.js";
import { createKnowledgeCoreService } from "./core-service.js";
import { createKnowledgeLifecycleService } from "./lifecycle-service.js";
import { createKnowledgeRecordService } from "./record-service.js";
import { createKnowledgeTagService } from "./tag-service.js";

let container: StartedPostgreSqlContainer;
let database: DatabaseClient;
const now = () => new Date("2026-11-15T12:00:00Z");
const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const config = () => ({ db: database.db, now, encryptionKey });

function app() {
  return createApp({
    db: database.db,
    now,
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

/** Agents may record a statement only with its chat references. */
function statement(wording: string) {
  return { type: "statement" as const, wording, sessionRef: "chat", messageRef: "message" };
}

function fact(
  value: string,
  overrides: Partial<KnowledgeMutationInput> = {},
  subject = `Subject ${randomUUID()}`,
) {
  return {
    mutationKey: randomUUID(),
    content: {
      kind: "fact",
      value: { subject, predicate: "detail", value: { type: "string", value } },
    },
    scope: { workspace: null },
    core: true,
    tags: ["fixture"],
    evidence: [statement("I said this myself.")],
    ...overrides,
  } satisfies KnowledgeMutationInput;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Action = DistributiveOmit<
  KnowledgeLifecycleInput,
  "recordId" | "expectedRevision" | "mutationKey"
>;

async function setUp() {
  const userId = randomUUID();
  const sessionId = randomUUID();
  const sessionToken = randomUUID();
  await database.db.insert(users).values({
    id: userId,
    email: `${userId}@example.test`,
    displayName: "Owner",
    passwordHash: "unused",
    planningTimezone: "UTC",
  });
  await database.db.insert(sessions).values({
    id: sessionId,
    userId,
    tokenHash: hashToken(sessionToken),
    expiresAt: new Date(now().getTime() + 60 * 60_000),
  });
  const owner: Principal = {
    userId,
    actorId: userId,
    actorType: "user",
    sessionId,
    scopes: new Set(),
  };
  async function newAgent(
    scopes: AccessScope[] = ["knowledge:read", "knowledge:write"],
  ): Promise<Principal & { token: string }> {
    const actorId = randomUUID();
    const token = randomUUID();
    await database.db.insert(accessTokens).values({
      id: actorId,
      userId,
      name: "Memory agent",
      tokenHash: hashToken(token),
      scopes,
    });
    return { userId, actorId, actorType: "agent", scopes: new Set(scopes), token };
  }
  const records = createKnowledgeRecordService(config());
  const lifecycle = createKnowledgeLifecycleService(config());
  const tags = createKnowledgeTagService(config());
  const core = createKnowledgeCoreService({
    db: database.db,
    now,
    tags,
  });
  return {
    owner,
    sessionToken,
    tags,
    agent: await newAgent(),
    newAgent,
    core,
    async save(principal: Principal, input: KnowledgeMutationInput) {
      return knowledgeReceiptSchema.parse(await records.create(principal, input)).record;
    },
    act(principal: Principal, record: Pick<KnowledgeRecord, "id" | "revision">, action: Action) {
      return lifecycle.mutate(principal, {
        ...action,
        recordId: record.id,
        expectedRevision: record.revision,
        mutationKey: randomUUID(),
      } as KnowledgeLifecycleInput);
    },
    /** An agent token by default; `Session` sends the owner's signed-in session. */
    async context(token: string, scheme: "Bearer" | "Session" = "Bearer") {
      const response = await app().request("https://api.example.com/v1/assistant/context", {
        headers: { authorization: `${scheme} ${token}` },
      });
      expect(response.status).toBe(200);
      // The context can carry memory, so no cache may keep it.
      expect(response.headers.get("cache-control")).toBe("no-store");
      return ((await response.json()) as { context: { memory?: KnowledgeCore } }).context;
    },
  };
}

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const ids = (memory: KnowledgeCore) => memory.records.map(({ id }) => id);

describe("session-start memory core", () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  it("fresh_session_receives_core_preference", async () => {
    const f = await setUp();
    const saved = await f.save(f.agent, {
      mutationKey: randomUUID(),
      content: {
        kind: "preference",
        value: { subject: "owner", key: "coffee_order", value: { type: "string", value: "Oat" } },
      },
      scope: { workspace: null },
      core: true,
      tags: ["coffee", "Morning routine"],
      evidence: [statement("Oat flat white, please.")],
    });
    const fresh = await f.newAgent(["knowledge:read"]);
    const context = await f.context(fresh.token);
    const memory = knowledgeCoreSchema.parse(context.memory);
    expect(memory.records).toEqual([
      {
        id: saved.id,
        text: "Coffee order: Oat",
        tags: ["coffee", "morning-routine"],
        origin: "stated",
        ownerHeld: false,
        updatedAt: now().toISOString(),
      },
    ]);
    expect(memory.tagIndex).toEqual(
      expect.arrayContaining([
        { name: "coffee", count: 1 },
        { name: "morning-routine", count: 1 },
      ]),
    );
    expect(memory.counts).toEqual({ active: 1, conflicts: 0, archived: 0 });
    expect(memory.truncated).toEqual({ records: false, tags: false });
    expect(memory.hint).toBe(
      "Search memory with search_user_knowledge for anything not listed here.",
    );
    expect(memory.hint).toBe(knowledgeCoreHint);
  });

  it("core_excludes_sensitive_blocked_trashed_archived_noncore", async () => {
    const f = await setUp();
    const included = await f.save(f.owner, fact("Included"));
    const sensitive = await f.save(f.owner, fact("Sensitive", { sensitivity: "sensitive" }));
    // Standard on its own, but cites a sensitive record, so it reads as sensitive.
    const effectivelySensitive = await f.save(
      f.owner,
      fact("Derived", {
        evidence: [
          {
            type: "domain_record",
            domain: "knowledge",
            id: sensitive.id,
            revision: sensitive.revision,
          },
        ],
      }),
    );
    const blocked = await f.save(f.owner, fact("Blocked"));
    await f.act(f.owner, blocked, { action: "set_access", agentAccess: "blocked" });
    const trashed = await f.save(f.owner, fact("Trashed"));
    await f.act(f.owner, trashed, { action: "trash" });
    const archived = await f.save(f.owner, fact("Archived"));
    await f.act(f.owner, archived, { action: "archive" });
    const noncore = await f.save(f.owner, fact("Not core", { core: false }));
    const expired = await f.save(
      f.owner,
      fact("Expired", { validity: { validFrom: null, validUntil: "2026-11-15T11:00:00Z" } }),
    );
    const future = await f.save(
      f.owner,
      fact("Future", { validity: { validFrom: "2026-12-01T00:00:00Z", validUntil: null } }),
    );
    const finance = await f.save(
      f.owner,
      fact("Finance only", { scope: { workspace: "finances" } }),
    );

    const agentMemory = await f.core.build(f.agent);
    expect(ids(agentMemory)).toEqual([included.id]);
    // Active and current for this agent: included, sensitive, derived and not core. Archived
    // counts apart; expired and not-yet-valid memory is not active. Blocked, trashed and
    // Finance-only memory never moves an agent's counts.
    expect(agentMemory.counts).toEqual({ active: 4, conflicts: 0, archived: 1 });
    const hidden = new Set([blocked.id, trashed.id, finance.id]);
    expect(agentMemory.records.some(({ id }) => hidden.has(id))).toBe(false);

    // The owner sees blocked and Finance-only memory; sensitivity still keeps memory out.
    const ownerMemory = await f.core.build(f.owner);
    expect(new Set(ids(ownerMemory))).toEqual(new Set([included.id, blocked.id, finance.id]));
    expect(ownerMemory.counts).toEqual({ active: 6, conflicts: 0, archived: 1 });
    for (const excluded of [sensitive, effectivelySensitive, noncore, expired, future, archived])
      expect(ids(ownerMemory)).not.toContain(excluded.id);

    // A Finance-scoped agent sees the Finance memory too.
    const financeAgent = await f.newAgent(["knowledge:read", "finances:read"]);
    expect(new Set(ids(await f.core.build(financeAgent)))).toEqual(
      new Set([included.id, finance.id]),
    );
  });

  it("counts_conflicts_the_caller_can_see", async () => {
    const f = await setUp();
    const original = await f.save(f.owner, fact("Tuesday"));
    await f.act(f.agent, original, {
      action: "revise",
      content: {
        ...original.content,
        value: { ...original.content.value, value: { type: "string", value: "Wednesday" } },
      } as KnowledgeRecord["content"],
      evidence: [statement("Make it Wednesday.")],
    });
    // The person's value and the agent's pending proposal both show as a conflict; only the
    // active one is core.
    const memory = await f.core.build(f.agent);
    expect(memory.counts).toEqual({ active: 1, conflicts: 2, archived: 0 });
    expect(ids(memory)).toEqual([original.id]);
    // Once the person blocks the original, it leaves this agent's counts entirely.
    await f.act(f.owner, original, { action: "set_access", agentAccess: "blocked" });
    expect((await f.core.build(f.agent)).counts).toEqual({ active: 0, conflicts: 0, archived: 0 });
  });

  it("core_tag_index_omits_tags_only_on_sensitive_memory", async () => {
    const f = await setUp();
    const sensitive = await f.save(
      f.owner,
      fact("Weekly session", { sensitivity: "sensitive", core: false, tags: ["therapy"] }),
    );
    // Standard on its own; its sensitive source makes it effectively sensitive.
    await f.save(
      f.owner,
      fact("Follow-up plan", {
        core: false,
        tags: ["diagnosis"],
        evidence: [
          {
            type: "domain_record",
            domain: "knowledge",
            id: sensitive.id,
            revision: sensitive.revision,
          },
        ],
      }),
    );
    await f.save(f.owner, fact("Everyday", { tags: ["fixture"] }));
    for (const principal of [f.agent, f.owner]) {
      const memory = await f.core.build(principal);
      expect(memory.tagIndex).toEqual([{ name: "fixture", count: 1 }]);
      expect(memory.truncated.tags).toBe(false);
      // Counts are numbers only and still include sensitive memory (§5.2).
      expect(memory.counts.active).toBe(3);
    }
    // An explicit tag listing is a request, not automatic loading: it still lists both.
    const reader = await f.newAgent(["knowledge:read"]);
    const response = await app().request("https://api.example.com/v1/knowledge/tags", {
      headers: { authorization: `Bearer ${reader.token}` },
    });
    expect(response.status).toBe(200);
    const listed = (await response.json()) as { tags: { name: string }[] };
    expect(listed.tags.map(({ name }) => name).sort()).toEqual(["diagnosis", "fixture", "therapy"]);
  });

  it("owner_session_receives_memory_over_http", async () => {
    const f = await setUp();
    const saved = await f.save(f.owner, fact("Owner session"));
    const context = await f.context(f.sessionToken, "Session");
    expect(context).toMatchObject({ identity: { actorType: "user" } });
    const memory = knowledgeCoreSchema.parse(context.memory);
    expect(memory.records).toEqual([expect.objectContaining({ id: saved.id, ownerHeld: true })]);
  });

  it("token_narrowed_between_sessions_is_enforced", async () => {
    const f = await setUp();
    const agent = await f.newAgent(["knowledge:read", "finances:read"]);
    const general = await f.save(f.owner, fact("General"));
    const finance = await f.save(f.owner, fact("Budget", { scope: { workspace: "finances" } }));
    expect(new Set(ids(await f.core.build(agent)))).toEqual(new Set([general.id, finance.id]));
    // The person narrows the token between two sessions; the same service and principal
    // (whose cached grant still lists finances:read) must not see Finance memory again.
    await database.db
      .update(accessTokens)
      .set({ scopes: ["knowledge:read"] })
      .where(eq(accessTokens.id, agent.actorId));
    const memory = await f.core.build(agent);
    expect(ids(memory)).toEqual([general.id]);
    expect(memory.counts).toEqual({ active: 1, conflicts: 0, archived: 0 });
    expect(memory.tagIndex).toEqual([{ name: "fixture", count: 1 }]);
    // Revocation applies to the next session too.
    await database.db
      .update(accessTokens)
      .set({ revokedAt: now() })
      .where(eq(accessTokens.id, agent.actorId));
    await expect(f.core.build(agent)).rejects.toMatchObject({ status: 403 });
  });

  it("orders_owner_held_then_stated_then_inferred_by_freshness", async () => {
    const f = await setUp();
    const stated = await f.save(f.agent, fact("Agent stated"));
    const inferred = await f.save(f.agent, {
      mutationKey: randomUUID(),
      content: {
        kind: "inference",
        value: {
          subject: "owner",
          proposition: "Prefers mornings for focused work.",
          uncertainty: "Based on two weeks of calendar use.",
          evidenceIds: [],
          reviewCondition: "Revisit if the pattern changes.",
        },
      },
      scope: { workspace: null },
      core: true,
      tags: ["focus"],
    });
    const owned = await f.save(f.owner, fact("Owner held"));
    const memory = await f.core.build(f.agent);
    expect(ids(memory)).toEqual([owned.id, stated.id, inferred.id]);
    expect(memory.records[2]).toMatchObject({ origin: "inferred", ownerHeld: false });
    // Within one rank the fresher record leads.
    const newer = await f.save(f.agent, fact("Agent stated later"));
    // The older one gets the smaller ID, so the ID tie-break alone would put it first.
    const [older, fresher] = [stated.id, newer.id].sort() as [string, string];
    await database.db
      .update(knowledgeRecords)
      .set({ updatedAt: new Date(now().getTime() - 60_000) })
      .where(eq(knowledgeRecords.id, older));
    const ranked = ids(await f.core.build(f.agent));
    expect(ranked.indexOf(fresher)).toBeLessThan(ranked.indexOf(older));
    expect(ranked.indexOf(fresher)).toBeGreaterThan(ranked.indexOf(owned.id));
  });

  it("core_discloses_a_source_chain_in_linear_work", async () => {
    /** Statements a core build runs, counted on the transaction it opens. */
    async function buildQueries(length: number) {
      const f = await setUp();
      let previous: KnowledgeRecord | undefined;
      for (let i = 0; i < length; i++) {
        const evidence = previous
          ? [
              {
                type: "domain_record" as const,
                domain: "knowledge" as const,
                id: previous.id,
                revision: 1,
              },
            ]
          : [{ type: "statement" as const, wording: "I said this myself." }];
        previous = await f.save(f.owner, fact(`Chain ${i}`, { evidence }));
      }
      let queries = 0;
      const counted = new Set(["select", "selectDistinct", "execute"]);
      const db = new Proxy(database.db, {
        get(target, property, receiver) {
          if (property !== "transaction") return Reflect.get(target, property, receiver);
          return (run: (tx: unknown) => Promise<unknown>) =>
            target.transaction((tx) =>
              run(
                new Proxy(tx, {
                  get(inner, name) {
                    const value = Reflect.get(inner, name);
                    if (typeof value !== "function") return value;
                    return (...args: unknown[]) => {
                      if (typeof name === "string" && counted.has(name)) queries += 1;
                      return value.apply(inner, args);
                    };
                  },
                }),
              ),
            );
        },
      });
      const core = createKnowledgeCoreService({ db, now, tags: f.tags });
      expect((await core.build(f.agent)).counts.active).toBe(length);
      return queries;
    }
    const short = await buildQueries(8);
    const long = await buildQueries(16);
    // Twice the chain costs at most twice the statements (here 32 and 64). Walking every prefix
    // again, as each record did before, cost 68 and 260.
    expect(long).toBeLessThanOrEqual(2 * short);
  });

  it("core_budget_counts_utf8_bytes", async () => {
    const f = await setUp();
    const texts = new Map<string, string>();
    for (let i = 0; i < 40; i++) {
      const value = `🌅 朝のコーヒーは静かに飲む ${i} ☕️ 早起き`.repeat(4);
      const saved = await f.save(f.owner, fact(value, { tags: ["朝"] }));
      texts.set(saved.id, value);
    }
    const memory = await f.core.build(f.agent);
    expect(bytes(memory)).toBeLessThanOrEqual(knowledgeCoreMaxBytes);
    expect(memory.truncated.records).toBe(true);
    expect(memory.records.length).toBeGreaterThan(0);
    expect(memory.records.length).toBeLessThan(40);
    for (const entry of memory.records) {
      if (!("text" in entry)) throw new Error("Expected a full core record.");
      expect(entry.text.endsWith(texts.get(entry.id) ?? "missing")).toBe(true);
    }
  });

  it("tag_index_keeps_its_share", async () => {
    const f = await setUp();
    const tag = (n: number) => `long-shared-tag-name-number-${String(n).padStart(3, "0")}`;
    for (let i = 0; i < 30; i++) {
      await f.save(
        f.owner,
        fact("x".repeat(900), {
          tags: Array.from({ length: 8 }, (_, j) => tag((i * 8 + j) % 50)),
        }),
      );
    }
    const memory = await f.core.build(f.agent);
    expect(memory.tagIndex.length).toBeGreaterThan(0);
    expect(bytes(memory.tagIndex)).toBeLessThanOrEqual(knowledgeCoreTagBytes);
    expect(memory.truncated.tags).toBe(true);
    expect(memory.records.length).toBeGreaterThan(0);
    expect(memory.truncated.records).toBe(true);
    expect(bytes(memory)).toBeLessThanOrEqual(knowledgeCoreMaxBytes);
  });

  it("oversized_record_becomes_label", async () => {
    const f = await setUp();
    const saved = await f.save(f.owner, {
      ...fact("y".repeat(1500), {}, "owner"),
      content: {
        kind: "fact",
        value: {
          subject: "owner",
          predicate: "travel_notes",
          value: { type: "string", value: "y".repeat(1500) },
        },
      },
    });
    const memory = await f.core.build(f.agent);
    expect(memory.records).toEqual([{ id: saved.id, label: "Travel notes" }]);
    expect(memory.truncated.records).toBe(false);
  });

  it("oversized_record_with_huge_title_keeps_a_short_label", async () => {
    const f = await setUp();
    const subject = "🧭 compass\n\nheading ".repeat(90);
    const saved = await f.save(f.owner, fact("value", { tags: ["navigation"] }, subject));
    const memory = await f.core.build(f.agent);
    const [entry] = memory.records;
    if (!entry || !("label" in entry)) throw new Error("Expected a label entry.");
    expect(entry.id).toBe(saved.id);
    const characters = Array.from(entry.label);
    expect(characters).toHaveLength(120);
    expect(entry.label.endsWith("…")).toBe(true);
    expect(entry.label.startsWith("🧭 compass heading 🧭 compass heading")).toBe(true);
    expect(entry.label).not.toMatch(/\n/u);
    // Cut on a code point: no lone surrogate survives a UTF-8 round trip.
    expect(Buffer.from(entry.label, "utf8").toString("utf8")).toBe(entry.label);
    expect(memory.truncated.records).toBe(false);
  });

  it("no_memory_section_without_scope", async () => {
    const f = await setUp();
    await f.save(f.owner, fact("Hidden from tasks agents"));
    const tasksAgent = await f.newAgent(["tasks:read"]);
    const context = await f.context(tasksAgent.token);
    expect(context).not.toHaveProperty("memory");
    expect((await f.context(f.agent.token)).memory?.records).toHaveLength(1);
  });
});
