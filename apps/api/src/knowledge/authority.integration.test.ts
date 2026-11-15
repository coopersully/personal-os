import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  createDatabaseClient,
  type DatabaseClient,
  executionPolicySettings,
  financeAgentSettings,
  financeAutomationSettings,
  knowledgeRecords,
  migrateDatabase,
  sessions,
  users,
} from "@personal-os/database";
import {
  type AccessScope,
  type KnowledgeLifecycleInput,
  type KnowledgeMutationInput,
  type KnowledgeRecord,
  knowledgeContextPackSchema,
  knowledgePurposeSchema,
  knowledgeReceiptSchema,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { hashToken } from "../security.js";
import type { Principal } from "../types.js";
import { createKnowledgeContextService } from "./context-service.js";
import { createKnowledgeLifecycleService } from "./lifecycle-service.js";
import { createKnowledgeRecordService } from "./record-service.js";
import { createKnowledgeSearchService } from "./search-service.js";

type Fixture = Awaited<ReturnType<typeof setUp>>;
let container: StartedPostgreSqlContainer;
let database: DatabaseClient;
const now = () => new Date("2026-11-15T12:00:00Z");
const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const config = () => ({ db: database.db, now, encryptionKey });
const chatStatement = (wording: string) => ({
  type: "statement" as const,
  wording,
  sessionRef: "chat-session",
  messageRef: "chat-message",
});

function fact(value: string, overrides: Partial<KnowledgeMutationInput> = {}) {
  return {
    mutationKey: randomUUID(),
    content: {
      kind: "fact",
      value: {
        subject: `Subject ${randomUUID()}`,
        predicate: "preferred day",
        value: { type: "string", value },
      },
    },
    scope: { workspace: null },
    evidence: [{ type: "statement", wording: `I prefer ${value}.` }],
    ...overrides,
  } satisfies KnowledgeMutationInput;
}

async function setUp() {
  const userId = randomUUID();
  const sessionId = randomUUID();
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
    tokenHash: hashToken(randomUUID()),
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
  const search = createKnowledgeSearchService(config());
  const context = createKnowledgeContextService(config());
  return {
    owner,
    agent: await newAgent(),
    newAgent,
    records,
    lifecycle,
    search,
    context,
    async save(principal: Principal, input: KnowledgeMutationInput) {
      return knowledgeReceiptSchema.parse(await records.create(principal, input)).record;
    },
    async act(
      principal: Principal,
      record: Pick<KnowledgeRecord, "id" | "revision">,
      action: DistributiveOmit<
        KnowledgeLifecycleInput,
        "recordId" | "expectedRevision" | "mutationKey"
      >,
    ) {
      const result = await lifecycle.mutate(principal, {
        ...action,
        recordId: record.id,
        expectedRevision: record.revision,
        mutationKey: randomUUID(),
      } as KnowledgeLifecycleInput);
      return knowledgeReceiptSchema.parse(result).record;
    },
    async get(principal: Principal, id: string) {
      const result = await records.get(principal, { id });
      if ("state" in result) throw new Error("Expected a readable record.");
      return result;
    },
    async ids(principal: Principal, query: Parameters<typeof search.search>[1] = {}) {
      const page = await search.search(principal, query);
      return page.items.map((item) => item.id);
    },
  };
}
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

describe("agent-managed memory authority", () => {
  let f: Fixture;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  beforeEach(async () => {
    f = await setUp();
  });
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  it("agent_inference_is_active_and_labeled", async () => {
    const saved = await f.save(f.agent, {
      mutationKey: randomUUID(),
      content: {
        kind: "inference",
        value: {
          subject: "owner",
          proposition: "Prefers mornings for focused work.",
          uncertainty: "Seen in three calendars.",
          evidenceIds: [],
          reviewCondition: "Revisit if afternoons fill up.",
        },
      },
      scope: { workspace: null },
      evidence: [{ type: "observation", reference: "calendar pattern" }],
    });
    expect(saved).toMatchObject({ status: "active", origin: "inferred", ownerHeld: false });
  });

  it("agent_chat_statement_is_stated_not_owner_held", async () => {
    const saved = await f.save(f.agent, fact("Tuesday", { evidence: [chatStatement("Tuesday")] }));
    expect(saved).toMatchObject({ status: "active", origin: "stated", ownerHeld: false });
    // An unsourced agent save of a typed claim is active too, labeled inferred.
    const unsourced = await f.save(f.agent, fact("Friday", { evidence: [] }));
    expect(unsourced).toMatchObject({ status: "active", origin: "inferred", ownerHeld: false });
  });

  it("owner_entry_is_owner_held", async () => {
    const saved = await f.save(f.owner, fact("Tuesday", { core: true }));
    expect(saved).toMatchObject({
      status: "active",
      origin: "stated",
      ownerHeld: true,
      core: true,
      agentAccess: "allowed",
      lastConfirmedAt: null,
    });
    const [row] = await database.db
      .select()
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.id, saved.id));
    expect(row).toMatchObject({ ownerHeld: true, core: true, agentAccess: "allowed" });
    // An agent-written record the person confirms becomes owner-held.
    const agentSaved = await f.save(f.agent, fact("Friday", { evidence: [chatStatement("Fri")] }));
    const confirmed = await f.act(f.owner, agentSaved, { action: "confirm" });
    expect(confirmed).toMatchObject({ ownerHeld: true, lastConfirmedAt: now().toISOString() });
  });

  it("agent_revision_of_owner_held_creates_conflict", async () => {
    const original = await f.save(f.owner, fact("Tuesday"));
    const proposal = await f.act(f.agent, original, {
      action: "revise",
      content: {
        ...original.content,
        value: { ...original.content.value, value: { type: "string", value: "Wednesday" } },
      } as KnowledgeRecord["content"],
      evidence: [chatStatement("Make it Wednesday.")],
    });
    expect(proposal.id).not.toBe(original.id);
    expect(proposal).toMatchObject({ status: "proposed", ownerHeld: false, revision: 1 });
    const unchanged = await f.get(f.owner, original.id);
    expect(unchanged).toMatchObject({ status: "active", revision: 1, content: original.content });
    expect(unchanged.conflictRecordIds).toContain(proposal.id);
    expect((await f.get(f.agent, original.id)).conflictRecordIds).toContain(proposal.id);

    // The proposal waits for the person: an agent cannot activate it.
    await expect(f.act(f.agent, proposal, { action: "archive" })).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      f.act(f.agent, proposal, { action: "resolve_conflict", keep: "proposed" }),
    ).rejects.toMatchObject({ status: 403 });

    const accepted = await f.act(f.owner, proposal, {
      action: "resolve_conflict",
      keep: "proposed",
    });
    expect(accepted).toMatchObject({ status: "active", ownerHeld: true, revision: 2 });
    expect(await f.get(f.owner, original.id)).toMatchObject({
      status: "superseded",
      supersededBy: proposal.id,
    });
  });

  it("an_agent_proposal_on_an_inference_is_linked_and_can_be_declined", async () => {
    const original = await f.save(f.owner, {
      mutationKey: randomUUID(),
      content: {
        kind: "inference",
        value: {
          subject: "owner",
          proposition: "Prefers short meetings.",
          uncertainty: "Owner said so once.",
          evidenceIds: [],
          reviewCondition: "Ask again in spring.",
        },
      },
      scope: { workspace: null },
    });
    const proposal = await f.act(f.agent, original, {
      action: "revise",
      content: {
        kind: "inference",
        value: {
          subject: "owner",
          proposition: "Prefers no meetings at all.",
          uncertainty: "Guess.",
          evidenceIds: [],
          reviewCondition: "Ask.",
        },
      },
    });
    // Inferences have no claim key; the proposal link alone marks the conflict.
    expect((await f.get(f.owner, original.id)).conflictRecordIds).toEqual([proposal.id]);
    expect((await f.get(f.owner, proposal.id)).conflictRecordIds).toEqual([original.id]);
    const declined = await f.act(f.owner, proposal, {
      action: "resolve_conflict",
      keep: "current",
    });
    expect(declined).toMatchObject({ status: "superseded", supersededBy: original.id });
    expect(await f.get(f.owner, original.id)).toMatchObject({
      status: "active",
      revision: 1,
      conflictRecordIds: [],
    });
    // Only a pending proposal can be resolved.
    await expect(
      f.act(f.owner, original, { action: "resolve_conflict", keep: "proposed" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("agent_supersede_of_owner_held_proposes_the_replacement", async () => {
    const original = await f.save(f.owner, fact("Tuesday"));
    const replacement = await f.save(
      f.agent,
      fact("Thursday", { evidence: [chatStatement("Thu")] }),
    );
    const proposed = await f.act(f.agent, original, {
      action: "supersede",
      replacementId: replacement.id,
    });
    expect(proposed).toMatchObject({ id: replacement.id, status: "proposed", revision: 2 });
    expect(await f.get(f.owner, original.id)).toMatchObject({
      status: "active",
      revision: 1,
      conflictRecordIds: [replacement.id],
    });
    // An owner-held replacement cannot be demoted into a proposal by an agent.
    const ownerReplacement = await f.save(f.owner, fact("Monday"));
    await expect(
      f.act(f.agent, original, { action: "supersede", replacementId: ownerReplacement.id }),
    ).rejects.toMatchObject({ status: 403 });
    await f.act(f.owner, proposed, { action: "resolve_conflict", keep: "proposed" });
    expect(await f.get(f.owner, original.id)).toMatchObject({
      status: "superseded",
      supersededBy: replacement.id,
    });
  });

  it("agent_can_supersede_dispute_archive_restrict_unowned", async () => {
    const statement = { evidence: [chatStatement("noted")] };
    const saved = await f.save(f.agent, fact("A", statement));
    const disputed = await f.act(f.agent, saved, { action: "dispute" });
    expect(disputed.status).toBe("disputed");

    const old = await f.save(f.agent, fact("B", statement));
    const replacement = await f.save(f.agent, fact("C", statement));
    expect(
      await f.act(f.agent, old, { action: "supersede", replacementId: replacement.id }),
    ).toMatchObject({ status: "superseded", supersededBy: replacement.id });

    const archived = await f.act(f.agent, replacement, { action: "archive" });
    expect(archived.status).toBe("archived");
    expect(await f.ids(f.agent)).not.toContain(replacement.id);
    expect(await f.ids(f.owner)).not.toContain(replacement.id);
    const archivedPage = await f.search.search(f.agent, { status: "archived" });
    expect(archivedPage.items).toEqual([
      expect.objectContaining({ id: replacement.id, status: "archived" }),
    ]);
    const restored = await f.act(f.agent, archived, { action: "unarchive" });
    expect(restored.status).toBe("active");
    expect(await f.ids(f.agent)).toContain(replacement.id);

    const tasks = await f.newAgent(["knowledge:read", "knowledge:write", "tasks:read"]);
    const restricted = await f.act(tasks, restored, { action: "restrict", workspace: "tasks" });
    expect(restricted).toMatchObject({
      scope: { workspace: "tasks" },
      requiredReadScopes: expect.arrayContaining(["tasks:read"]),
    });
    await expect(
      f.act(tasks, restricted, { action: "restrict", workspace: "mail" }),
    ).rejects.toMatchObject({ status: 403 });

    const raised = await f.act(f.agent, disputed, { action: "raise_sensitivity" });
    expect(raised.sensitivity).toBe("sensitive");
  });

  it("agent_cannot_widen_unblock_lower_or_confirm", async () => {
    const saved = await f.save(
      f.agent,
      fact("Tuesday", { sensitivity: "sensitive", evidence: [chatStatement("Tuesday")] }),
    );
    const forbidden: DistributiveOmit<
      KnowledgeLifecycleInput,
      "recordId" | "expectedRevision" | "mutationKey"
    >[] = [
      { action: "widen", workspace: null },
      { action: "set_access", agentAccess: "allowed" },
      { action: "set_access", agentAccess: "blocked" },
      { action: "set_sensitivity", sensitivity: "standard" },
      { action: "confirm" },
      { action: "resolve_conflict", keep: "current" },
    ];
    for (const action of forbidden)
      await expect(f.act(f.agent, saved, action)).rejects.toMatchObject({ status: 403 });
    expect(await f.get(f.owner, saved.id)).toMatchObject({
      revision: 1,
      sensitivity: "sensitive",
      agentAccess: "allowed",
    });
  });

  it("owner_widen_and_lower_respect_sources", async () => {
    const source = await f.save(f.owner, fact("Tuesday", { scope: { workspace: "finances" } }));
    const derived = await f.save(
      f.owner,
      fact("Tuesday copy", {
        scope: { workspace: "finances" },
        sensitivity: "sensitive",
        evidence: [
          { type: "domain_record", domain: "knowledge", id: source.id, revision: source.revision },
        ],
      }),
    );
    await expect(
      f.act(f.owner, derived, { action: "widen", workspace: null }),
    ).rejects.toMatchObject({ status: 403 });
    const lowered = await f.act(f.owner, derived, {
      action: "set_sensitivity",
      sensitivity: "standard",
    });
    expect(lowered.sensitivity).toBe("standard");
    const widened = await f.act(f.owner, source, { action: "widen", workspace: null });
    expect(widened.scope.workspace).toBeNull();
    expect(widened.requiredReadScopes).not.toContain("finances:read");
  });

  it("sensitive_is_readable_by_agents", async () => {
    const receipt = await f.records.create(
      f.agent,
      fact("Diagnosis", { sensitivity: "sensitive", evidence: [chatStatement("private")] }),
    );
    expect(receipt).toMatchObject({
      outcome: "readable",
      record: { sensitivity: "sensitive", status: "active" },
    });
    const id = knowledgeReceiptSchema.parse(receipt).recordId;
    const page = await f.search.search(f.agent, {});
    expect(page.items).toEqual([expect.objectContaining({ id, sensitivity: "sensitive" })]);
    expect(await f.get(f.agent, id)).toMatchObject({ sensitivity: "sensitive" });
  });

  it("blocked_is_invisible_to_agents_everywhere", async () => {
    const input = fact("Tuesday", { evidence: [chatStatement("Tuesday")] });
    const saved = await f.save(f.agent, input);
    const rival = await f.save(f.owner, {
      ...fact("Monday"),
      content: {
        ...saved.content,
        value: { ...saved.content.value, value: { type: "string", value: "Monday" } },
      } as KnowledgeRecord["content"],
    });
    expect((await f.get(f.agent, rival.id)).conflictRecordIds).toEqual([saved.id]);

    const blocked = await f.act(f.owner, saved, { action: "set_access", agentAccess: "blocked" });
    expect(blocked.agentAccess).toBe("blocked");

    await expect(f.records.get(f.agent, { id: saved.id })).rejects.toMatchObject({ status: 404 });
    await expect(f.search.history(f.agent, { recordId: saved.id })).rejects.toMatchObject({
      status: 404,
    });
    expect(await f.ids(f.agent)).toEqual([rival.id]);
    const pack = await f.context.context(f.agent, {});
    expect(JSON.stringify(pack)).not.toContain(saved.id);
    expect((await f.get(f.agent, rival.id)).conflictRecordIds).toEqual([]);
    await expect(f.act(f.agent, blocked, { action: "dispute" })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      f.save(f.agent, fact("Link", { evidence: [], relatedRecordIds: [saved.id] })),
    ).rejects.toMatchObject({ status: 404 });
    // Replaying the agent's own save reads like memory that is gone.
    expect(await f.records.create(f.agent, input)).toEqual({
      receiptId: expect.any(String),
      recordId: saved.id,
      outcome: "forgotten",
    });

    // The person still sees everything.
    expect(await f.get(f.owner, saved.id)).toMatchObject({ agentAccess: "blocked" });
    expect(await f.ids(f.owner)).toEqual(expect.arrayContaining([saved.id, rival.id]));
    expect((await f.get(f.owner, rival.id)).conflictRecordIds).toEqual([saved.id]);

    const allowed = await f.act(f.owner, blocked, { action: "set_access", agentAccess: "allowed" });
    expect(await f.get(f.agent, allowed.id)).toMatchObject({ agentAccess: "allowed" });
  });

  it("workspace_restriction_needs_the_workspace_read_scope", async () => {
    const saved = await f.save(f.owner, fact("Budget day", { scope: { workspace: "finances" } }));
    const finance = await f.newAgent(["knowledge:read", "knowledge:write", "finances:read"]);
    await expect(f.records.get(f.agent, { id: saved.id })).rejects.toMatchObject({ status: 404 });
    expect(await f.ids(f.agent)).toEqual([]);
    expect(await f.get(finance, saved.id)).toMatchObject({ scope: { workspace: "finances" } });
    expect(await f.ids(finance)).toEqual([saved.id]);
    const widened = await f.act(f.owner, saved, { action: "widen", workspace: null });
    expect(await f.get(f.agent, widened.id)).toMatchObject({ scope: { workspace: null } });
  });

  it("purpose_is_optional_and_never_hides", async () => {
    const bookkeeping = await f.save(f.owner, fact("Ledger", { purposes: ["bookkeeping"] }));
    const planning = await f.save(f.owner, fact("Plan", { purposes: ["planning"] }));
    const everywhere = await f.save(f.owner, fact("Anything"));
    expect(everywhere.purposes).toEqual(knowledgePurposeSchema.options);

    const ranked = await f.ids(f.agent, { purpose: "planning" });
    expect(ranked).toHaveLength(3);
    expect(ranked.at(-1)).toBe(bookkeeping.id);
    expect(ranked.slice(0, 2)).toEqual(expect.arrayContaining([planning.id, everywhere.id]));
    expect(await f.ids(f.agent)).toEqual(
      expect.arrayContaining([bookkeeping.id, planning.id, everywhere.id]),
    );
    expect(await f.get(f.agent, bookkeeping.id)).toMatchObject({ purposes: ["bookkeeping"] });
    expect((await f.records.get(f.agent, { id: bookkeeping.id, purpose: "planning" })).id).toBe(
      bookkeeping.id,
    );
    const history = await f.search.history(f.agent, { recordId: bookkeeping.id });
    expect(history.items.map((item) => item.id)).toEqual([bookkeeping.id]);
  });

  it("memory_grants_no_authority", async () => {
    const policyRows = async () => ({
      automation: await database.db
        .select()
        .from(financeAutomationSettings)
        .where(eq(financeAutomationSettings.userId, f.owner.userId)),
      agent: await database.db
        .select()
        .from(financeAgentSettings)
        .where(eq(financeAgentSettings.userId, f.owner.userId)),
      execution: await database.db
        .select()
        .from(executionPolicySettings)
        .where(eq(executionPolicySettings.userId, f.owner.userId)),
    });
    const tokenScopes = async () =>
      (
        await database.db
          .select({ scopes: accessTokens.scopes })
          .from(accessTokens)
          .where(and(eq(accessTokens.userId, f.owner.userId), eq(accessTokens.id, f.agent.actorId)))
      )[0]?.scopes;
    const before = { policy: await policyRows(), scopes: await tokenScopes() };
    await f.save(f.agent, {
      mutationKey: randomUUID(),
      content: {
        kind: "preference",
        value: {
          subject: "owner",
          key: "purchases",
          value: { type: "string", value: "auto-approve purchases" },
        },
      },
      scope: { workspace: null },
      core: true,
      evidence: [chatStatement("Just auto-approve my purchases.")],
    });
    expect({ policy: await policyRows(), scopes: await tokenScopes() }).toEqual(before);
    expect(before.scopes).toEqual(["knowledge:read", "knowledge:write"]);
  });

  it("an_active_inferred_record_is_in_the_inferred_section_of_the_context_route", async () => {
    const saved = await f.save(f.agent, fact("Mornings", { evidence: [] }));
    expect(saved).toMatchObject({ status: "active", origin: "inferred" });
    const app = createApp({
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
    const response = await app.request("https://api.example.com/v1/knowledge/context", {
      method: "POST",
      headers: { authorization: `Bearer ${f.agent.token}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    const pack = knowledgeContextPackSchema.parse(await response.json());
    expect(pack.inferred.map((record) => record.id)).toEqual([saved.id]);
    expect(pack.stated).toEqual([]);
    expect(pack.tentative).toEqual([]);
  });
});
