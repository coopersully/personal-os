import { createHash } from "node:crypto";
import {
  auditEvents,
  type Database,
  knowledgeRecords,
  knowledgeRecordTags,
  knowledgeTagAliases,
  knowledgeTagMerges,
  knowledgeTags,
} from "@personal-os/database";
import {
  type AccessScope,
  type KnowledgeTagIndex,
  type KnowledgeTagIndexInput,
  type KnowledgeTagMerge,
  type KnowledgeTagMergeInput,
  type KnowledgeTagUnmergeInput,
  knowledgeTagIndexInputSchema,
  knowledgeTagMergeInputSchema,
  knowledgeTagUnmergeInputSchema,
  normalizeKnowledgeTag,
} from "@personal-os/domain";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError, isUniqueViolation } from "../errors.js";
import type { Principal } from "../types.js";
import {
  bumpKnowledgeEpoch,
  createKnowledgeAccess,
  createKnowledgeDisclosureCache,
  currentKnowledgeForRetrieval,
  type KnowledgeDisclosureCache,
  type KnowledgeTransaction,
  knowledgeNotTrashed,
  projectKnowledgeRevision,
  requireKnowledgeOwner,
} from "./access.js";

type TagRow = { id: string; name: string };
/**
 * Whether this caller may follow an alias to the tag it names. Owners always may. An agent
 * follows an alias only to a tag some memory it can read carries; otherwise the alias reads as
 * an ordinary name, so an alias filed under hidden memory never reveals its target (R14).
 */
export type KnowledgeAliasGate = (target: TagRow) => Promise<boolean>;
const tagWriteScopes: AccessScope[] = ["knowledge:read", "knowledge:write"];
/** The core reserves room for this many tags; the app may ask for more. */
const defaultIndexLimit = 100;

function tagRequestHash(principal: Principal, operation: string, input: unknown) {
  return createHash("sha256")
    .update(JSON.stringify({ actorId: principal.actorId, operation, input }))
    .digest("hex");
}

async function findTag(tx: KnowledgeTransaction, userId: string, name: string) {
  const [tag] = await tx
    .select({ id: knowledgeTags.id, name: knowledgeTags.name })
    .from(knowledgeTags)
    .where(and(eq(knowledgeTags.userId, userId), eq(knowledgeTags.name, name)));
  return tag;
}

/** Aliases always point at a canonical tag: a merge repoints the aliases of the tag it files. */
async function findAliasTarget(tx: KnowledgeTransaction, userId: string, alias: string) {
  const [tag] = await tx
    .select({ id: knowledgeTags.id, name: knowledgeTags.name })
    .from(knowledgeTagAliases)
    .innerJoin(
      knowledgeTags,
      and(
        eq(knowledgeTags.userId, knowledgeTagAliases.userId),
        eq(knowledgeTags.id, knowledgeTagAliases.tagId),
      ),
    )
    .where(and(eq(knowledgeTagAliases.userId, userId), eq(knowledgeTagAliases.alias, alias)));
  return tag;
}

/** An alias this caller may follow, or an existing tag with this exact name. */
async function findKnownTag(
  tx: KnowledgeTransaction,
  userId: string,
  name: string,
  followAlias?: KnowledgeAliasGate,
) {
  const target = await findAliasTarget(tx, userId, name);
  if (target && (!followAlias || (await followAlias(target)))) return target;
  return findTag(tx, userId, name);
}

/**
 * The only similarity rule: a name that differs from a known owner tag by one trailing `s`, in
 * either direction, so `tips` finds `tip` and `tipss` alike. Dropping an `s` is tried first.
 */
function pluralVariants(name: string) {
  return [...(name.endsWith("s") && name.length > 1 ? [name.slice(0, -1)] : []), `${name}s`];
}

/**
 * Resolves one tag name: normalize, follow an alias, match an existing tag exactly or by its
 * trailing-`s` variant, then (when `create`) add the tag. Unknown names resolve to themselves
 * without an ID when `create` is false.
 */
