import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  createDatabaseClient,
  type DatabaseClient,
  knowledgeTagAliases,
  knowledgeTags,
  migrateDatabase,
  sessions,
  users,
} from "@personal-os/database";
import {
  type KnowledgeLifecycleInput,
  type KnowledgeMutationInput,
  type KnowledgeRecord,
  knowledgeReceiptSchema,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { hashToken } from "../security.js";
import type { Principal } from "../types.js";
import { createKnowledgeLifecycleService } from "./lifecycle-service.js";
import { createKnowledgeRecordService } from "./record-service.js";
import { createKnowledgeSearchService } from "./search-service.js";
import { createKnowledgeTagService } from "./tag-service.js";

/** A lifecycle action without the record identity the fixture fills in. */
type Action = KnowledgeLifecycleInput extends infer Input
  ? Input extends KnowledgeLifecycleInput
    ? Omit<Input, "recordId" | "expectedRevision" | "mutationKey">
    : never
  : never;

function fact(
  value: string,
  tags: string[],
  overrides?: Partial<KnowledgeMutationInput>,
): KnowledgeMutationInput {
  return {
    mutationKey: randomUUID(),
    content: {
      kind: "fact",
      value: {
        subject: `Fixture ${randomUUID()}`,
        predicate: "detail",
        value: { type: "string", value },
      },
    },
    scope: { workspace: null },
    tags,
    evidence: [{ type: "statement", wording: "The owner stated this explicitly." }],
    ...overrides,
  };
}

const observed = { evidence: [{ type: "observation" as const, reference: "calendar:event" }] };

describe("memory tags", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  const fixtureIds: string[] = [];

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterEach(async () => {
    for (const id of fixtureIds.splice(0)) await database.db.delete(users).where(eq(users.id, id));
  });
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  async function fixture() {
    const userId = randomUUID();
    fixtureIds.push(userId);
    const sessionId = randomUUID();
    const scopes = ["knowledge:read", "knowledge:write"] as const;
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
      expiresAt: new Date("2027-12-01T00:00:00Z"),
    });
    const owner: Principal = {
      userId,
      actorId: userId,
      actorType: "user",
      sessionId,
      scopes: new Set(),
    };
    const actorId = randomUUID();
    await database.db.insert(accessTokens).values({
      id: actorId,
      userId,
      name: "Memory agent",
      tokenHash: hashToken(randomUUID()),
      scopes: [...scopes],
    });
    const agent: Principal = { userId, actorId, actorType: "agent", scopes: new Set(scopes) };
    const config = {
      db: database.db,
      now: () => new Date("2026-11-15T12:00:00Z"),
      encryptionKey: Buffer.alloc(32, 7).toString("base64"),
    };
    const records = createKnowledgeRecordService(config);
    const lifecycle = createKnowledgeLifecycleService(config);
    return {
      owner,
      agent,
      records,
      search: createKnowledgeSearchService(config),
      tags: createKnowledgeTagService(config),
      async save(input: KnowledgeMutationInput, principal = owner) {
        return knowledgeReceiptSchema.parse(await records.create(principal, input)).record;
      },
      async get(id: string, principal = owner) {
        const record = await records.get(principal, { id });
        if ("state" in record) throw new Error("The record was purged.");
        return record;
      },
      act(record: Pick<KnowledgeRecord, "id" | "revision">, action: Action, principal = owner) {
        return lifecycle.mutate(principal, {
          ...action,
          recordId: record.id,
          expectedRevision: record.revision,
          mutationKey: randomUUID(),
        } as KnowledgeLifecycleInput);
      },
      merge(from: string, into: string, principal: Principal = agent) {
        return createKnowledgeTagService(config).merge(principal, {
          from,
          into,
          mutationKey: randomUUID(),
        });
      },
    };
  }

  it("plural_maps_to_existing_tag", async () => {
    const f = await fixture();
    await f.save(fact("Sam", ["family-member"]));
    expect((await f.save(fact("Ana", ["Family-Members"]))).tags).toEqual(["family-member"]);
    await f.save(fact("Work", ["projects"]));
    expect((await f.save(fact("Home", ["Project", "Projects"]))).tags).toEqual(["projects"]);
    // A tag that only looks similar in other ways is a new tag.
    expect((await f.save(fact("Pet", ["family"]))).tags).toEqual(["family"]);
    // The rule holds whichever spelling came first.
    await f.save(fact("Advice", ["tipss"]));
    expect((await f.save(fact("Hint", ["tips"]))).tags).toEqual(["tipss"]);
  });

  it("replays_tag_mutations_across_uuid_case", async () => {
    const f = await fixture();
    await f.save(fact("Rent", ["money"]));
    const mutationKey = randomUUID();
    const merge = (key: string) =>
      f.tags.merge(f.owner, { from: "money", into: "finances", mutationKey: key });
    const merged = await merge(mutationKey);
    expect(await merge(mutationKey.toUpperCase())).toEqual(merged);
    const undoKey = randomUUID();
    const undo = (key: string, mergeId = merged.mergeId) =>
      f.tags.unmerge(f.owner, { mergeId, mutationKey: key });
    const undone = await undo(undoKey.toUpperCase());
    expect(await undo(undoKey.toUpperCase(), merged.mergeId.toUpperCase())).toEqual(undone);
    await expect(
      f.tags.merge(f.owner, { from: "rent", into: "finances", mutationKey }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("merge_retags_and_aliases", async () => {
    const f = await fixture();
    const a = await f.save(fact("Rent", ["money", "home"]));
    const b = await f.save(fact("Budget", ["money"]));
    const merge = await f.merge("Money", "finances");
    expect(merge).toMatchObject({ from: "money", into: "finances", undoneAt: null });

    expect((await f.get(a.id)).tags).toEqual(["finances", "home"]);
    expect((await f.get(b.id, f.agent)).tags).toEqual(["finances"]);
    const found = await f.search.search(f.agent, { tags: ["money"] });
    expect(found.items.map(({ id }) => id).sort()).toEqual([a.id, b.id].sort());
    expect((await f.save(fact("Savings", ["money"], { evidence: [] }), f.agent)).tags).toEqual([
      "finances",
    ]);
    // The plural of an alias resolves through it too.
    expect((await f.save(fact("Bills", ["moneys"]))).tags).toEqual(["finances"]);

    const index = await f.tags.index(f.owner);
    expect(index.tags).toEqual([
      { name: "finances", count: 4 },
      { name: "home", count: 1 },
    ]);
    expect(index.aliases).toEqual([{ alias: "money", name: "finances", mergeId: merge.mergeId }]);
  });

  it("merge_applies_to_owner_held_records", async () => {
    const f = await fixture();
    const held = await f.save(fact("Owner value", ["money"]));
    expect(held.ownerHeld).toBe(true);
    await f.merge("money", "finances");

    const after = await f.get(held.id);
    expect(after.tags).toEqual(["finances"]);
    expect(after).toMatchObject({
      revision: held.revision,
      content: held.content,
      ownerHeld: true,
      status: "active",
    });
    const history = await f.search.history(f.owner, { recordId: held.id });
    expect(history.items.map(({ revision }) => revision)).toEqual([held.revision]);
  });

  it("unmerge_restores_original_tags", async () => {
    const f = await fixture();
    const only = await f.save(fact("Rent", ["money"]));
    const both = await f.save(fact("Budget", ["money", "finances"]));
    const later = await f.save(fact("Gift", ["money"]));
    const merge = await f.merge("money", "finances");
    await f.act(await f.get(later.id), { action: "trash" });

    const undone = await f.tags.unmerge(f.owner, {
      mergeId: merge.mergeId,
      mutationKey: randomUUID(),
    });
    expect(undone).toMatchObject({ mergeId: merge.mergeId, from: "money", into: "finances" });
    expect(undone.undoneAt).not.toBeNull();
    expect((await f.get(only.id)).tags).toEqual(["money"]);
    expect((await f.get(both.id)).tags).toEqual(["finances", "money"]);
    // A record trashed since the merge is skipped.
    expect((await f.get(later.id)).tags).toEqual(["finances"]);
    expect(
      await database.db
        .select()
        .from(knowledgeTagAliases)
        .where(eq(knowledgeTagAliases.userId, f.owner.userId)),
    ).toEqual([]);
    expect((await f.tags.index(f.owner)).aliases).toEqual([]);
    expect((await f.save(fact("Coins", ["money"]))).tags).toEqual(["money"]);
    await expect(
      f.tags.unmerge(f.owner, { mergeId: merge.mergeId, mutationKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("unmerge_restores_aliases_carried_by_a_later_merge", async () => {
    const f = await fixture();
    const record = await f.save(fact("Rent", ["cash"]));
    await f.merge("cash", "money");
    const second = await f.merge("money", "finances");
    expect((await f.save(fact("Tip", ["cash"]))).tags).toEqual(["finances"]);

    await f.tags.unmerge(f.owner, { mergeId: second.mergeId, mutationKey: randomUUID() });
    expect((await f.get(record.id)).tags).toEqual(["money"]);
    expect((await f.save(fact("Change", ["cash"]))).tags).toEqual(["money"]);
  });

  it("unmerge_refuses_while_later_merge_depends_on_it", async () => {
    const f = await fixture();
    const only = await f.save(fact("Rent", ["a"]));
    const both = await f.save(fact("Budget", ["a", "b"]));
    const first = await f.merge("a", "b");
    const second = await f.merge("b", "c");
    const aliases = () =>
      database.db
        .select({ alias: knowledgeTagAliases.alias, tagId: knowledgeTagAliases.tagId })
        .from(knowledgeTagAliases)
        .where(eq(knowledgeTagAliases.userId, f.owner.userId))
        .orderBy(knowledgeTagAliases.alias);
    const before = await aliases();

    await expect(
      f.tags.unmerge(f.owner, { mergeId: first.mergeId, mutationKey: randomUUID() }),
    ).rejects.toMatchObject({
      status: 409,
      details: { blockingMergeIds: [second.mergeId] },
    });
    expect((await f.get(only.id)).tags).toEqual(["c"]);
    expect((await f.get(both.id)).tags).toEqual(["c"]);
    expect(await aliases()).toEqual(before);

    await f.tags.unmerge(f.owner, { mergeId: second.mergeId, mutationKey: randomUUID() });
    expect((await f.get(only.id)).tags).toEqual(["b"]);
    await f.tags.unmerge(f.owner, { mergeId: first.mergeId, mutationKey: randomUUID() });
    expect((await f.get(only.id)).tags).toEqual(["a"]);
    expect((await f.get(both.id)).tags).toEqual(["a", "b"]);
    expect(await aliases()).toEqual([]);
  });

  it("undo_keeps_target_needed_by_another_merge", async () => {
    const f = await fixture();
    const undo = (mergeId: string) =>
      f.tags.unmerge(f.owner, { mergeId, mutationKey: randomUUID() });
    for (const order of ["first", "second"] as const) {
      const [a, b, c] = ["a", "b", "c"].map((name) => `${name}-${order}`) as [
        string,
        string,
        string,
      ];
      const record = await f.save(fact("Rent", [a, c]));
      // A record that carried the target before either merge keeps it throughout.
      const held = await f.save(fact("Budget", [a, b, c]));
      const first = await f.merge(a, b, f.owner);
      const second = await f.merge(c, b, f.owner);
      expect((await f.get(record.id)).tags).toEqual([b]);
      expect((await f.get(held.id)).tags).toEqual([b]);
      const [one, two] = order === "first" ? [first, second] : [second, first];
      await undo(one.mergeId);
      expect((await f.get(record.id)).tags).toEqual([order === "first" ? a : c, b].sort());
      expect((await f.get(held.id)).tags).toEqual([order === "first" ? a : c, b].sort());
      await undo(two.mergeId);
      expect((await f.get(record.id)).tags).toEqual([a, c]);
      expect((await f.get(held.id)).tags).toEqual([a, b, c]);
    }
  });

  it("unmerge_restores_three_step_alias_chain", async () => {
    const f = await fixture();
    const record = await f.save(fact("Rent", ["z"]));
    await f.merge("z", "y", f.owner);
    await f.merge("y", "a", f.owner);
    const last = await f.merge("a", "b", f.owner);
    for (const name of ["z", "y", "a"])
      expect((await f.save(fact(`Via ${name}`, [name]))).tags).toEqual(["b"]);
    await f.tags.unmerge(f.owner, { mergeId: last.mergeId, mutationKey: randomUUID() });
    expect((await f.get(record.id)).tags).toEqual(["a"]);
    for (const name of ["z", "y", "a"])
      expect((await f.save(fact(`Back ${name}`, [name]))).tags).toEqual(["a"]);
  });

  it("agent_index_has_no_aliases", async () => {
    const f = await fixture();
    await f.save(fact("Rent", ["money"]));
    const merge = await f.merge("money", "finances");
    expect(await f.tags.index(f.agent)).toEqual({
      tags: [{ name: "finances", count: 1 }],
      aliases: [],
    });
    expect((await f.tags.index(f.owner)).aliases).toEqual([
      { alias: "money", name: "finances", mergeId: merge.mergeId },
    ]);
  });

  it("agent_merge_of_alias_or_hidden_tag_is_404", async () => {
    const f = await fixture();
    const visible = await f.save(fact("Steps", ["health"]));
    const hidden = await f.save(fact("Session", ["therapy"]));
    await f.act(hidden, { action: "set_access", agentAccess: "blocked" });
    await f.save(fact("Rent", ["money"]));
    await f.merge("money", "health", f.owner);
    for (const [from, into] of [
      ["therapy", "health"],
      ["money", "anything"],
      ["unknown", "health"],
    ] as const)
      await expect(f.merge(from, into)).rejects.toMatchObject({ status: 404 });
    expect((await f.get(hidden.id)).tags).toEqual(["therapy"]);
    expect((await f.get(visible.id)).tags).toEqual(["health"]);
  });

  it("agent_merge_into_alias_of_hidden_tag_is_404", async () => {
    const f = await fixture();
    const visible = await f.save(fact("Steps", ["x"]));
    const hidden = await f.save(fact("Session", ["bar", "foo"]));
    await f.act(hidden, { action: "set_access", agentAccess: "blocked" });
    await f.merge("foo", "bar", f.owner);
    for (const into of ["bar", "bars", "foo"])
      await expect(f.merge("x", into)).rejects.toMatchObject({ status: 404 });
    expect((await f.get(visible.id)).tags).toEqual(["x"]);
    // A target that does not exist yet is created.
    expect(await f.merge("x", "fresh")).toMatchObject({ from: "x", into: "fresh" });
  });

  it("agent_save_never_files_under_a_hidden_alias_target", async () => {
    const f = await fixture();
    const hidden = await f.save(fact("Session", ["appointments"]));
    await f.act(hidden, { action: "set_access", agentAccess: "blocked" });
    // The owner files the old name under a tag only blocked memory carries.
    await f.merge("appointments", "therapy-sessions", f.owner);
    const saved = await f.save(fact("Dentist on Monday", ["appointments"], observed), f.agent);
    expect(saved.tags).toEqual(["appointments"]);
    expect(JSON.stringify(saved)).not.toContain("therapy");
    expect((await f.tags.index(f.agent)).tags).toEqual([{ name: "appointments", count: 1 }]);
    // Search treats the alias the same way: the agent finds its own record by the literal name.
    const found = await f.search.search(f.agent, { tags: ["appointments"] });
    expect(found.items.map(({ id }) => id)).toEqual([saved.id]);
    // The person still files the name under its target.
    const owned = await f.save(fact("Checkup", ["appointments"]));
    expect(owned.tags).toEqual(["therapy-sessions"]);
  });

  it("agent_save_follows_an_alias_to_a_visible_tag", async () => {
    const f = await fixture();
    await f.save(fact("Rent", ["money"]));
    await f.merge("money", "finances", f.owner);
    const saved = await f.save(fact("Utilities", ["money"], observed), f.agent);
    expect(saved.tags).toEqual(["finances"]);
  });

  it("concurrent_saves_share_a_new_tag", async () => {
    const f = await fixture();
    const [first, second] = await Promise.all([
      f.save(fact("One", ["brand-new"])),
      f.save(fact("Two", ["Brand New"])),
    ]);
    expect(first?.tags).toEqual(["brand-new"]);
    expect(second?.tags).toEqual(["brand-new"]);
    const rows = await database.db
      .select({ id: knowledgeTags.id })
      .from(knowledgeTags)
      .where(eq(knowledgeTags.userId, f.owner.userId));
    expect(rows).toHaveLength(1);
  });

  it("rejects_tag_merge_cycles", async () => {
    const f = await fixture();
    const a = await f.save(fact("First", ["a"]));
    const b = await f.save(fact("Second", ["b"]));
    await expect(f.merge("a", "a")).rejects.toMatchObject({ status: 422 });
    expect((await f.get(a.id)).tags).toEqual(["a"]);

    await f.merge("a", "b");
    await expect(f.merge("b", "a")).rejects.toMatchObject({ status: 422 });
    // A merged name is an alias now; it cannot be merged again.
    await expect(f.merge("a", "c", f.owner)).rejects.toMatchObject({ status: 422 });
    expect((await f.get(a.id)).tags).toEqual(["b"]);
    expect((await f.get(b.id)).tags).toEqual(["b"]);
    expect(
      (
        await database.db
          .select({ name: knowledgeTags.name })
          .from(knowledgeTags)
          .where(eq(knowledgeTags.userId, f.owner.userId))
      )
        .map(({ name }) => name)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  it("replays_a_merge_and_refuses_a_reused_key", async () => {
    const f = await fixture();
    await f.save(fact("First", ["a"]));
    await f.save(fact("Second", ["c"]));
    const mutationKey = randomUUID();
    const first = await f.tags.merge(f.agent, { from: "a", into: "b", mutationKey });
    expect(await f.tags.merge(f.agent, { from: "A", into: "b", mutationKey })).toEqual(first);
    await expect(
      f.tags.merge(f.agent, { from: "c", into: "b", mutationKey }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("tag_index_excludes_blocked_and_trashed_for_agents", async () => {
    const f = await fixture();
    await f.save(fact("Visible", ["shared", "visible"]));
    const blocked = await f.save(fact("Blocked", ["shared", "hidden"]));
    await f.act(blocked, { action: "set_access", agentAccess: "blocked" });
    const trashed = await f.save(fact("Trashed", ["shared", "gone"]));
    await f.act(trashed, { action: "trash" });
    const finance = await f.save(
      fact("Finance only", ["shared", "ledger"], { scope: { workspace: "finances" } }),
    );
    // Effectively narrowed to Finance through its source.
    await f.save(
      fact("Derived", ["shared", "derived"], {
        evidence: [
          { type: "statement", wording: "The owner stated this explicitly." },
          { type: "domain_record", domain: "knowledge", id: finance.id, revision: 1 },
        ],
      }),
    );

    const agentIndex = await f.tags.index(f.agent);
    expect(agentIndex.tags).toEqual([
      { name: "shared", count: 1 },
      { name: "visible", count: 1 },
    ]);
    const ownerIndex = await f.tags.index(f.owner);
    expect(ownerIndex.tags).toEqual([
      { name: "shared", count: 4 },
      { name: "derived", count: 1 },
      { name: "hidden", count: 1 },
      { name: "ledger", count: 1 },
      { name: "visible", count: 1 },
    ]);
    expect((await f.tags.index(f.owner, { limit: 1 })).tags).toEqual([
      { name: "shared", count: 4 },
    ]);
    // An agent cannot merge a tag it cannot see on any memory.
    await expect(f.merge("hidden", "visible")).rejects.toMatchObject({ status: 404 });
  });

  it("tag_search_ranks_above_text_only", async () => {
    const f = await fixture();
    const textOnly = await f.save(fact("Alex is my partner at work", ["work"]));
    const tagged = await f.save(fact("Sarah", ["partner", "relationships"]));
    const page = await f.search.search(f.agent, { text: "partner" });
    expect(page.items.map(({ id }) => id)).toEqual([tagged.id, textOnly.id]);
    const byTag = await f.search.search(f.agent, { tags: ["relationships"] });
    expect(byTag.items.map(({ id }) => id)).toEqual([tagged.id]);
    const all = await f.search.search(f.agent, { tags: ["partner", "work"], tagMatch: "all" });
    expect(all.items).toEqual([]);
    const any = await f.search.search(f.agent, { tags: ["partner", "work"] });
    expect(any.items.map(({ id }) => id).sort()).toEqual([tagged.id, textOnly.id].sort());
  });

  it("tag_match_respects_an_excluded_word", async () => {
    const f = await fixture();
    const regular = await f.save(fact("Morning coffee", ["coffee"]));
    await f.save(fact("Evening coffee", ["coffee", "decaf"]));
    const page = await f.search.search(f.agent, { text: "coffee -decaf" });
    expect(page.items.map(({ id }) => id)).toEqual([regular.id]);
  });

  it("excluded_word_follows_an_alias_to_its_target", async () => {
    const f = await fixture();
    const regular = await f.save(fact("Morning coffee", ["coffee"]));
    await f.save(fact("Evening coffee", ["decaf"]));
    // The record now carries only the target, so its text and tags never say "decaf".
    await f.merge("decaf", "caffeine-free", f.owner);
    const page = await f.search.search(f.agent, { text: "coffee -decaf" });
    expect(page.items.map(({ id }) => id)).toEqual([regular.id]);
  });

  it("revise_sets_tags_and_agent_changes_to_owner_memory_are_proposals", async () => {
    const f = await fixture();
    const held = await f.save(fact("Owner value", ["home"]));
    const revised = await f.act(held, {
      action: "revise",
      content: held.content,
      tags: ["home", "Family"],
    });
    expect(revised).toMatchObject({
      outcome: "readable",
      record: { revision: held.revision + 1, tags: ["family", "home"] },
    });

    const current = await f.get(held.id);
    const proposal = await f.act(
      current,
      { action: "revise", content: current.content, tags: ["chores"] },
      f.agent,
    );
    expect(proposal).toMatchObject({
      outcome: "readable",
      record: { status: "proposed", tags: ["chores"] },
    });
    expect((await f.get(held.id)).tags).toEqual(["family", "home"]);
  });

  it("agent_cannot_unmerge", async () => {
    const f = await fixture();
    await f.save(fact("Rent", ["money"]));
    const merge = await f.merge("money", "finances");
    await expect(
      f.tags.unmerge(f.agent, { mergeId: merge.mergeId, mutationKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await f.tags.index(f.owner)).aliases).toHaveLength(1);
  });

  it("keeps tags owner-scoped", async () => {
    const first = await fixture();
    const second = await fixture();
    await first.save(fact("Rent", ["money"]));
    await first.merge("money", "finances");
    expect((await second.save(fact("Rent", ["money"]))).tags).toEqual(["money"]);
    expect((await second.tags.index(second.owner)).aliases).toEqual([]);
    await expect(second.merge("finances", "money")).rejects.toMatchObject({ status: 404 });
  });
});
