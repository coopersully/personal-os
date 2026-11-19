# Agent-Managed Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the taken-over Codex memory branch into agent-managed persistent memory: tags, a
session-start core, readable sensitive memories, Trash instead of erasure, default memory scopes,
and web and iPhone Memory screens.

**Architecture:** Rework the existing PostgreSQL knowledge foundation in place. Domain Zod schemas
in `packages/domain/src/knowledge*.ts` stay the contract. API services in
`apps/api/src/knowledge/` own authority, retrieval and purge. The typed client
(`packages/api-client/src/features/knowledge.ts`) and MCP tools (`apps/mcp/src/tools/knowledge.ts`)
stay thin adapters. Web and iPhone screens consume the same API. All schema lives in one
unpublished migration, `0146_persistent_memory.sql`, which tasks edit in place until PR 1 merges.

**Tech Stack:** TypeScript, Zod, PostgreSQL/Drizzle (hand-written SQL migrations), Hono, MCP SDK,
React (web), Expo (iPhone), Vitest, Playwright.

**Spec:** [Persistent memory: agent-managed completion design](../specs/2026-11-15-persistent-memory-design.md).
Read it before any task; section numbers below (§) refer to it.

## Starting state

- Branch `cooper/coo-165-agent-managed-memory` is one squashed commit on top of `origin/main`. It
  holds the Codex work through `c60b4bb9` plus the uncommitted iPhone screen. Full history is on
  `backup/coo-165-codex-c60b4bb9`.
- The nine branch migrations are already concatenated, unchanged, into
  `packages/database/migrations/0146_persistent_memory.sql` (journal idx 151). The recovery
  migrations and their test were dropped.
- First `pnpm typecheck` on the rebased branch stopped at one error:
  `apps/mobile/src/features/settings/agent-copy.ts` lacks labels for `knowledge:read` and
  `knowledge:write`. Because pnpm stops at the first failing package, later packages are
  unchecked. Tests have not been run. Task 1 establishes the baseline.

## Global Constraints

- Memory never grants authority: no memory, scope or tag changes a grant, scope or workspace policy.
- Value limit 8 KiB; at most 20 sources and 20 relationships per mutation (existing).
- Tags: 1–8 per memory; normalized form ≤ 40 characters; NFC, lowercase, trim, runs of spaces or
  underscores become one `-`, other punctuation stripped; a trailing-`s` variant of an existing
  owner tag maps to it. No other similarity logic.
- Core (`get_ilo_context` memory section): ≤ 4 KiB serialized UTF-8 (4096 bytes). Tag index
  reserved 1 KiB, ≤ 100 tags. Core records fill the remaining 3 KiB, ≤ 30 records. Records are never cut
  mid-content; a record whose content exceeds 1 KiB appears as id + one-line label.
- Workflow memory sections (`maintain_finances`, `maintain_mail`): ≤ 16 KiB.
- Search limit 1–50, default 20; text ≤ 500 chars; cursors bind actor, filters and epoch, expire
  after 15 minutes (existing).
- Trash: recoverable 30 days, then purged. The purge job runs at least daily. Person-only: trash,
  restore, delete now, confirm, widen restriction, set `agentAccess`, lower sensitivity, export,
  unmerge tags.
- Only the person can lower sensitivity; agents may raise it. Sensitive records are never in the core
  or workflow sections. `agentAccess: blocked` hides a record from agents on every path and in every
  count.
- An agent revise/supersede of an owner-held record creates a linked `proposed` record (conflict);
  it never overwrites.
- Repository rules: Sonner for all action feedback with no inline result banners; the native
  pull-to-refresh exception; glyphs only via `@/components/icons`; user-facing name `nohmi`
  (lowercase); no offline memory cache or write queue; owner-scoped caches cleared on logout.
- No vector search, no learning rule, no external deletion ledger, no `explain_context`.
- Do not modify `~/.codex/worktrees/53ab/personal-os`. Merging any PR requires Cooper's explicit
  go-ahead.

## Review Focus

- An agent pages through search results when the person trashes a record mid-way: the next page
  and counts must not show it. Owned by Task 3, test `trash_invalidates_open_cursors`.
- An agent sends a tag that normalizes to nothing (`"!!!"`, `"   "`): reject with a validation
  error naming the tag, never store an empty tag. Owned by Task 5, test `rejects_empty_normalized_tag`.
- The person restores a record whose derived copy was trashed separately earlier: restore brings
  back only the records trashed together with it. Owned by Task 3, test
  `restore_returns_only_its_trash_group`.
- Core budget with emoji or CJK content: the 4096-byte budget is measured in UTF-8 bytes, not
  characters. Owned by Task 7, test `core_budget_counts_utf8_bytes`.
- Tag merge cycles (`a→b` then `b→a`, or `a→a`): reject without changing any record. Owned by
  Task 5, test `rejects_tag_merge_cycles`.

---

## PR 1 — API, MCP, database and docs (branch `cooper/coo-165-agent-managed-memory`)

### Task 1: Establish a green baseline and trim out-of-scope changes

