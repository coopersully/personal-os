# Persistent memory: agent-managed completion design

- Status: Proposed for Cooper's approval (builder check complete)
- Date: 2026-11-15
- Linear: COO-165 (parent), COO-166 (Memory API/MCP), COO-167 (purpose-bound retrieval),
  COO-168 (inspect, correct and forget in the app)
- Supersedes: `2026-11-12-persistent-memory-design.md` and its completion plan, which put the owner
  in charge of most lifecycle decisions. Canonical product policy remains
  [`docs/product/user-knowledge.md`](../../product/user-knowledge.md) and ADR 0005; both are updated
  to match this design in the same delivery.

Statements marked **Cooper** were decided in the 2026-11-15 design conversation. Statements marked
**Call** are engineering choices made while writing this document; they can be changed without
reopening the product direction.

## 1. Intent

nohmi is a personal agent harness: a digital exoskeleton. Memory is what makes it continuous.

**Cooper:** when the person says something important, the agent records it right away. In any later
session, from any authorized agent, the relevant memory comes back at the right moment without the
person repeating it and without loading everything into the agent's context. The agent manages its
own memory and judges whether a memory is accurate and current enough to act on.

Success looks like this: an agent in a brand-new session never re-asks a stated preference, finds a
relevant fact even when it was saved in different words, and can tell a stated fact from its own
earlier guess.

## 2. Goals, non-goals, anti-goals

**Goals**

1. Agents save memories as they are learned, with tags, and the memory is active immediately.
2. Every session starts with a compact core of memory and a tag index; agents search for the rest.
3. Agents maintain memory over time: update, replace, dispute, archive.
4. Results give agents what they need to judge reliability: stated vs inferred, freshness, conflict,
   sensitivity.
5. The person can see, search, edit, resolve, archive, trash, restore and export memory on web and
   iPhone.

**Non-goals for this round (Cooper accepted)**

- The three-selection automatic learning rule.
- An external deletion record that keeps trashed-and-purged memories from returning after a
  database backup restore.
- Vector/embedding search.
- The `explain_context` tool and persisted context-use records.
- Moving goals, motives, domain profiles or the Finance profile into memory. They stay canonical
  where they are.
- Shared or household memory; per-agent controls over sensitive categories.

**Anti-goals: this fails even if it technically works when**

- Memory grants or widens any permission to act. A remembered "auto-approve purchases" changes
  nothing; authority stays with each workspace's approval flow.
- An agent silently overwrites something the person entered or edited.
- The session-start core grows until it bloats every agent's context.
- Tag cleanup silently merges unrelated tags and breaks recall.
- A trashed memory is still visible to agents, or a purged memory can be read back by any path,
  including a retried request.

## 3. Starting point

All prior memory work lives on `cooper/coo-165-persistent-memory`. Its pushed tip is `a9d0a2ea`
(save/read foundation). A Codex worktree at `~/.codex/worktrees/53ab/personal-os` holds 17 further
unpushed commits up to `c60b4bb9` (lifecycle, learning, forgetting, retrieval, MCP tools, web
screens) and an uncommitted iPhone Memory screen (`apps/mobile/src/features/knowledge/*`,
`apps/mobile/src/app/memory.tsx`, settings navigation edits). **Cooper:** take that work over,
rebase it onto main and rework it to this design.

The branch was built to the November 12 rules. Its current surface is:

- **API:** `POST/GET /v1/knowledge`, `GET /v1/knowledge/:id`, `/:id/history`, `/:id/actions`,
  `/search`, `/context`, `/context/:id`, `/export`, `/settings`, `/selection-interactions`,
  `/selections`, `/learning-reset`, `/forget`, `/:id/forget-preview`, `/operations[/:id[/retry]]`.
- **MCP:** `save_knowledge`, `get_knowledge`, `update_knowledge`, `search_user_knowledge`,
  `get_context_for_intent`, `explain_context`. Scopes `knowledge:read` and `knowledge:write`.
- **Tables:** records, revisions, sources, relationships, receipts, revision metadata, owner epochs,
  derivations, selection interactions, learning settings, learning suppressions, learning receipts,
  forget operations, forget targets, forget previews, forget suppressions, forget replay bindings,
  context uses.
- **Migrations:** 0130, 0132, 0139–0145 on the branch. All collide with numbers main already uses.
  None of them is on main or in production.

## 4. Approaches considered

1. **Take over the full local branch and rework it (chosen by Cooper).** Rebase all 17 commits and
   the uncommitted iPhone screen, then remove learning and full-erasure forgetting, add tags, the
   core and Trash, and loosen agent and sensitive rules. This keeps tested record, revision, source,
   receipt, cursor, search, export and web-screen work. It is significant rework.