async function resolveTag(
  tx: KnowledgeTransaction,
  userId: string,
  raw: string,
  create: boolean,
  followAlias?: KnowledgeAliasGate,
): Promise<TagRow | { id: null; name: string }> {
  const name = normalizeKnowledgeTag(raw);
  if (name === null)
    throw new AppError(
      "invalid_request",
      `The tag ${JSON.stringify(raw)} has no letters or numbers.`,
    );
  const known = await findKnownTag(tx, userId, name, followAlias);
  if (known) return known;
  for (const variant of pluralVariants(name)) {
    const similar = await findKnownTag(tx, userId, variant, followAlias);
    if (similar) return similar;
  }
  if (!create) return { id: null, name };
  await tx.insert(knowledgeTags).values({ userId, name }).onConflictDoNothing();
  const created = await findTag(tx, userId, name);
  if (!created) throw new AppError("internal_error", "The memory tag was not saved.");
  return created;
}

/** Canonical tag rows for a write, creating missing tags. The caller holds the owner lock. */
export async function resolveKnowledgeTagRows(
  tx: KnowledgeTransaction,
  userId: string,
  names: readonly string[],
  followAlias?: KnowledgeAliasGate,
): Promise<TagRow[]> {
  const rows = new Map<string, TagRow>();
  for (const name of names) {
    const tag = await resolveTag(tx, userId, name, true, followAlias);
    if (tag.id !== null) rows.set(tag.id, tag);
  }
  return [...rows.values()];
}

/** Canonical names for a read: aliases and plurals resolve; nothing is created. */
export async function lookupKnowledgeTags(
  tx: KnowledgeTransaction,
  userId: string,
  names: readonly string[],
  followAlias?: KnowledgeAliasGate,
): Promise<string[]> {
  const resolved = new Set<string>();
  for (const name of names)
    resolved.add((await resolveTag(tx, userId, name, false, followAlias)).name);
  return [...resolved];
}

/**
 * The alias gate for one caller in one transaction: none for the owner; for an agent, a tag
 * counts as visible when one current record it can read carries it. Disclosure runs only when
 * an alias is actually hit, and stops at the first readable record. Pass the caller's disclosure
 * cache to share that work with the rest of the request.
 */
export function knowledgeAliasGate(
  tx: KnowledgeTransaction,
  principal: Principal,
  access: ReturnType<typeof createKnowledgeAccess>,
  authorizedScopes: AccessScope[],
  checked: KnowledgeDisclosureCache = createKnowledgeDisclosureCache(),
): KnowledgeAliasGate | undefined {
  if (principal.actorType === "user") return undefined;
  let rows: Promise<Awaited<ReturnType<typeof currentKnowledgeForRetrieval>>> | undefined;
  const visible = new Map<string, Promise<boolean>>();
  return (target) => {
    let answer = visible.get(target.id);
    if (!answer) {
      rows ??= currentKnowledgeForRetrieval(tx, principal, {}, authorizedScopes).then((r) => r);
      answer = rows.then(async (current) => {
        for (const row of current) {
          if (!row.tags.includes(target.name)) continue;
          if (await access.visibleDisclosure(tx, principal, projectKnowledgeRevision(row), checked))
            return true;
        }
        return false;
      });
      visible.set(target.id, answer);
    }
    return answer;
  };
}

/** Replaces a record's tag links. Tags are record state: this never writes a revision. */
export async function replaceKnowledgeRecordTags(
  tx: KnowledgeTransaction,
  userId: string,
  recordId: string,
  tagIds: readonly string[],
) {
  await tx
    .delete(knowledgeRecordTags)
    .where(and(eq(knowledgeRecordTags.userId, userId), eq(knowledgeRecordTags.recordId, recordId)));
  if (tagIds.length)
    await tx
      .insert(knowledgeRecordTags)
      .values(tagIds.map((tagId) => ({ userId, recordId, tagId })))
      .onConflictDoNothing();
}

async function recordIdsTagged(tx: KnowledgeTransaction, userId: string, tagId: string) {
  const rows = await tx
    .select({ recordId: knowledgeRecordTags.recordId })
    .from(knowledgeRecordTags)
    .where(and(eq(knowledgeRecordTags.userId, userId), eq(knowledgeRecordTags.tagId, tagId)));
  return rows.map(({ recordId }) => recordId).sort();
}