**Files:**
- Modify: whatever fails `pnpm typecheck` after the rebase
- Revert to `origin/main`: every non-memory doc the squashed commit changed. That means
  `docs/architecture/0004-workspace-stewardship.md`, `docs/architecture/0006-texting-inbox.md`,
  `docs/product/automation-hosts.md`, `docs/product/finance-workspace-plan.md`,
  `docs/product/texting-operations.md`, `docs/product/workspace-charter-template.md`,
  `docs/product/workspace-settings.md`, `docs/product/workspace-stewardship.md`,
  `docs/product/workspaces.md`, `docs/product/master-design.md`,
  `docs/engineering/finance-texting-spec-reconciliation.md`,
  `docs/superpowers/plans/2026-09-13-finance-mvp.md`, `docs/superpowers/plans/finance-mvp-handoffs.md`,
  and every `docs/superpowers/{plans,specs}/2026-09-28-*` / `2026-10-12-*` file (delete if new).
  They remain on `backup/coo-165-codex-c60b4bb9`.
- Modify: `docs/superpowers/specs/2026-11-12-persistent-memory-design.md` and
  `docs/superpowers/plans/2026-11-12-persistent-memory.md`, changing the first status line to
  `Superseded by 2026-11-15-persistent-memory-design.md`.
- Add: this plan and the 2026-11-15 spec.

**Interfaces:** Produces a branch where `pnpm typecheck` passes and the knowledge test suites run.

- [ ] **Step 1:** Run `pnpm typecheck`. Fix rebase fallout (renamed imports, changed main
  signatures) with the smallest change that keeps the branch's existing behavior. Do not start the
  rework here.
- [ ] **Step 2:** Start the worktree runtime database (`pnpm env:start` in a separate terminal tab)
  and run
  `pnpm exec vitest run apps/api/src/knowledge integration/workspace-agent/knowledge-records.integration.test.ts integration/workspace-agent/knowledge-lifecycle.integration.test.ts packages/domain/src/knowledge-lifecycle.test.ts apps/api/src/routes/knowledge.test.ts apps/mcp/src/tool-catalog.test.ts apps/mcp/src/http-contract.test.ts`.
  Expected: the migration applies on a fresh database and the suites run. Record any failures in the
  task report. Fix only failures caused by the rebase.
- [ ] **Step 3:** Restore the out-of-scope docs listed above:
  `git checkout origin/main -- <paths>` for modified files, and `git rm` for files that are new on this branch.
- [ ] **Step 4:** Commit: `chore: rebase memory takeover onto main and trim unrelated changes`.

### Task 2: Remove the learning machinery

**Files:**
- Delete: `packages/domain/src/knowledge-learning.ts`, `apps/api/src/knowledge/learning-service.ts`,
  `apps/api/src/knowledge/learning-evidence.ts`,
  `apps/api/src/knowledge/learning-service.integration.test.ts`,
  `apps/web/src/features/knowledge/learning-settings.tsx`, `apps/mobile/src/features/knowledge/learning.tsx`
- Modify: `packages/domain/src/index.ts`, `packages/domain/src/knowledge.ts`
  (`knowledgeAcceptanceSchema` keeps only `kind: "owner"`; drop `selectionGeneration` from
  `knowledgeRevisionMetadataSchema`), `packages/domain/src/knowledge-retrieval.ts` (drop
  `recentSelections` and the `recentSelection` schema from `knowledgeContextPackSchema`),
  `apps/api/src/routes/knowledge.ts` (drop `/settings`, `/selection-interactions`, `/selections`,
  `/learning-reset`), `apps/api/src/knowledge/access.ts` (drop `knowledgeSelectionSupport`),
  `apps/api/src/knowledge/record-service.ts` (drop `applyOwnerPreference` if only learning uses it),
  `apps/api/src/app.ts` (composition), `packages/api-client/src/features/knowledge.ts` (drop
  `getKnowledgeSettings`, `updateKnowledgeSettings`, `issueKnowledgeSelectionInteraction`,
  `recordKnowledgeSelection`, `resetKnowledgeLearning`), `packages/database/src/schema.ts` (drop
  `knowledgeSelectionInteractions`, `knowledgeLearningSettings`, `knowledgeLearningSuppressions`,
  `knowledgeLearningReceipts`), `0146_persistent_memory.sql` (drop the 0141 learning section and
  any later statements touching those tables), and web/mobile screens that import learning.
- Test: `apps/api/src/routes/knowledge.test.ts`

**Interfaces:** Produces no new names. Later tasks must not reference anything removed here.

- [ ] **Step 1: Write the failing test** `removed_learning_routes_are_gone` in
  `apps/api/src/routes/knowledge.test.ts`: authenticated `GET /v1/knowledge/settings`,
  `POST /v1/knowledge/selections`, `POST /v1/knowledge/selection-interactions` and
  `POST /v1/knowledge/learning-reset` each return 404.
- [ ] **Step 2:** Run `pnpm exec vitest run apps/api/src/routes/knowledge.test.ts`. Expected: FAIL (200/4xx validation).
- [ ] **Step 3:** Remove everything listed under Files; fix references until `pnpm typecheck` passes.
- [ ] **Step 4:** Run the Task 1 Step 2 suite list without the learning test. Expected: PASS.
- [ ] **Step 5:** Commit: `refactor: remove the three-selection learning rule`.