2. **Rebase only the pushed foundation and build the rest fresh.** A cleaner fit for the new rules,
   but it rebuilds a working web screen, search and history.
3. **Merge the foundation as-is first.** Lands quickly but ships the old rules (sensitive memories
   hidden, agents tightly limited) that this design replaces.

## 5. Decisions

### 5.1 Memory records

Keep the branch's typed record model: kinds `fact`, `preference`, `relationship`, `goal` reference,
`constraint`, `routine`, `decision`, `entity_meaning` and `inference`; workspace and purpose scope;
immutable revisions; sources; relationships; derivations; mutation receipts; audit.

Each record carries:

- **origin**: `stated` (the person said it, or entered it in the app) or `inferred` (an agent's
  conclusion). Origin never changes. A person confirming an inference records confirmation; it does
  not relabel the inference as stated.
- **author** of each revision (`user` or `agent`, with actor ID), as the branch already records.
- **ownerHeld**: true when the latest content revision was written by the person in the app, or the
  person confirmed it. **Call:** an agent's save of something the person said in chat is stated but
  not owner-held, because the server cannot verify the chat message.
- **status**: `active`, `proposed`, `disputed`, `superseded`, `archived`, `expired`, plus the
  separate trash state in 5.6. `proposed` now exists only for an agent change to an owner-held
  memory (5.4).
- **validity**: optional valid-from and valid-through; past valid-through reads as `expired`.
- **sensitivity**: `standard` or `sensitive`, and **agentAccess**: `allowed` or `blocked` (5.5).
- **core**: boolean, set by the saver; see 5.2.
- **tags**: 1–8 tags; see 5.3.
- **lastConfirmedAt / updatedAt**: so agents and the app can show freshness.

Agent saves become `active` immediately, including inferences, which stay labeled `inferred`.
**Cooper.**

**Call: purposes become a relevance hint, not an access check.** On the branch, every read
requires a purpose and refuses records not saved for it. That would make a memory saved with the
"wrong" purpose silently never come back, which works against recall. Now:

- Saving purposes is optional; when omitted, the record applies to all purposes.
- Reads, search and history no longer require a purpose. A supplied purpose filters and boosts
  ranking.
- Access to agents is controlled by workspace restriction, `agentAccess`, sensitivity, trash
  state and credential scopes. **Restrict** narrows workspaces. A record restricted to Finance is
  returned only to callers holding a Finance scope, and is left out of the core unless the caller
  holds that scope.

Existing limits stay: value up to 8 KiB, at most 20 sources and 20 relationships per mutation.

### 5.2 Recall: the session-start core plus search

**Cooper:** a small core loads at the start of every session; agents search for the rest.

`get_ilo_context`, which the MCP server instructions tell every agent to call first, gains a
`memory` section when the caller holds `knowledge:read`:

- **core**: active, current, non-sensitive, agent-allowed records marked `core: true`. Order:
  owner-held first, then stated, then inferred; within each, most recently updated first.
- **tagIndex**: the owner's canonical tags with record counts, most used first.
- **counts**: total active memories, conflicts, archived.
- **truncated** flags and a hint to call search when the core or tag index does not fit.

**Call:** the memory section is capped at 4 KiB serialized UTF-8. Core records use a compact form
(id, content as readable text, tags, origin, ownerHeld, updatedAt). Agents fetch sources, history
and full detail with `get_knowledge`. The tag index is reserved 1 KiB, up to 100 tags, so tag reuse
always works. The core fills the remaining 3 KiB, up to 30 records. Records over budget are never
cut mid-content; they are left out and reported as truncated. A core record whose content alone
exceeds 1 KiB is listed by id and a one-line label instead.

`core` is set by whoever saves the record. Tool guidance tells agents to mark lasting preferences,
standing constraints and identity-level facts as core, and to leave situational facts out. The
person can toggle it in the app.

**Search** (`search_user_knowledge`) accepts free text, tags (match any or all, aliases resolved),
kind, workspace, purpose, status, origin and a limit of 1–50 (default 20). It uses PostgreSQL
full-text search over content plus tags, with tag matches ranked above text-only matches.
Tie-breaks keep the branch's deterministic order. Cursors keep the branch's actor, filter and epoch
binding and 15-minute expiry.

**Workspace workflows.** `get_context_for_intent` stays as the purpose-bound context pack.
**Call:** in this round, `maintain_finances` and `maintain_mail` start responses include a memory
section built by the same context service for their workspace and purpose. This is capped at
16 KiB, with separate stated, inferred and conflict lists. Other workflows can adopt it later.