function unprocessable(message: string) {
  return new AppError("unprocessable", message);
}

export function createKnowledgeTagService({ db, now }: { db: Database; now: () => Date }) {
  const admission = createKnowledgeAccess(now);

  /** Tag counts the caller may see: owners count every record outside Trash. */
  async function ownerCounts(tx: KnowledgeTransaction, userId: string) {
    const rows = await tx
      .select({ name: knowledgeTags.name, count: sql<number>`count(*)::int` })
      .from(knowledgeRecordTags)
      .innerJoin(
        knowledgeTags,
        and(
          eq(knowledgeTags.userId, knowledgeRecordTags.userId),
          eq(knowledgeTags.id, knowledgeRecordTags.tagId),
        ),
      )
      .innerJoin(
        knowledgeRecords,
        and(
          eq(knowledgeRecords.userId, knowledgeRecordTags.userId),
          eq(knowledgeRecords.id, knowledgeRecordTags.recordId),
        ),
      )
      .where(and(eq(knowledgeRecordTags.userId, userId), knowledgeNotTrashed))
      .groupBy(knowledgeTags.name);
    return new Map(rows.map(({ name, count }) => [name, count]));
  }

  /**
   * Counts only records that pass the same disclosure as a read by ID (trash, agent access,
   * workspace and inherited scopes, and effective narrowing), so `disclose` stays the one source
   * of truth and a hidden record never moves a count. `excludeSensitive` also leaves out records
   * that disclosure finds effectively sensitive, for indexes that load automatically.
   */
  async function disclosedCounts(
    tx: KnowledgeTransaction,
    principal: Principal,
    access: ReturnType<typeof createKnowledgeAccess>,
    authorizedScopes: AccessScope[],
    excludeSensitive = false,
  ) {
    const counts = new Map<string, number>();
    for (const row of await currentKnowledgeForRetrieval(tx, principal, {}, authorizedScopes)) {
      if (row.tags.length === 0) continue;
      const revision = projectKnowledgeRevision(row);
      const disclosure = await access.visibleDisclosure(tx, principal, revision);
      if (!disclosure) continue;
      if (excludeSensitive && disclosure.effectiveSensitivity !== "standard") continue;
      for (const tag of revision.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return counts;
  }

  async function presentMerge(
    tx: KnowledgeTransaction,
    merge: typeof knowledgeTagMerges.$inferSelect,
  ): Promise<KnowledgeTagMerge> {
    const [into] = await tx
      .select({ name: knowledgeTags.name })
      .from(knowledgeTags)
      .where(and(eq(knowledgeTags.userId, merge.userId), eq(knowledgeTags.id, merge.intoTagId)));
    if (!into) throw new AppError("internal_error", "The merged tag is missing.");
    return {
      mergeId: merge.id,
      from: merge.fromName,
      into: into.name,
      undoneAt: merge.undoneAt?.toISOString() ?? null,
    };
  }

  async function auditMerge(
    tx: KnowledgeTransaction,
    principal: Principal,
    action: "merged" | "unmerged",
    merge: Pick<typeof knowledgeTagMerges.$inferSelect, "id" | "intoTagId">,
    mutationKey: string,
    recordCount: number,
  ) {
    // Tag names can carry personal meaning; audit keeps IDs and counts only.
    await tx.insert(auditEvents).values(
      auditValues({
        action: `knowledge.tags.${action}`,
        entityType: "knowledge_tag_merge",
        entityId: merge.id,
        principal,
        requestId: mutationKey,
        before: null,
        after: { mergeId: merge.id, intoTagId: merge.intoTagId, recordCount },
      }),
    );
  }

  return {
    resolve(tx: KnowledgeTransaction, userId: string, names: string[]) {
      return resolveKnowledgeTagRows(tx, userId, names).then((rows) =>
        rows.map(({ name }) => name),
      );
    },

    /**
     * Canonical tags most used first. The person also gets the aliases that resolve to them;
     * agents never do, since an alias can name a tag that only hidden memory ever carried (R14).
     * `excludeSensitive` is for the session-start core, which never loads sensitive memory
     * automatically (R16): a tag only effectively sensitive memory carries is left out.
     */
    async index(
      principal: Principal,
      raw: KnowledgeTagIndexInput = {},
      { excludeSensitive = false }: { excludeSensitive?: boolean } = {},
    ): Promise<KnowledgeTagIndex> {
      const { limit = defaultIndexLimit } = knowledgeTagIndexInputSchema.parse(raw);
      return db.transaction(async (tx) => {
        const { at, authority } = await admission.admit(tx, principal, ["knowledge:read"], "read");
        const access = createKnowledgeAccess(() => at);
        const counts =
          principal.actorType === "user" && !excludeSensitive
            ? await ownerCounts(tx, principal.userId)
            : await disclosedCounts(tx, principal, access, authority.scopes, excludeSensitive);
        const tags = [...counts]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
          .slice(0, limit);
        const listed = tags.map(({ name }) => name);
        const aliases =
          listed.length && principal.actorType === "user"
            ? await tx
                .select({
                  alias: knowledgeTagAliases.alias,
                  name: knowledgeTags.name,
                  mergeId: knowledgeTagAliases.mergeId,
                })
                .from(knowledgeTagAliases)
                .innerJoin(
                  knowledgeTags,
                  and(
                    eq(knowledgeTags.userId, knowledgeTagAliases.userId),
                    eq(knowledgeTags.id, knowledgeTagAliases.tagId),
                  ),
                )
                .where(
                  and(
                    eq(knowledgeTagAliases.userId, principal.userId),
                    inArray(knowledgeTags.name, listed),
                  ),
                )
                .orderBy(knowledgeTagAliases.alias)
            : [];
        return { tags, aliases };
      });
    },

    /**
     * Files tag `from` under `into` on every record, owner-held and trashed ones included,
     * without a new revision. `from` becomes an alias of `into`.
     */
    async merge(principal: Principal, raw: KnowledgeTagMergeInput): Promise<KnowledgeTagMerge> {
      const input = knowledgeTagMergeInputSchema.parse(raw);
      const requestHash = tagRequestHash(principal, "merge", input);
      return db.transaction(async (tx) => {
        const { at, authority } = await admission.admit(tx, principal, tagWriteScopes);
        const { userId } = principal;
        const [prior] = await tx
          .select()
          .from(knowledgeTagMerges)
          .where(
            and(
              eq(knowledgeTagMerges.userId, userId),
              eq(knowledgeTagMerges.mutationKey, input.mutationKey),
            ),
          );
        if (prior) {
          if (prior.requestHash !== requestHash)
            throw new AppError("conflict", "This mutation key was used for another request.");
          return presentMerge(tx, prior);
        }
        const notFound = new AppError("not_found", "The memory tag was not found.");
        // Visibility first (R14): an agent learns nothing about aliases, cycles or tags that
        // only hidden memory carries. Both tags must be on a memory this agent can read; a
        // target that does not exist yet is created.
        if (principal.actorType === "agent") {
          const visible = await disclosedCounts(
            tx,
            principal,
            createKnowledgeAccess(() => at),
            authority.scopes,
          );
          const target = await resolveTag(tx, userId, input.into, false);
          if (!visible.has(input.from) || (target.id !== null && !visible.has(target.name)))
            throw notFound;
        }
        if (input.from === input.into) throw unprocessable("A tag cannot be merged into itself.");
        if (await findAliasTarget(tx, userId, input.from))
          throw unprocessable("This tag is already merged into another tag.");
        const from = await findTag(tx, userId, input.from);
        if (!from) throw notFound;
        const into = await resolveKnowledgeTagRows(tx, userId, [input.into]).then(([tag]) => tag);
        if (!into) throw new AppError("internal_error", "The target tag was not resolved.");
        if (into.id === from.id) throw unprocessable("Merging these tags would form a cycle.");

        const recordIds = await recordIdsTagged(tx, userId, from.id);
        const carried = await tx
          .select({ alias: knowledgeTagAliases.alias })
          .from(knowledgeTagAliases)
          .where(
            and(eq(knowledgeTagAliases.userId, userId), eq(knowledgeTagAliases.tagId, from.id)),
          );
        const intoRecordIds = new Set(await recordIdsTagged(tx, userId, into.id));
        if (recordIds.length)
          await tx
            .insert(knowledgeRecordTags)
            .values(recordIds.map((recordId) => ({ userId, recordId, tagId: into.id })))
            .onConflictDoNothing();
        await tx
          .delete(knowledgeRecordTags)
          .where(
            and(eq(knowledgeRecordTags.userId, userId), eq(knowledgeRecordTags.tagId, from.id)),
          );
        const [merge] = await tx
          .insert(knowledgeTagMerges)
          .values({
            userId,
            fromName: from.name,
            intoTagId: into.id,
            actorType: principal.actorType,
            actorId: principal.actorId,
            recordIds,
            keptIntoRecordIds: recordIds.filter((id) => intoRecordIds.has(id)),
            carriedAliases: carried.map(({ alias }) => alias).sort(),
            mutationKey: input.mutationKey,
            requestHash,
            createdAt: at,
          })
          .returning();
        if (!merge) throw new AppError("internal_error", "The tag merge was not saved.");
        // Aliases stay flat: names that resolved to `from` now resolve to `into`.
        await tx
          .update(knowledgeTagAliases)
          .set({ tagId: into.id })
          .where(
            and(eq(knowledgeTagAliases.userId, userId), eq(knowledgeTagAliases.tagId, from.id)),
          );
        await tx.insert(knowledgeTagAliases).values({
          userId,
          alias: from.name,
          tagId: into.id,
          mergeId: merge.id,
          createdAt: at,
        });
        await auditMerge(tx, principal, "merged", merge, input.mutationKey, recordIds.length);
        await bumpKnowledgeEpoch(tx, userId);
        return presentMerge(tx, merge);
      });
    },

    /**
     * Person-only undo: restores `from` on the records the merge retagged that are still live,
     * takes the target off those that did not already carry it, and removes the alias.
     */
    async unmerge(principal: Principal, raw: KnowledgeTagUnmergeInput): Promise<KnowledgeTagMerge> {
      const input = knowledgeTagUnmergeInputSchema.parse(raw);
      requireKnowledgeOwner(principal);
      return db.transaction(async (tx) => {
        const { at } = await admission.admit(tx, principal, tagWriteScopes);
        const { userId } = principal;
        const [merge] = await tx
          .select()
          .from(knowledgeTagMerges)
          .where(
            and(eq(knowledgeTagMerges.userId, userId), eq(knowledgeTagMerges.id, input.mergeId)),
          )
          .for("update");
        if (!merge) throw new AppError("not_found", "The tag merge was not found.");
        if (merge.undoneAt) {
          if (merge.undoMutationKey === input.mutationKey) return presentMerge(tx, merge);
          throw new AppError("conflict", "This tag merge was already undone.");
        }
        // Undo never strips a tag a later merge added (R13): while a later merge still files
        // this merge's target under another tag, the person undoes that one first.
        const blocking = await tx
          .select({ id: knowledgeTagMerges.id })
          .from(knowledgeTagMerges)
          .innerJoin(
            knowledgeTags,
            and(
              eq(knowledgeTags.userId, knowledgeTagMerges.userId),
              eq(knowledgeTags.id, merge.intoTagId),
            ),
          )
          .where(
            and(
              eq(knowledgeTagMerges.userId, userId),
              eq(knowledgeTagMerges.fromName, knowledgeTags.name),
              isNull(knowledgeTagMerges.undoneAt),
            ),
          )
          .orderBy(knowledgeTagMerges.id);
        if (blocking.length)
          throw new AppError("conflict", "Undo the later merge of this tag first.", {
            blockingMergeIds: blocking.map(({ id }) => id),
          });
        // With no later merge of the target, the alias still resolves to it.
        const targetId = merge.intoTagId;
        await tx
          .insert(knowledgeTags)
          .values({ userId, name: merge.fromName })
          .onConflictDoNothing();
        const from = await findTag(tx, userId, merge.fromName);
        if (!from) throw new AppError("internal_error", "The original tag was not restored.");
        const live = merge.recordIds.length
          ? await tx
              .select({ id: knowledgeRecords.id })
              .from(knowledgeRecords)
              .where(
                and(
                  eq(knowledgeRecords.userId, userId),
                  inArray(knowledgeRecords.id, merge.recordIds),
                  isNull(knowledgeRecords.trashedAt),
                ),
              )
          : [];
        const liveIds = live.map(({ id }) => id);
        // This merge put the target on the records it did not find carrying it. Where another
        // active merge into the same target also retagged such a record, that merge took the
        // target as already present; it now owns it, so its own undo removes it later.
        const kept = new Set(merge.keptIntoRecordIds);
        const added = new Set(liveIds.filter((id) => !kept.has(id)));
        const others = await tx
          .select({
            id: knowledgeTagMerges.id,
            recordIds: knowledgeTagMerges.recordIds,
            keptIntoRecordIds: knowledgeTagMerges.keptIntoRecordIds,
          })
          .from(knowledgeTagMerges)
          .where(
            and(
              eq(knowledgeTagMerges.userId, userId),
              eq(knowledgeTagMerges.intoTagId, targetId),
              isNull(knowledgeTagMerges.undoneAt),
              ne(knowledgeTagMerges.id, merge.id),
            ),
          )
          .for("update");
        for (const other of others) {
          for (const id of other.recordIds) kept.add(id);
          const owned = other.keptIntoRecordIds.filter((id) => !added.has(id));
          if (owned.length !== other.keptIntoRecordIds.length)
            await tx
              .update(knowledgeTagMerges)
              .set({ keptIntoRecordIds: owned })
              .where(
                and(eq(knowledgeTagMerges.userId, userId), eq(knowledgeTagMerges.id, other.id)),
              );
        }
        if (liveIds.length) {
          await tx
            .insert(knowledgeRecordTags)
            .values(liveIds.map((recordId) => ({ userId, recordId, tagId: from.id })))
            .onConflictDoNothing();
          const retagged = liveIds.filter((id) => !kept.has(id));
          if (retagged.length)
            await tx
              .delete(knowledgeRecordTags)
              .where(
                and(
                  eq(knowledgeRecordTags.userId, userId),
                  eq(knowledgeRecordTags.tagId, targetId),
                  inArray(knowledgeRecordTags.recordId, retagged),
                ),
              );
        }
        await tx
          .delete(knowledgeTagAliases)
          .where(
            and(eq(knowledgeTagAliases.userId, userId), eq(knowledgeTagAliases.mergeId, merge.id)),
          );
        // Exactly the aliases this merge carried along resolve to `from` again.
        if (merge.carriedAliases.length)
          await tx
            .update(knowledgeTagAliases)
            .set({ tagId: from.id })
            .where(
              and(
                eq(knowledgeTagAliases.userId, userId),
                eq(knowledgeTagAliases.tagId, targetId),
                inArray(knowledgeTagAliases.alias, merge.carriedAliases),
              ),
            );
        let undone: typeof merge | undefined;
        try {
          [undone] = await tx
            .update(knowledgeTagMerges)
            .set({ undoneAt: at, undoMutationKey: input.mutationKey })
            .where(and(eq(knowledgeTagMerges.userId, userId), eq(knowledgeTagMerges.id, merge.id)))
            .returning();
        } catch (error) {
          if (isUniqueViolation(error, "knowledge_tag_merges_owner_undo_key_idx"))
            throw new AppError("conflict", "This mutation key was used for another request.");
          throw error;
        }
        if (!undone) throw new AppError("internal_error", "The tag merge was not undone.");
        await auditMerge(tx, principal, "unmerged", merge, input.mutationKey, liveIds.length);
        await bumpKnowledgeEpoch(tx, userId);
        return presentMerge(tx, undone);
      });
    },
  };
}