### Task 3: Replace forgetting with Trash, restore, delete now and purge

**Files:**
- Delete: `apps/api/src/knowledge/forget-service.ts`, `forget-erasure.ts`, `forget-suppression.ts`,
  `forget-service.integration.test.ts`; the forget schemas in
  `packages/domain/src/knowledge-lifecycle.ts`; routes `/forget`, `/:id/forget-preview`,
  `/operations*`; client methods `previewKnowledgeForget`, `forgetKnowledge`,
  `listActiveKnowledgeForgetOperations`, `getKnowledgeForgetStatus`, `retryKnowledgeForget`; tables
  `knowledgeForgetOperations`, `knowledgeForgetTargets`, `knowledgeForgetPreviews`,
  `knowledgeForgetSuppressions`, `knowledgeForgetReplayBindings`, and their SQL; the owner-wide
  erasure fence (`assertKnowledgeContentAvailable` and `knowledgeErasurePendingReason` usage);
  the forget-key configuration in `apps/api/src/main.ts`.
- Create: `apps/api/src/knowledge/trash-service.ts`, `apps/api/src/knowledge/purge-service.ts`,
  `apps/api/src/knowledge/trash.integration.test.ts`
- Modify: `packages/database/src/schema.ts` and `0146`: add `trashed_at timestamptz NULL`,
  `trash_group_id uuid NULL` and `status_before_trash text NULL` to `knowledge_records`. Add table
  `knowledge_tombstones (user_id, record_id, trashed_at, purged_at, PRIMARY KEY (user_id, record_id))`.
- Modify: `packages/domain/src/knowledge-lifecycle.ts` (owner actions `trash`, `restore`,
  `delete_now`), `knowledge.ts` (record gains `trashedAt: isoDateTime | null`),
  `apps/api/src/knowledge/lifecycle-service.ts`, `access.ts`, `search-service.ts`,
  `context-service.ts`, `export-service.ts`, `record-service.ts` (receipt replay),
  `apps/api/src/app.ts` (register purge loop next to the existing background loops around the
  `{ name: "context", run: ... }` list).

**Interfaces:**
- Consumes: derivation edges via `knowledgeRevisionDerivations` in `access.ts`.
- Produces:
  - `knowledgeLifecycleInputSchema` actions `trash | restore | delete_now`, each
    `{ recordId, expectedRevision, mutationKey }`.
  - `createKnowledgeTrashService({ db, now }): { trash(principal, input), restore(principal, input), deleteNow(principal, input) }`
    returning `KnowledgeMutationResult`.
  - `createKnowledgePurgeService({ db, now }): { purgeExpired(options: { limit: number }): Promise<{ purged: number }> }`.
  - `knowledgeTrashRetentionMs = 30 * 24 * 60 * 60 * 1000` exported from domain.
  - `KnowledgeRecord.trashedAt`.
  - A trashed record is excluded by one shared predicate in `access.ts`, `isKnowledgeVisibleToAgent(record)`
    (Task 4 extends it), and owner browse shows it only when `status: "trashed"` is queried.

- [ ] **Step 1: Write the failing tests** in `trash.integration.test.ts`:
  - `trash_hides_record_and_derived_copies_from_agents`: create A, derive B from A; owner trashes A
    → agent `get_knowledge` A and B return 404; search, counts and context omit both; owner browse
    with `status: "trashed"` lists both with the same `trashGroupId`.
  - `restore_returns_only_its_trash_group` *(Review Focus)*: derive B from A; trash B; then trash A;
    restore A → A active; B still trashed.
  - `trash_invalidates_open_cursors` *(Review Focus)*: agent gets page 1 (limit 1) with cursor;
    owner trashes the next record; agent follows cursor → 409 stale (epoch changed) and a fresh query
    omits the record.
  - `purge_after_30_days_leaves_only_tombstone`: trash; advance `now` by 30 days + 1 ms; `purgeExpired`
    → `knowledge_revisions`, `knowledge_sources`, record-tag links (after Task 5) for the record are
    gone; `knowledge_tombstones` row exists; other records' revisions still contain its ID unchanged;
    `get_knowledge` on it returns `{ state: "forgotten" }` for the owner and 404 for agents.
  - `delete_now_purges_immediately` and `purge_is_idempotent` (second run purges 0).
  - `replay_after_trash_is_content_free`: retry the original save mutation key after trash → receipt
    with no `record` field.
  - `agent_cannot_trash_restore_or_delete_now` → 403 for each.