Every memory returned to an agent includes origin, ownerHeld, status, sensitivity, tags, updatedAt,
lastConfirmedAt, validity and source references, so the agent can judge reliability. **Cooper:**
the agent decides whether a memory is good enough to act on. The API supplies the signals; it does
not rank trustworthiness with a score.

### 5.3 Tags

**Cooper:** agents send tags with each memory so search finds it by meaning. **Cooper accepted
this refinement:** duplicates are prevented at save time rather than by an automatic server-side
similarity merge.

- Agents see the tag index in the core and reuse existing tags. Tool guidance says so explicitly.
- The server normalizes mechanically only. It applies Unicode NFC, lowercases, trims, turns runs of
  spaces and underscores into one hyphen, strips other punctuation, and caps length at 40
  characters. "Family Members" becomes `family-members`.
- **Call:** plural folding is limited to one safe case. A new tag that differs from an existing
  owner tag only by a trailing `s` maps to the existing tag. No other similarity logic.
- **Merging:** `merge_knowledge_tags` (agents with `knowledge:write`, and the person) merges
  tag A into tag B. A becomes an alias of B. Records are retagged, and later saves or searches that
  use A resolve to B. The person can undo a merge in the app, which restores A on the records that
  had it. Merges are audited.
- **Call:** an agent's merge applies to every record, including owner-held ones. A merge changes
  only how a tag is filed, never the memory's content. The old tag keeps resolving through the
  alias, and the person can undo it. Agents still cannot edit the content of owner-held records.
- Tags are owner-scoped, and an alias can never point across owners.

### 5.4 What agents can do

**Cooper:** agents manage memory, and the person is the override.

| Action | Agent (`knowledge:write`) | Person (signed in) |
| --- | --- | --- |
| Save (create) | Yes, active immediately | Yes |
| Revise content, tags or `core` | Yes, unless the record is owner-held | Yes |
| Supersede (replace an outdated memory) | Yes, unless the record is owner-held | Yes |
| Dispute | Yes | Yes |
| Archive / unarchive | Yes | Yes |
| Restrict (narrow workspaces) | Yes | Yes |
| Widen restrictions, set `agentAccess`, change sensitivity to standard | No | Yes |
| Confirm | No | Yes |
| Trash, restore, delete now | No | Yes |
| Merge tags | Yes | Yes, and undo |
| Export | No | Yes |

When an agent revises or supersedes an owner-held record, the API keeps the person's value active
and stores the agent's version as a linked `proposed` record. Both show as a conflict until the
person resolves it in the app. This reuses the branch's existing "proposal when the owner has
accepted the current value" path.

Stale writes return a conflict using the branch's expected-revision rule. Mutation keys keep the
branch's exact-retry behavior.

### 5.5 Sensitive memories

**Cooper:** agents can read them; they never load automatically.

- Sensitive records are excluded from the core and from workspace-workflow memory sections.
- They are returned by search, `get_knowledge` and `get_context_for_intent` to callers with
  `knowledge:read`, and are labeled `sensitive`.
- The person can set `agentAccess: blocked` on any record, sensitive or not. Blocked records are
  invisible to agents everywhere: search, counts, tag counts, context and receipt replay. They
  remain fully visible to the person.
- Agents may save a record as sensitive and may raise standard to sensitive. Only the person can
  lower it.
- The branch's "sensitive agent submissions are private pending-owner-review receipts" behavior is
  removed.

### 5.6 Trash and purge (replaces forgetting)

**Cooper:** forget is a soft delete, recoverable for 30 days, then purged.

- **Trash** (person only): the record and every record explicitly derived from it, through the
  existing derivation edges, transitively, move to Trash together. They disappear immediately from
  the core, search, counts, tag counts, context packs, workspace memory sections, export and
  receipt replay for agents. The person sees them under Trash.
- **Restore** (person only, within 30 days): the record and the derived records trashed with it
  return to their prior status.
- **Delete now** (person only): purges immediately.
- **Purge**: a background job runs at least daily in the API's existing background-loop pattern. It
  purges records trashed more than 30 days ago. Purge deletes content, all revisions, sources, tag
  links and search entries, removes relationship references from other records, and erases
  receipt payloads. What remains is a content-free tombstone (ID, trashed time, purged time) so
  references show as "forgotten" rather than silently missing. Purge is idempotent and resumable.
- A retried mutation whose receipt points to a trashed or purged record returns a content-free
  receipt.
