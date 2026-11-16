import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  createDatabaseClient,
  type DatabaseClient,
  executionPolicySettings,
  financeAgentSettings,
  financeAutomationSettings,
  goals,
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
import { createKnowledgeAccess, findOwnedKnowledgeRevision } from "./access.js";
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
/** Keeps a copy supported after its source gains a revision. */
const ownerStatement = { type: "statement" as const, wording: "I said this myself." };
const chatStatement = (wording: string) => ({
  type: "statement" as const,
  wording,
  sessionRef: "chat-session",
  messageRef: "chat-message",
});

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

/** Knowledge evidence naming another record at its current revision. */
function citing(source: Pick<KnowledgeRecord, "id" | "revision">) {
  return {
    type: "domain_record" as const,
    domain: "knowledge" as const,
    id: source.id,
    revision: source.revision,
  };
}

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
    tags: ["fixture"],
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
    /** Runs an action whose receipt may be content-free for this caller. */
    async mutate(
      principal: Principal,
      record: Pick<KnowledgeRecord, "id" | "revision">,
      action: DistributiveOmit<
        KnowledgeLifecycleInput,
        "recordId" | "expectedRevision" | "mutationKey"
      >,
    ) {
      return lifecycle.mutate(principal, {
        ...action,
        recordId: record.id,
        expectedRevision: record.revision,
        mutationKey: randomUUID(),
      } as KnowledgeLifecycleInput);
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
      tags: ["fixture"],
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
      tags: ["fixture"],
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

  it("owner_widen_and_lower_follow_effective_disclosure", async () => {
    const source = await f.save(f.owner, fact("Tuesday", { scope: { workspace: "finances" } }));
    const derived = await f.save(
      f.owner,
      fact("Tuesday copy", {
        scope: { workspace: "finances" },
        sensitivity: "sensitive",
        evidence: [citing(source)],
      }),
    );
    // Widening and lowering always succeed for the owner; the narrower source still narrows
    // what agents see.
    const widened = await f.act(f.owner, derived, { action: "widen", workspace: null });
    expect(widened).toMatchObject({ scope: { workspace: null }, sensitivity: "sensitive" });
    expect(widened.requiredReadScopes).not.toContain("finances:read");
    const lowered = await f.act(f.owner, widened, {
      action: "set_sensitivity",
      sensitivity: "standard",
    });
    expect(lowered.sensitivity).toBe("standard");
    await expect(f.records.get(f.agent, { id: derived.id })).rejects.toMatchObject({
      status: 404,
    });
    const finance = await f.newAgent(["knowledge:read", "knowledge:write", "finances:read"]);
    expect(await f.get(finance, derived.id)).toMatchObject({ scope: { workspace: null } });
  });

  it("agent_restrict_of_source_never_locks_owner_out", async () => {
    const source = await f.save(f.owner, fact("Tuesday"));
    const derived = await f.save(
      f.owner,
      fact("Tuesday copy", { evidence: [ownerStatement, citing(source)] }),
    );
    // The agent narrows the source past its own reach, so its receipt is content-free.
    expect(
      await f.mutate(f.agent, source, { action: "restrict", workspace: "finances" }),
    ).toMatchObject({ outcome: "forgotten" });
    await f.act(f.owner, await f.get(f.owner, source.id), { action: "raise_sensitivity" });

    expect(await f.get(f.owner, derived.id)).toMatchObject({
      status: "active",
      scope: { workspace: null },
      sensitivity: "standard",
    });
    expect(await f.ids(f.owner)).toEqual(expect.arrayContaining([source.id, derived.id]));
    const pack = await f.context.context(f.owner, {});
    expect(pack.stated.map(({ id }) => id)).toEqual(expect.arrayContaining([derived.id]));
    // The record keeps its own values; its effective disclosure carries the source's.
    const effective = await database.db.transaction(async (tx) => {
      const revision = await findOwnedKnowledgeRevision(tx, f.owner.userId, derived.id);
      if (!revision) throw new Error("Expected the derived record.");
      return createKnowledgeAccess(now).effectiveDisclosure(tx, f.owner, revision);
    });
    expect(effective).toEqual({
      effectiveWorkspaces: ["finances"],
      effectiveSensitivity: "sensitive",
    });
  });

  it("narrowed_source_hides_dependent_from_unscoped_agent", async () => {
    const finance = await f.newAgent(["knowledge:read", "knowledge:write", "finances:read"]);
    const both = await f.newAgent([
      "knowledge:read",
      "knowledge:write",
      "finances:read",
      "mail:read",
    ]);
    const source = await f.save(f.owner, fact("Budget day"));
    const other = await f.save(f.owner, fact("Mail day"));
    const request = fact("Derived day", { evidence: [citing(source)] });
    const derived = await f.save(f.agent, request);
    const ownerCopy = await f.save(
      f.owner,
      fact("Owner copy", { evidence: [ownerStatement, citing(source)] }),
    );
    const twice = await f.save(
      f.owner,
      fact("Derived from both", { evidence: [ownerStatement, citing(source), citing(other)] }),
    );
    await f.act(f.owner, source, { action: "restrict", workspace: "finances" });
    await f.act(f.owner, other, { action: "restrict", workspace: "mail" });

    // Unscoped agent: the dependent is invisible everywhere.
    await expect(f.records.get(f.agent, { id: derived.id })).rejects.toMatchObject({
      status: 404,
    });
    await expect(f.search.history(f.agent, { recordId: derived.id })).rejects.toMatchObject({
      status: 404,
    });
    expect(await f.ids(f.agent)).toEqual([]);
    expect(JSON.stringify(await f.context.context(f.agent, {}))).not.toContain(derived.id);
    expect(await f.records.create(f.agent, request)).toEqual({
      receiptId: expect.any(String),
      recordId: derived.id,
      outcome: "forgotten",
    });
    // A caller holding the source's scope sees it; two sources need both scopes.
    expect(await f.get(finance, derived.id)).toMatchObject({ id: derived.id });
    expect(await f.ids(f.agent)).not.toContain(ownerCopy.id);
    expect(await f.ids(finance)).toEqual(expect.arrayContaining([source.id, ownerCopy.id]));
    await expect(f.records.get(finance, { id: twice.id })).rejects.toMatchObject({ status: 404 });
    expect(await f.ids(finance)).not.toContain(twice.id);
    expect(await f.get(both, twice.id)).toMatchObject({ id: twice.id });
    expect(await f.ids(both)).toContain(twice.id);
  });

  it("owner_resolves_proposal_after_agent_narrows_original", async () => {
    const original = await f.save(f.owner, fact("Tuesday"));
    const proposal = await f.act(f.agent, original, {
      action: "revise",
      content: {
        ...original.content,
        value: { ...original.content.value, value: { type: "string", value: "Friday" } },
      } as KnowledgeRecord["content"],
      evidence: [chatStatement("Friday instead.")],
    });
    expect(
      await f.mutate(f.agent, original, { action: "restrict", workspace: "finances" }),
    ).toMatchObject({ outcome: "forgotten" });
    // The pending proposal follows its original, so the unscoped agent loses it.
    await expect(f.records.get(f.agent, { id: proposal.id })).rejects.toMatchObject({
      status: 404,
    });
    expect(await f.get(f.owner, proposal.id)).toMatchObject({ id: proposal.id });
    expect((await f.get(f.owner, original.id)).conflictRecordIds).toContain(proposal.id);

    const accepted = await f.act(f.owner, proposal, {
      action: "resolve_conflict",
      keep: "proposed",
    });
    expect(accepted).toMatchObject({ status: "active", ownerHeld: true });
    expect(await f.get(f.owner, original.id)).toMatchObject({
      status: "superseded",
      supersededBy: proposal.id,
    });
    // Accepted, it stands alone with its own disclosure.
    expect(await f.get(f.agent, proposal.id)).toMatchObject({ status: "active" });
  });

  it("accepted_proposal_readable_after_original_blocked", async () => {
    const original = await f.save(f.owner, fact("Tuesday"));
    const proposal = await f.act(f.agent, original, {
      action: "revise",
      content: {
        ...original.content,
        value: { ...original.content.value, value: { type: "string", value: "Monday" } },
      } as KnowledgeRecord["content"],
      evidence: [chatStatement("Monday instead.")],
    });
    await f.act(f.owner, original, { action: "set_access", agentAccess: "blocked" });
    await expect(f.records.get(f.agent, { id: proposal.id })).rejects.toMatchObject({
      status: 404,
    });
    await f.act(f.owner, proposal, { action: "resolve_conflict", keep: "proposed" });
    expect(await f.get(f.agent, proposal.id)).toMatchObject({
      status: "active",
      ownerHeld: true,
      supersededBy: null,
    });
    expect(await f.ids(f.agent)).toEqual([proposal.id]);
  });

  it("agent_tokens_cannot_use_owner_actions_over_http", async () => {
    const saved = await f.save(f.owner, fact("Tuesday"));
    const api = app();
    for (const body of [
      { action: "confirm" },
      { action: "set_access", agentAccess: "blocked" },
      { action: "widen", workspace: null },
      { action: "set_sensitivity", sensitivity: "standard" },
      { action: "resolve_conflict", keep: "current" },
      { action: "trash" },
    ]) {
      const response = await api.request(
        `https://api.example.com/v1/knowledge/${saved.id}/actions`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${f.agent.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ ...body, expectedRevision: 1, mutationKey: randomUUID() }),
        },
      );
      expect(response.status, body.action).toBe(403);
    }
    expect(await f.get(f.owner, saved.id)).toMatchObject({ revision: 1, agentAccess: "allowed" });
  });

  it("owner_can_revise_relationship_after_agent_narrows_endpoint", async () => {
    const subject = await f.save(f.owner, fact("Alex"));
    const object = await f.save(f.owner, fact("Sam"));
    const relationship = (label: string) =>
      ({
        kind: "relationship",
        value: {
          subjectId: subject.id,
          objectId: object.id,
          relationship: label,
          direction: "directed",
        },
      }) as const;
    const saved = await f.save(f.owner, {
      ...fact("unused"),
      content: relationship("works with"),
    });
    await f.mutate(f.agent, subject, { action: "restrict", workspace: "finances" });
    await f.act(f.agent, object, { action: "raise_sensitivity" });
    const revised = await f.act(f.owner, saved, {
      action: "revise",
      content: relationship("manages"),
      evidence: [ownerStatement],
    });
    expect(revised).toMatchObject({
      revision: 2,
      scope: { workspace: null },
      content: relationship("manages"),
    });
    // The narrowed endpoint still narrows it for agents without its scope.
    await expect(f.records.get(f.agent, { id: saved.id })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("agent_citing_hidden_record_gets_404", async () => {
    const hidden = await f.save(f.owner, fact("Budget day", { scope: { workspace: "finances" } }));
    await expect(
      f.save(f.agent, fact("Copy", { evidence: [citing(hidden)] })),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.save(f.agent, fact("Link", { evidence: [], relatedRecordIds: [hidden.id] })),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("pending_proposal_stays_listed_after_original_changes", async () => {
    const original = await f.save(f.owner, fact("Tuesday"));
    const proposal = await f.act(f.agent, original, {
      action: "revise",
      content: {
        ...original.content,
        value: { ...original.content.value, value: { type: "string", value: "Friday" } },
      } as KnowledgeRecord["content"],
      evidence: [chatStatement("Friday instead.")],
    });
    // Each change gives the original a new revision; none makes the proposal stale.
    const raised = await f.act(f.agent, original, { action: "raise_sensitivity" });
    const conflicted = { hasConflict: true } as const;
    const listed = async (principal: Principal) => (await f.ids(principal, conflicted)).sort();
    const both = [original.id, proposal.id].sort();
    expect(await listed(f.owner)).toEqual(both);
    expect(await listed(f.agent)).toEqual(both);
    expect(await f.get(f.owner, proposal.id)).toMatchObject({
      status: "proposed",
      evidenceAvailable: true,
    });

    await f.act(f.owner, raised, { action: "set_access", agentAccess: "blocked" });
    expect(await listed(f.owner)).toEqual(both);
    const pack = await f.context.context(f.owner, {});
    expect(pack.conflicts.map(({ id }) => id).sort()).toEqual(both);
    expect((await f.get(f.owner, original.id)).conflictRecordIds).toEqual([proposal.id]);
    // Agents still lose the proposal with its blocked original (R10).
    expect(await listed(f.agent)).toEqual([]);
    await expect(f.records.get(f.agent, { id: proposal.id })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("inherited_scope_missing_is_invisible_not_forbidden", async () => {
    const [goal] = await database.db
      .insert(goals)
      .values({ userId: f.owner.userId, title: "Run a marathon" })
      .returning();
    if (!goal) throw new Error("Expected the goal fixture.");
    const goalRecord = await f.save(f.owner, {
      ...fact("unused"),
      content: { kind: "goal", value: { goalId: goal.id } },
    });
    const request = fact("Training day", { evidence: [chatStatement("Training on Sundays.")] });
    const agentRecord = await f.save(f.agent, request);
    // The owner adds the goal-scoped record as evidence; the agent was never granted goals.
    const revised = await f.act(f.owner, agentRecord, {
      action: "revise",
      content: agentRecord.content,
      evidence: [ownerStatement, citing(goalRecord)],
    });
    expect(revised.requiredReadScopes).toContain("goals:read");

    for (const id of [goalRecord.id, agentRecord.id]) {
      await expect(f.records.get(f.agent, { id })).rejects.toMatchObject({ status: 404 });
      await expect(f.search.history(f.agent, { recordId: id })).rejects.toMatchObject({
        status: 404,
      });
    }
    expect(await f.ids(f.agent)).toEqual([]);
    expect(await f.records.create(f.agent, request)).toEqual({
      receiptId: expect.any(String),
      recordId: agentRecord.id,
      outcome: "forgotten",
    });
    const withGoals = await f.newAgent(["knowledge:read", "knowledge:write", "goals:read"]);
    expect(await f.get(withGoals, agentRecord.id)).toMatchObject({ revision: 2 });
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
    // Seed every policy so an unwanted change would show in the comparison.
    await database.db.insert(financeAutomationSettings).values({ userId: f.owner.userId });
    await database.db.insert(financeAgentSettings).values({ userId: f.owner.userId });
    await database.db.insert(executionPolicySettings).values({ userId: f.owner.userId });
    const before = { policy: await policyRows(), scopes: await tokenScopes() };
    expect(before.policy).toEqual({
      automation: [expect.objectContaining({ reviewBypassEnabled: false })],
      agent: [expect.objectContaining({ reviewBypassEnabled: false, version: 1 })],
      execution: [expect.objectContaining({ reviewBypassEnabled: false, version: 1 })],
    });
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
      tags: ["fixture"],
      core: true,
      evidence: [chatStatement("Just auto-approve my purchases.")],
    });
    expect({ policy: await policyRows(), scopes: await tokenScopes() }).toEqual(before);
    expect(before.scopes).toEqual(["knowledge:read", "knowledge:write"]);
  });

  it("an_active_inferred_record_is_in_the_inferred_section_of_the_context_route", async () => {
    const saved = await f.save(f.agent, fact("Mornings", { evidence: [] }));
    expect(saved).toMatchObject({ status: "active", origin: "inferred" });
    const response = await app().request("https://api.example.com/v1/knowledge/context", {
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