- [ ] **Step 2:** Run `pnpm exec vitest run apps/api/src/knowledge/trash.integration.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Remove the forget machinery listed under Files.
- [ ] **Step 4:** Implement trash/restore/delete-now in `trash-service.ts`. Trash collects the
  transitive derivation closure of the target among non-trashed records, sets `trashed_at`,
  `trash_group_id` = target id, `status_before_trash`, and bumps the owner epoch with
  `bumpKnowledgeEpoch`. Restore reverses only rows with that `trash_group_id`. Person-only via
  `requireLiveKnowledgeHumanSession`.
- [ ] **Step 5:** Implement `purgeExpired` in `purge-service.ts`. In one transaction per record
  (batch ≤ 100), it deletes revisions, revision metadata, sources, relationships where the record
  is either side, derivations, tag links and receipt payloads (null the stored response; keep the
  key and hash so replay stays content-free), then the record row, and inserts the tombstone. It
  is safe to rerun. Register a background loop that calls `purgeExpired({ limit: 100 })` at most
  every 6 hours.
- [ ] **Step 6:** Run the test file plus the Task 1 suite list. Expected: PASS.
- [ ] **Step 7:** Commit: `feat: replace memory forgetting with trash and timed purge`.

### Task 4: Agent-managed authority, ownership, sensitivity and optional purposes

**Files:**
- Modify: `packages/domain/src/knowledge.ts`, `knowledge-lifecycle.ts`, `knowledge-retrieval.ts`;
  `apps/api/src/knowledge/access.ts`, `record-service.ts`, `lifecycle-service.ts`,
  `search-service.ts`, `context-service.ts`, `retrieval-session.ts`, `history-page.ts`;
  `packages/database/src/schema.ts` and `0146`: add to `knowledge_records` the columns
  `owner_held boolean NOT NULL DEFAULT false`, `agent_access text NOT NULL DEFAULT 'allowed'` with
  CHECK in (`allowed`, `blocked`), `core boolean NOT NULL DEFAULT false`, and
  `last_confirmed_at timestamptz NULL`. Add `archived` to the status CHECK.
- Create: `apps/api/src/knowledge/authority.integration.test.ts`

**Interfaces:**
- Produces (domain):
  - `knowledgeMutationInputSchema`: `purposes` becomes optional (omitted = all purposes); adds
    `core: boolean` (default false). `tags` is added in Task 5.
  - `knowledgeReadInputSchema`, `knowledgeQuerySchema`, `knowledgeHistoryInputSchema`: `purpose` optional.
    `knowledgeQuerySchema` also gains `origin?: "stated" | "inferred"`; its `status` accepts
    `archived` (and `trashed`, owner only, after Task 3).
  - `KnowledgeRecord` adds `ownerHeld: boolean`, `agentAccess: "allowed" | "blocked"`,
    `core: boolean`, `lastConfirmedAt: isoDateTime | null`; status enum adds `"archived"`.
  - Agent actions (`knowledgeAgentLifecycleInputSchema`): `revise` (content, evidence,
    relatedRecordIds, validity, `core?`), `supersede`, `dispute`, `archive`, `unarchive`,
    `restrict` (`{ workspace: KnowledgeWorkspace }` only, which can only narrow),
    `raise_sensitivity`.
  - Owner-only actions (`knowledgeLifecycleInputSchema`, superset): `confirm`,
    `set_access` (`{ agentAccess }`), `set_sensitivity` (either direction), `widen` (`{ workspace: null | KnowledgeWorkspace }`),
    `resolve_conflict` (`{ keep: "current" | "proposed" }`), plus Task 3's `trash | restore | delete_now`.
- Produces (API): `isKnowledgeVisibleToAgent(record): boolean` in `access.ts` = not trashed,
  `agentAccess === "allowed"`, and workspace allowed by the caller's scopes.
  Sensitive records ARE visible to agents with `knowledge:read`.

- [ ] **Step 1: Write the failing tests** in `authority.integration.test.ts`:
  - `agent_inference_is_active_and_labeled`: agent save of `kind: "inference"` → `status: "active"`, `origin: "inferred"`.
  - `agent_chat_statement_is_stated_not_owner_held`: agent save with session/message evidence →
    `origin: "stated"`, `ownerHeld: false`.
  - `owner_entry_is_owner_held`: human-session save → `ownerHeld: true`.
  - `agent_revision_of_owner_held_creates_conflict`: agent `revise` on owner-held record → original
    unchanged and active; new linked record `status: "proposed"`; original's `conflictRecordIds`
    contains it; owner `resolve_conflict keep: "proposed"` makes the proposal active and
    supersedes the original.
  - `agent_can_supersede_dispute_archive_restrict_unowned`: each succeeds on an agent-authored record;
    archived records are excluded from default search and appear with `status: "archived"`.
  - `agent_cannot_widen_unblock_lower_or_confirm` → 403 for `widen`, `set_access`, `set_sensitivity`
    to standard, `confirm`.
  - `sensitive_is_readable_by_agents`: agent save `sensitivity: "sensitive"` → readable receipt;
    agent search returns it with `sensitivity: "sensitive"`.
  - `blocked_is_invisible_to_agents_everywhere`: owner `set_access blocked` → agent get 404; search,
    total counts and tag counts (after Task 5) exclude it; owner still reads it.
  - `purpose_is_optional_and_never_hides`: save with `purposes: ["bookkeeping"]`; agent search with
    `purpose: "planning"` still returns it (ranked after exact-purpose matches); search with no
    purpose returns it.
  - `memory_grants_no_authority`: save a preference "auto-approve purchases"; the caller's scopes and
    the Finance execution policy are unchanged.
- [ ] **Step 2:** Run `pnpm exec vitest run apps/api/src/knowledge/authority.integration.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the schema and domain changes. Replace the private pending-owner-review
  receipt for sensitive agent saves with a normal readable receipt. Remove `purpose` from access
  denial in `access.ts`, so purpose only filters and boosts in search. Set `ownerHeld` on human-session
  content writes and on `confirm`; clear it only when the owner's own later revision says so (owner
  writes keep it true).