- **Call: references from other memories.** Other records' revisions may contain the purged
  record's ID (related IDs, evidence IDs, relationship subject/object, domain-record evidence).
  Those revisions are not rewritten; history stays immutable. The IDs resolve to the tombstone and
  display as "forgotten", which discloses no content. Linked but not derived records, such as a
  relationship whose subject was purged, are not trashed automatically. The Trash confirmation
  lists linked records so the person can trash them too.
- The confirmation dialog states that local backups taken before purge, and agents that already
  read the memory, may still have it.
- Account deletion removes tombstones too.

Removed from the branch: forget previews, forget operations and targets, erasure outbox, deletion
ledger adapter, forget suppression fingerprints, replay bindings, and the owner-wide erasure fence.

### 5.7 Removed learning machinery

Remove the selection interaction, selection, learning-reset and settings endpoints; the learning
service, learning evidence and their tables; the web learning-settings screen; and the uncommitted
iPhone `learning.tsx`. The `presentation.detail` and `presentation.format` preferences become
ordinary preference memories that agents or the person save directly.

### 5.8 API and MCP surface after rework

API (all owner-scoped; person-only routes require a signed-in session):

- `POST /v1/knowledge` save; `GET /v1/knowledge` browse; `GET /v1/knowledge/:id`;
  `GET /v1/knowledge/:id/history`; `POST /v1/knowledge/:id/actions` with actions `revise`,
  `supersede`, `dispute`, `archive`, `unarchive`, `restrict`, `confirm`, `set_access`,
  `resolve_conflict`, `trash`, `restore`, `delete_now`.
  - `delete_now` also takes `expectedTrashVersion`: the record's `trashVersion` as the person saw
    it. Trash and restore leave the revision unchanged but each advances the Trash version of
    every record in the group, so a confirmation prepared before a Trash or restore no longer
    applies, even once the record is live again. A mismatch returns 409 with the current
    `trashVersion` and `trashedAt` in the details and erases nothing; an exact retry of a
    completed request replays its receipt. Only the owner's reads carry `trashVersion`.
  - A pending proposal (`proposed`) is settled only with `resolve_conflict`. The person's
    `confirm`, `dispute` or `revise` of a pending proposal returns 409 and changes nothing.
    Accepting a proposal (`keep: "proposed"`) whose original another proposal already replaced
    returns 409; `keep: "current"` still retires it.
- `POST /v1/knowledge/search`; `POST /v1/knowledge/context`.
- `GET /v1/knowledge/tags`; `POST /v1/knowledge/tags/merge`; `POST /v1/knowledge/tags/unmerge`
  (person only).
- `GET /v1/knowledge/export` (person only; paginated 50 per page; includes tags, origin and history;
  excludes purged content).
- `get_ilo_context` gains the memory section in 5.2. Without `knowledge:read` it is omitted, and a
  workflow memory section is `null`. A core or workflow section that fails to build is
  `{ state: "unavailable", hint }` instead, so a failure never reads as no memory access.

MCP: `save_knowledge`, `get_knowledge`, `update_knowledge` (agent actions from 5.4),
`search_user_knowledge`, `get_context_for_intent`, `merge_knowledge_tags`. Remove `explain_context`
and `GET /v1/knowledge/context/:id`. Tool descriptions teach the habits this design depends on:
save as soon as something important is said; search before saving to avoid duplicates; reuse tags
from the index; mark lasting items as core; update or supersede instead of duplicating; check
origin, freshness and conflicts before acting. The generated agent-tool documentation is
regenerated.

Typed API client methods mirror every route. Domain schemas stay the contract source.

### 5.9 App: Memory screens on web and iPhone

**Cooper:** both web and iPhone, this round.

A Memory entry in account settings on each platform, built from the branch's web screens and the
uncommitted iPhone screen:

- **Lists:** All (default), Conflicts, Archived, Trash. Search box; tag chips to filter; filters by
  kind, workspace and origin.
- **Row:** readable content, tags, `Stated` or `Inferred` label, `Sensitive` label when set,
  freshness ("updated 3 days ago").
- **Detail:** sources, who saved it (you or which agent), history, workspaces and purposes, core
  toggle, agent-access toggle, sensitivity.