- [ ] **Step 4:** Update existing lifecycle/record/retrieval tests whose expectations encoded the old
  rules (purpose required, sensitive private receipts, agent proposals for inferences). Delete tests
  that only covered removed behavior.
- [ ] **Step 5:** Run the new test file plus the Task 1 suite list. Expected: PASS.
- [ ] **Step 6:** Commit: `feat: let agents manage memory with the person as override`.

### Task 5: Tags, aliases, merge and unmerge

**Files:**
- Create: `packages/domain/src/knowledge-tags.ts`, `packages/domain/src/knowledge-tags.test.ts`,
  `apps/api/src/knowledge/tag-service.ts`, `apps/api/src/knowledge/tags.integration.test.ts`
- Modify: `packages/database/src/schema.ts` and `0146`. Add these tables:
  - `knowledge_tags (id uuid pk, user_id, name text, created_at, UNIQUE(user_id, name))`
  - `knowledge_record_tags (user_id, record_id, tag_id, PRIMARY KEY(user_id, record_id, tag_id))`,
    with both foreign keys owner-composite and cascading
  - `knowledge_tag_aliases (user_id, alias text, tag_id, merge_id uuid, created_at, PRIMARY KEY(user_id, alias))`
  - `knowledge_tag_merges (id uuid pk, user_id, from_name, into_tag_id, actor_type, actor_id, record_ids uuid[], created_at, undone_at)`
- Modify: domain mutation/revise schemas (`tags`), `KnowledgeRecord.tags: string[]`, query schema
  (`tags?: string[]` max 8, `tagMatch?: "any" | "all"` default `"any"`), `record-service.ts`,
  `lifecycle-service.ts`, `search-service.ts`, routes, client, MCP.

**Interfaces:**
- Produces (domain):
  - `normalizeKnowledgeTag(raw: string): string | null`: returns null when the result is empty.
  - `knowledgeTagsInputSchema = z.array(z.string()).min(1).max(8)`: transforms via
    `normalizeKnowledgeTag`, rejects nulls with a message naming the raw tag, and dedupes.
  - `knowledgeTagMaxLength = 40`.
  - `knowledgeTagMergeInputSchema = { from: string, into: string, mutationKey: uuid }`;
    `knowledgeTagUnmergeInputSchema = { mergeId: uuid, mutationKey: uuid }`.
  - `knowledgeTagIndexSchema = { tags: Array<{ name: string, count: number }>, aliases: Array<{ alias: string, name: string }> }`.
- Produces (API): `createKnowledgeTagService({ db, now }): { resolve(tx, userId, names: string[]): Promise<string[]>, index(principal, options?: { limit: number }): Promise<KnowledgeTagIndex>, merge(principal, input), unmerge(principal, input) }`.
  `resolve` applies alias lookup, then the trailing-`s` rule against existing owner tags, then
  creates missing tags. Routes: `GET /v1/knowledge/tags`, `POST /v1/knowledge/tags/merge`,
  `POST /v1/knowledge/tags/unmerge` (person only). Client: `listKnowledgeTags`,
  `mergeKnowledgeTags`, `unmergeKnowledgeTags`.
- MCP: `merge_knowledge_tags` (input = merge schema).

- [ ] **Step 1: Write the failing domain test** `knowledge-tags.test.ts`:
  - `normalizes_mechanically`: `"Family Members"`→`"family-members"`, `"  work__notes "`→`"work-notes"`,
    `"Café!"`→`"café"` (NFC), 41-char input → 40 chars.
  - `rejects_empty_normalized_tag` *(Review Focus)*: `knowledgeTagsInputSchema.safeParse(["!!!"])`
    fails with a message containing `!!!`; `[]` and 9 tags fail.
- [ ] **Step 2: Write the failing integration tests** in `tags.integration.test.ts`:
  - `plural_maps_to_existing_tag`: existing `family-member`; save with `Family-Members` → record tags `["family-member"]`.
  - `merge_retags_and_aliases`: records tagged `money`; agent merges `money` into `finances` →
    records show `finances`; search `tags: ["money"]` returns them; later save with `money` stores `finances`.
  - `merge_applies_to_owner_held_records`: owner-held record tagged `money` is retagged; content and revision unchanged.
  - `unmerge_restores_original_tags`: owner unmerges → records that had `money` show `money` again; alias removed.
  - `rejects_tag_merge_cycles` *(Review Focus)*: merge `a`→`a` → 422; after `a`→`b`, merge `b`→`a` → 422; no records changed.
  - `tag_index_excludes_blocked_and_trashed_for_agents`: counts for agents omit blocked/trashed records; owner counts include blocked.
  - `tag_search_ranks_above_text_only`: record X tagged `partner`, record Y mentions "partner" only in text → search `text: "partner"` returns X before Y.
  - `agent_cannot_unmerge` → 403.
- [ ] **Step 3:** Run both files. Expected: FAIL.
- [ ] **Step 4:** Implement domain helpers, tables, `tag-service.ts`, and tag write paths in save
  and revise. Tags change without a new content revision only through merge/unmerge; revise may
  set tags. In search, add tags to the full-text document and boost exact tag matches.
- [ ] **Step 5:** Run both files plus the Task 1 suite list. Expected: PASS.
- [ ] **Step 6:** Commit: `feat: tag memories with save-time reuse and reversible merges`.

### Task 6: Simplify retrieval: drop explain_context and context-use records

**Files:**
- Modify: `packages/domain/src/knowledge-retrieval.ts` (remove `knowledgeExplainInputSchema`,
  `knowledgeContextExplanationSchema`; `contextUseId` removed from `knowledgeContextPackSchema`;
  remove `reviewView` values that depended on learning; keep `knowledgeContextMaxBytes = 32_768`),
  `apps/api/src/knowledge/context-service.ts`, routes (drop `GET /v1/knowledge/context/:id`),
  client (drop `explainKnowledgeContext`), MCP (drop `explain_context`), schema + `0146` (drop
  `knowledge_context_uses`).
- Test: `apps/api/src/routes/knowledge.test.ts`, `apps/mcp/src/tool-catalog.test.ts`

**Interfaces:** `get_context_for_intent` and `POST /v1/knowledge/context` keep their input
(`knowledgeQuerySchema`) and return the pack without `contextUseId`/`recentSelections`.

- [ ] **Step 1: Write failing tests:** `explain_context_route_is_gone` (`GET /v1/knowledge/context/<uuid>` → 404) and, in the tool catalog test, the knowledge tool list equals exactly
  `["save_knowledge","get_knowledge","update_knowledge","search_user_knowledge","get_context_for_intent","merge_knowledge_tags"]`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Remove the listed pieces; keep the pack's stated/inferred/tentative/conflicts sections.
- [ ] **Step 4:** Run the Task 1 suite list. Expected: PASS.
- [ ] **Step 5:** Commit: `refactor: drop context explanation records`.

### Task 7: Session-start core in get_ilo_context

**Files:**
- Create: `packages/domain/src/knowledge-core.ts`, `apps/api/src/knowledge/core-service.ts`,
  `apps/api/src/knowledge/core.integration.test.ts`
- Modify: `packages/domain/src/assistant.ts` (`personalOsAgentContextSchema` gains optional
  `memory`), `apps/api/src/assistant-service.ts` (`getContext` at ~line 277 attaches it when the
  principal holds `knowledge:read`), `apps/api/src/app.ts` (wiring), `apps/web/src/features/knowledge/presentation.ts`
  and `apps/mobile/src/features/knowledge/presentation.ts` (use the shared summary).

**Interfaces:**
- Produces (domain):
  - `knowledgeSummary(content: KnowledgeRecordSnapshot["content"]): { title: string; text: string }`,
    moved from the duplicated `memorySummary` in web/mobile presentation (same output).
  - `knowledgeCoreMaxBytes = 4096`, `knowledgeCoreTagBytes = 1024`, `knowledgeCoreMaxRecords = 30`,
    `knowledgeCoreMaxTags = 100`, `knowledgeCoreRecordMaxBytes = 1024`.
  - `knowledgeCoreSchema = { records: Array<{ id, text, tags, origin, ownerHeld, updatedAt } | { id, label }>, tagIndex: Array<{ name, count }>, counts: { active, conflicts, archived }, truncated: { records: boolean, tags: boolean }, hint: string }`.
- Produces (API): `createKnowledgeCoreService({ db, now, tags }): { build(principal): Promise<KnowledgeCore> }`.
  Selection: `isKnowledgeVisibleToAgent`, status `active`, current validity, `sensitivity: "standard"`,
  `core: true`; ordered owner-held → stated → inferred, then `updatedAt` desc.

- [ ] **Step 1: Write the failing tests** in `core.integration.test.ts`:
  - `fresh_session_receives_core_preference`: agent A saves `core: true` stated preference with tags;
    new token for agent B → `GET /v1/assistant/context` `.context.memory.records` contains it and
    `.tagIndex` contains its tags.
  - `core_excludes_sensitive_blocked_trashed_archived_noncore`.
  - `core_budget_counts_utf8_bytes` *(Review Focus)*: 40 core records with emoji/CJK text →
    `Buffer.byteLength(JSON.stringify(memory), "utf8") <= 4096`, `truncated.records === true`,
    and no record text is cut.
  - `tag_index_keeps_its_share`: 30 large core records plus 50 tags → tagIndex non-empty and its
    serialized size ≤ 1024 bytes.
  - `oversized_record_becomes_label`: one core record with > 1024-byte text → `{ id, label }` entry.
  - `no_memory_section_without_scope`: token without `knowledge:read` → `memory` absent.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement `knowledgeSummary` (move), the core schema, `core-service.ts` and the
  `getContext` attachment. Fill the tag index first within its 1 KiB, then records within the
  remainder. `hint` is the fixed copy
  `"Search memory with search_user_knowledge for anything not listed here."`