- **Actions:** add, edit, confirm, resolve conflict (keep mine, take the agent's, or edit), archive,
  restrict, trash, restore, delete now, export, manage tags (rename via merge, undo merge).
- Follow repository rules: Sonner for all action feedback with no inline result banners; the native
  pull-to-refresh exception; reicon glyphs through `@/components/icons`; the user-facing name
  `nohmi`; no offline memory cache or write queue; owner-scoped caches cleared on logout.
- **Call:** no confidence percentages anywhere; show origin and freshness instead.

### 5.10 Database migration

Fold all branch migrations into one new migration numbered after main's latest at rebase time
(currently 0145, so 0146), creating only the tables this design keeps plus tags, tag aliases,
record-tag links and tombstones. Delete the branch's migration files and journal entries.

**Call:** production deploys only from exact main, and main never contained these migrations, so
production cannot have run them. The branch's "recovery" migrations exist only for local databases
that ran an earlier branch revision. Local worktree databases that ran any branch migration are
recreated (`pnpm env:stop`, then the Destroy Worktree Runtime action); no adopt-in-place path is
built. PR 1 verifies that the production database has no `knowledge_*` tables before merge. If any
non-throwaway database turns out to hold them, work stops and Cooper decides.

### 5.11 Agent access to memory

**Cooper:** memory is on by default, existing connections included.

- `knowledge:read` and `knowledge:write` join the default scopes for new OAuth consents and new
  personal access tokens. The consent screen and Agents settings list them as "Memory: read and
  save what nohmi knows about you".
- A one-time migration adds both scopes to every existing, unrevoked agent credential (OAuth grants,
  their refresh and access tokens, personal access tokens, and automation-host connections) that
  already holds any workspace scope. Token refresh still never adds scopes on its own; the backfill
  is the only widening, and it is not run again. A credential the previous API process issues
  between the migration and the new process taking over has no memory scope; it gets memory when
  the person re-authorizes that connection.
- The memory sections in `maintain_finances` and `maintain_mail` require `knowledge:read`, which
  those hosts receive through the backfill.
- The person can remove memory scopes from any connection in Agents settings, like any other scope.
- Memory scopes grant no authority over any workspace action. The backfill is audited.

### 5.12 Delivery

Three stacked PRs on a new branch line taken over from `c60b4bb9`:

1. **API, MCP, database and docs:** rework, migration, scope defaults and backfill,
   `get_ilo_context` memory section, Finance and Mail memory sections, tool guidance, updates to `user-knowledge.md`, ADR 0005 and the
   implementation log, regenerated tool docs. Linear COO-166 and COO-167.
2. **Web Memory screen:** COO-168.
3. **iPhone Memory screen:** COO-168.

Each PR runs focused checks during review and full `pnpm verify` on the frozen candidate. PRs are
opened and maintained; merging needs Cooper's explicit go-ahead. The unpushed Codex commits are
preserved on the new branch line before any rework, and the Codex worktree itself is not modified.

## 6. Acceptance

1. Agent A saves a stated preference with tags in session 1. Agent B, in a fresh session, receives it
   in the `get_ilo_context` core without searching.
2. A memory saved as "Sarah is my partner" tagged `partner` and `relationships` is found by a search
   for the `relationships` tag and by a text search for "partner".
3. Saving with tag `Family-Members` when `family-member` exists produces `family-member`; merging
   `money` into `finances` retags records and makes `money` resolve to `finances`; undo restores it.
4. An agent's inference is active immediately and labeled `inferred` everywhere it appears,
   including export and history.
5. An agent's revision of a person-entered memory leaves the person's value active and creates a
   visible conflict; resolving it in the app records the person's choice.
6. A sensitive memory never appears in the core or workflow sections but is returned by search,
   labeled sensitive; a blocked memory is invisible to agents in every read path and count.
7. Trash removes a memory and its derived copies from every agent path immediately; restore brings
   them back; after 30 days (or Delete now) purge leaves only a tombstone, and no history, export,
   search, receipt replay or cursor returns its content.
8. The core plus tag index never exceeds 4 KiB, and truncation is reported.
9. No memory changes any grant, scope or workspace policy.
10. Web and iPhone can browse, search by tag, edit, resolve, archive, trash, restore, delete now and
    export through the same API, with Sonner feedback and accessible controls.
11. An agent connection that existed before release, holding only workspace scopes, can read the
    core and save memories after the backfill; a connection whose memory scopes were removed in
    Agents settings cannot.
12. Real PostgreSQL integration tests cover the migration, concurrent writes, trash/purge and owner
    isolation; HTTP, client and MCP tests prove parity.

## 7. Left to the builder

- How to restructure `access.ts` (about 1,100 lines, heavily tied to forget and learning) while
  keeping ownership, scope and purpose checks intact.
- Exact full-text ranking weights and tag-match boost.
- Purge job cadence within "at least daily", batch size, and shutdown fencing, following existing
  background loops.
- Which branch tests to delete, rewrite or keep, provided the acceptance list above is covered.
- Component structure of the web and iPhone screens within the rules in 5.9.
- Order of work inside each PR.