- [ ] **Step 4:** Run the file plus `apps/api/src/assistant-service.integration.test.ts` and the web/mobile knowledge tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: load a compact memory core at session start`.

### Task 8: Memory sections in Finance and Mail maintenance

**Files:**
- Modify: the service behind `POST /v1/finances/maintenance` (`canonicalMaintenance().maintainFinances`
  in `apps/api/src/routes/finances.ts`), the service behind `POST /v1/mail/maintenance`
  (`apps/api/src/routes/mail-stewardship.ts`), their response schemas in `packages/domain`, and
  `apps/api/src/knowledge/context-service.ts`.
- Test: `apps/api/src/knowledge/workflow-memory.integration.test.ts`

**Interfaces:**
- Consumes: `createKnowledgeContextService`.
- Produces: `knowledgeWorkflowMemoryMaxBytes = 16_384`; context service method
  `workflowSection(principal, { workspace: "finances" | "mail", purpose: KnowledgePurpose }): Promise<KnowledgeContextPack | null>`
  (null without `knowledge:read`). Start responses (`operation: "start"` for Finance) gain
  `memory: KnowledgeContextPack | null`, with sensitive records excluded.

- [ ] **Step 1: Write the failing tests:** `finance_start_includes_workspace_memory` (record scoped
  to finances appears; a mail-scoped record does not; serialized `memory` ≤ 16384 bytes),
  `mail_start_includes_workspace_memory`, `workflow_memory_excludes_sensitive`,
  `workflow_memory_null_without_scope`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement `workflowSection` on the context service with the 16 KiB cap and attach
  it to both start responses. Leave resume/continue responses unchanged.
- [ ] **Step 4:** Run the file plus existing finance-maintenance and mail-stewardship route tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: attach workspace memory to Finance and Mail maintenance`.

### Task 9: Memory scopes on by default, with backfill

**Files:**
- Modify: `apps/api/src/oauth-service.ts` (remove `knowledge:read`/`knowledge:write` from the
  `defaultScopes` exclusion), consent copy wherever OAuth scopes are described,
  `apps/web/src/features/settings/access-scopes.ts` (label "Memory: read and save what nohmi knows
  about you"; preselect both in the personal-access-token form), `0146` (append backfill), and
  audit wiring.
- Test: `apps/api/src/oauth-service.test.ts`, `apps/api/src/knowledge/scope-backfill.integration.test.ts`

**Interfaces:** Backfill SQL appended to `0146`:
`UPDATE access_tokens SET scopes = scopes || '["knowledge:read","knowledge:write"]'::jsonb WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) AND NOT scopes @> '["knowledge:read"]'::jsonb AND scopes ?| <workspace scope array>`.
Derive the workspace scope array from `accessScopeSchema`, using scopes prefixed `tasks:`,
`calendar:`, `mail:`, `finances:` or `texting:`. Insert one audit row per updated token, using the
existing audit table and a system actor. Check that OAuth refresh copies scopes from the access
token it replaces, so backfilled grants survive refresh; adjust the test if storage differs.

- [ ] **Step 1: Write failing tests:** `default_oauth_scopes_include_memory` (`parseScopes(undefined)` contains both);
  `backfill_adds_memory_to_live_workspace_tokens`; `backfill_skips_revoked_expired_and_non_workspace_tokens`;
  `refresh_preserves_backfilled_scopes`; `removed_memory_scope_blocks_core` (token edited to drop
  `knowledge:read` → no `memory` section, search 403).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Run the backfill test against a database seeded before applying 0146.
- [ ] **Step 4:** Run the files plus `apps/api/src/oauth-service.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: grant memory scopes by default and backfill existing agents`.

### Task 10: MCP guidance, docs, final migration check, PR 1

**Files:**
- Modify: `apps/mcp/src/tools/knowledge.ts` (descriptions), `apps/mcp/src/tool-catalog.ts`,
  `apps/mcp/src/discovery.ts`, `docs/engineering/workspace-agent-tools.md` (regenerate with the
  repository's generator; find it with `grep -rn "workspace-agent-tools.md" scripts package.json`),
  `docs/engineering/workspace-agent-capabilities.md`, `docs/mcp.md`, `docs/product/user-knowledge.md`,
  `docs/architecture/0005-user-knowledge.md` (remove 0130/0132/0139 recovery text; describe 0146),
  `docs/product/implementation-log.md` (new dated entry: what shipped and what didn't),
  `docs/design/pages/settings.md`.
- Test: `apps/mcp/src/http-contract.test.ts`, `integration/workspace-agent/knowledge-lifecycle.integration.test.ts`

**Interfaces:** Tool descriptions must state the habits in spec §5.8: save as soon as something
important is said; search before saving; reuse tags from the core tag index; mark lasting items
`core`; update or supersede instead of duplicating; check origin, freshness and conflicts before
acting; memory grants no permission.

- [ ] **Step 1: Write the failing cross-session test** `two_agents_share_memory_across_sessions` in
  `knowledge-lifecycle.integration.test.ts`, through the real MCP→client→API path:
  - Agent A saves.
  - Agent B gets it in the core and finds it by tag.
  - The owner trashes it.
  - Agent B's next search lacks it.
- [ ] **Step 2:** Run it. Expected: FAIL until descriptions and wiring are final; then implement and PASS.
- [ ] **Step 3:** Update the docs above so product policy matches spec §5. Keep shipped claims to what
  this branch does.
- [ ] **Step 4:** Recreate the worktree database (Destroy Worktree Runtime, then `pnpm env:start`).
  Confirm 0146 applies cleanly from empty. Then confirm production has no `knowledge_*` tables by
  following the `personal-os-deploy-status` skill's read-only production inspection. If any exist,
  stop and report to Cooper.
- [ ] **Step 5:** Run `pnpm lint`, `pnpm typecheck` and the full knowledge suite list. Then run
  `pnpm verify` on the frozen candidate.
- [ ] **Step 6:** Commit, push, and open PR 1 through the repository `create-pr` workflow. Link
  COO-166 and COO-167 with a Work map. Update both Linear issues. Do not merge.

## PR 2 — Web Memory screen (branch `cooper/coo-168-web-memory`, stacked on PR 1)

### Task 11: Rework the web Memory screen

**Files:**
- Modify: `apps/web/src/features/knowledge/page.tsx`, `record-detail.tsx`, `record-editor.tsx`,
  `actions.ts`, `presentation.ts`, `page.test.tsx`; `apps/web/src/components/icons.ts` (any new
  glyph as a semantic registry entry); `e2e/knowledge.spec.ts`
- Create: `apps/web/src/features/knowledge/tags.tsx`, `apps/web/src/features/knowledge/trash.tsx`

**Interfaces:** Consumes the PR 1 client methods: `searchKnowledge`, `getKnowledge`,
`getKnowledgeHistory`, `saveKnowledge`, `updateKnowledge` (all agent and owner actions),
`exportKnowledge`, `listKnowledgeTags`, `mergeKnowledgeTags`, `unmergeKnowledgeTags`.

- [ ] **Step 1: Write failing tests** in `page.test.tsx`:
  - `lists_tabs_all_conflicts_archived_trash`.
  - `filters_by_tag_chip`.
  - `shows_stated_inferred_and_sensitive_labels`, with no percentage text anywhere.
  - `resolve_conflict_keep_mine_and_take_agents`.
  - `trash_confirmation_states_backup_and_agent_limits_and_lists_linked`. The dialog copy includes
    "Older backups may still contain this until they're deleted" and "Agents that already read it
    may remember it".
  - `restore_and_delete_now_from_trash`.
  - `toggles_core_and_agent_access`.
  - `merge_and_undo_tag`.
  - `action_feedback_uses_sonner_only`. Every action asserts Sonner loading→outcome and no inline
    result text.
- [ ] **Step 2:** Run `pnpm exec vitest run apps/web/src/features/knowledge`. Expected: FAIL.
- [ ] **Step 3:** Implement within the existing component structure and spec §5.9.
- [ ] **Step 4:** Update `e2e/knowledge.spec.ts` to cover add → tag filter → edit → trash → restore
  on desktop and mobile viewports. Run `pnpm exec playwright test e2e/knowledge.spec.ts`. Expected: PASS.
- [ ] **Step 5:** Commit, then open PR 2 via `create-pr` (COO-168). Do not merge.

## PR 3 — iPhone Memory screen (branch `cooper/coo-168-iphone-memory`, stacked on PR 2)

### Task 12: Rework the iPhone Memory screen

**Files:**
- Modify: `apps/mobile/src/features/knowledge/screen.tsx`, `detail.tsx`, `editor.tsx`,
  `controls.tsx`, `authority.ts`, `presentation.ts`, `share.ts`, `screen.test.tsx`;
  `apps/mobile/src/app/memory.tsx`; `apps/mobile/src/features/settings/navigation.ts`,
  `settings-screen.tsx`
- Create: `apps/mobile/src/features/knowledge/tags.tsx`, `apps/mobile/src/features/knowledge/trash.tsx`

**Interfaces:** Same client methods as Task 11. Export uses the platform share sheet via `share.ts`.

- [ ] **Step 1: Write failing tests** in `screen.test.tsx`. Mirror Task 11's list, plus:
  - `pull_to_refresh_uses_spinner_and_error_toast_only`.
  - `native_back_from_detail_keeps_list_state`.
  - `logout_clears_memory_cache`.
- [ ] **Step 2:** Run `pnpm exec vitest run apps/mobile/src/features/knowledge`. Expected: FAIL.
- [ ] **Step 3:** Implement within spec §5.9 and the repository's native rules (see
  `docs/design/mobile-frontend.md`).
- [ ] **Step 4:** Run the native typecheck. Build and launch in the iOS Simulator, then walk add →
  tag filter → edit → trash → restore using the fixture account. Capture screenshots for the PR.
- [ ] **Step 5:** Commit, then open PR 3 via `create-pr` (COO-168). Do not merge.

### Task 13: Final review and handoff

- [ ] **Step 1:** Run an independent `deep-review` on each PR. Resolve findings with fixes and tests.
- [ ] **Step 2:** Freeze each candidate and run `pnpm verify`. Record results in each PR.
- [ ] **Step 3:** Update COO-165/166/167/168 with PR links and the actual status.
- [ ] **Step 4:** Report to Cooper which PRs are ready. List what still can't be verified locally
  (production backfill effect, real agent sessions). Wait for an explicit merge go-ahead.
