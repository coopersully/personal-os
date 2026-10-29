# Finance Release Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans in the existing Finance04 integration checkout. Existing stream workers retain their assigned implementation paths; Lead retains acceptance and every merge.

**Goal:** Produce one coherent Finance release candidate carrying every admitted stream and current complete acceptance evidence.

**Architecture:** Normal-merge accepted frozen stream heads into the existing integration branch, preserving original author history, branches, PRs and issue relationships. Finance04 owns shared composition; feature owners repair their own behavior. Reconcile the complete union against current main before final verification.

**Tech Stack:** TypeScript, React, Hono, MCP, Drizzle/PostgreSQL, Vitest, Playwright and the checked-in verification runner.

**Spec:** `docs/superpowers/specs/2026-10-18-finance-experience-design.md`; current canonical Finance documents and the Lead's accepted recovery packet.

## Global Constraints

- Product spelling is `nohmi`; internal repository/package spelling is `personal-os`.
- Preserve all published migration bytes and append-only journal ownership. No squash, rebase, force-push or closure of original PRs as an integration shortcut.
- Only Lead merges. Full candidate verification, current independent acceptance, live protected checks and zero unresolved review threads remain required. Current repository policy and the latest human-provided AGENTS instructions reported by Lead make CodeRabbit advisory; actual findings must be adjudicated. Current independent deep-review acceptance remains mandatory.
- One exclusive local heavy-resource owner. Spending live QA precedes Finance04 unread/transport proof; Auth and recovery races require later explicit slots.
- Foundation navigation/API verification and design convergence remain separately owned. Do not absorb unrelated implementation.
- Preserve exact human-only budget activation, owner/session denial clearing, native-money semantics, original-host authority and stable financial-effect identities.

## Review Focus

- New versus existing owners, interrupted setup and same-owner authorization loss must preserve privacy and honest recovery.
- Spending filters, preferences and category labels must retain exact transaction membership, currency and revision semantics.
- Token rotation/revocation, lease expiry and replacement races must not transfer authority or repeat financial effects.
- Combined route/client/MCP registries must retain every accepted leaf; no imported method or human-only description may disappear.
- Historical or partial Activity evidence must remain honest, paginated and bound to actual audits and conversation sources.

## Source and Ownership Map

| Family | Frozen source and disposition | Owner and integration seam |
| --- | --- | --- |
| Current integrated workflows | Published `9a70a840d0a9c1cdbd5511e33e71e9001db6b9ba`; local test-only `c9bcd5e8ea7deefe8ad5820c54363b44a84aaaf8` | Finance04; existing `cooper/coo-105-finance-ui-integration`, PR #270 — Connect Finance conversation automations and Activity |
| Budget authority | `4121ad9784fc766faa052d47a2b145d26c40abc9`, already included | Finance02; retain exact human-only adapters and budget fingerprints |
| Baseline explicit zero | Accepted `939ff5caf8bdf4e71e390a1081c74686cc428cb2`, separate from test repair below | Finance02; merge normal history and preserve absence versus explicit zero |
| Baseline migration test expectations | Accepted `40abaf8badb22cc69bc7a88786f6b3ebedd26e18` via `baseline-schema-repair-review.json` | Finance02; preserve exact accepted test delta, never rewrite storage to fit assertions |
| Setup/manual/category | Accepted `603bfd5d9a0097ef4f9c86aebda75f68cc633eda`, already included | Finance06; preserve denial generation barrier, fresh authorized GET recovery, manual controls and category taxonomy |
| Spending | Owner must supply the final live-QA freeze and cleanup receipt | Finance03; do not merge the currently changing QA branch |
| Cash flow/goals/reimbursements | Accepted final `7d59f8a703a2459504f3cf745226d6a695d0ddf4`, exact `a083` tree; normal-merged locally at `4ed5da5a` | Finance05; rejected test-only `24dededf` is reverted in the preserved full history, not imported alone |
| Canonical Auth | Accepted `ac52b01baf8c3b2fcc884cbfe3c4aac713168576`; PR #271 — Persist OAuth rotation lineage and serialize token lifecycle | Finance04 Auth owner; lifecycle PG and full gates pending |
| Recovery consumer | Active isolated `cooper/coo-110-oauth-recovery`; freeze not yet delivered | Finance04 core owner; candidate-only bindings, control resume, outer guards and typed leaves; no generic review adoption |
| Shared recovery adapters | Begin only from the consumer's frozen typed exports | Finance04 parent; API root, client root, actual MCP tools/catalog/capabilities/dictionary and transport tests |

## File Structure and Conflict Rules

- `apps/api/src/app.ts`: retain every accepted factory, route registration and original service dependency. Add recovery read/mutation leaves only after frozen contracts; never select a whole side of a conflict.
- `apps/web/src/app.tsx` and `features/finances/workspace-page.tsx`: preserve the actual setup gate, task props, manual controls, owner/session unread badge and Activity evidence reader. The exact Activity client identities have a focused composition assertion.
- `packages/api-client/src/client.ts` and `packages/domain/src/finance.ts`: preserve the union of exported/constructed Finance APIs and schemas. Domain behavior stays in leaves.
- `apps/mcp/src/tools/finances.ts`, `tool-catalog.ts`, domain capability manifest, operation inventory and generated dictionary: parent is the sole writer. Retain original grants and literal human-only budget policy descriptions.
- `packages/database/src/schema.ts` and migration journal: combine additive declarations and the full prefix, preserving original SQL files. Resolve non-additive schema conflicts with the assigned database owner.
- Finance UI leaf collisions remain with their stream owner; preserve new native category labels, source drilldown, currency evidence and latest monthly Spending scope.
- `docs/engineering/finance-*` and nearest design pages: describe the integrated behavior and real limitations; keep target scope separate from implementation/runtime claims.

## Actual Pairwise Conflict Preview

Read-only `git merge-tree --write-tree` against local `c9bcd5e8` found no conflicts for accepted explicit-zero `939f` or frozen Spending QA `e1be8ae773b0ac8445b7170aeb723f4ae2c0ffcf` (the latter is not admitted for merge until live QA cleanup). Baseline test repair `40ab` conflicts only in `packages/database/src/schema.test.ts`. Cash flow `a083` conflicts in `apps/api/src/finance-service.ts`, `apps/web/src/features/finances/position-pages.test.tsx`, `docs/design/pages/finances.md`, `packages/api-client/src/features/finances.ts`, database schema/journal, and domain `finance.ts` / `index.ts`. These are pairwise previews, not a guarantee for the later sequential union. Raw output is under private `.context/final-finance-integration/`; no source/index mutation occurred.

## Migration Order

Preserve the actual full prefix through `0120` / index125. Accepted Auth `0121` / index126 uses timestamp `1792353608000`. Accepted queue handoff `6640fd7700c5075a1b36aee32e3ad21a4a662eb1` adds reimbursement generation `0122` / index127 at `1792353609000`. The assigned recovery owner alone appends prospective `0123` / index128 at `1792353610000` after normal-merging that exact prefix. No later migration slot is implied. Historical journal anomalies are not repaired by renumbering published entries.

## Task 1: Pin and Preview the Accepted Union

**Files:** private `.context/final-finance-integration/` receipts; this plan's source map.

**Interfaces:** Consume each owner's exact clean full SHA, direct issue coverage, independent review, focused/runtime receipts and outstanding gates. Produce a pinned manifest and conflict preview before source mutation.

- [ ] Receive Spending's post-QA freeze and Finance05's complete accepted source handoff; record existing setup and authority handoffs.
- [ ] Record Lead's acceptance of Finance02's `40abaf8b` delta and obtain acceptance of the final recovery implementation; never treat a changing branch name as a pin.
- [ ] Run `git merge-tree --write-tree <current-candidate> <pinned-head>` for each prospective normal merge; record actual conflict paths and which owner resolves each.
- [ ] Validate ancestry so already-contained sources are not copied or cherry-picked. Commit only accepted integration resolutions, retaining original source parents.

### Current execution evidence

Accepted baseline heads `939f` and `40ab` were normal-merged, with the exact migration assertion expanded through the actual current chain. The initial baseline-focused check passed33 tests. Accepted Cash flow final `7d59` is normal-merged at `4ed5da5ace5ea804896684b3405882dcec1fff90`; all130 shared SQL files match the accepted source byte-for-byte. Eleven integrated conflict/owner suites passed204 tests; six package typechecks are being recorded serially. This is an integration checkpoint, not final acceptance.

## Task 2: Compose the Frozen Finance Candidate

**Files:** shared roots and exact conflict paths listed above; recovery typed leaves remain core-owned.

**Interfaces:** Consume the pinned manifest; produce a clean normal-merged candidate with every accepted API/UI/MCP family registered.

- [ ] Normal-merge the accepted baseline deltas, Spending freeze and Finance05 complete source in dependency order; skip ancestors already included.
- [ ] Normal-merge final recovery, which carries actual Auth and `0122` prerequisites; reconcile any missing Auth source only by its original branch history.
- [ ] Register the necessary safe execution-authorization reader and refresh mutation from frozen DTOs. Required current authority, original connection/protocol and canonical lineage remain server-enforced for both; mutation revalidates after reads.
- [ ] Preserve literal human budget approval boundaries, setup denial barriers and exact financial source membership while resolving shared roots.
- [ ] Run focused composition, changed owner suites, inventory/dictionary checks, affected typechecks, non-writing changed-file Biome and `git diff --check`; retain command/head/exit receipts.

## Task 3: Collect the Candidate's Complete Evidence

**Files:** exact current test suites and private raw receipts; no duplicate process or acceptance ledger in product code.

**Interfaces:** Consume source-bound leaf evidence and the complete candidate. Produce current integrated acceptance mapped to each direct issue and Lead criterion.

- [ ] Carry earlier evidence only where relevant source and verifier inputs are unchanged and blob-bound. Preserve the original failed ReviewCase PG receipt and its accepted two-line repair/replay evidence.
- [ ] Complete the frozen unread plus actual HTTP/MCP transport proof in its assigned slot. Its two files are `apps/api/src/finance/conversation-unread-service.integration.test.ts` and `integration/workspace-agent/conversation.integration.test.ts`.
- [ ] Execute all16 Auth lifecycle PG cases and final recovery race/migration tests after source review and explicit slots; stop on first failure and preserve cleanup receipts. No source-review result substitutes for concurrency proof.
- [ ] Run integrated desktop/mobile journeys: setup manual/later/required/unknown/legacy/denial/reload, Spending filters and source recovery, Cash flow/goals/reimbursements, Chat capability/context/unread, Automations and Activity evidence, and rotation recovery without duplicate effects.
- [ ] Obtain current independent full-union review covering all18 standards and exact destination/authority contracts. Route findings to their existing owners and reverify the changed candidate.
- [ ] Reconcile the candidate with current target main using normal history, freeze the exact source, and run `pnpm verify` or the complete approved hosted equivalent. Every selected required job must pass on the applicable candidate; local resource slots remain exclusive.

## Task 4: Publish and Hand Off One Reviewable Candidate

**Files:** PR body/Work map, private integration receipts, structured Nohmi issue backlinks and nearest implementation documentation.

**Interfaces:** Consume the fully mapped candidate/evidence; produce one truthful integration PR and Lead handoff. Lead owns readiness and protected merge.

- [ ] Prefer existing PR #270 — Connect Finance conversation automations and Activity; rewrite its title, body, scope and complete Work map around the final union, and coordinate its eventual base change to main with Lead. Create a replacement PR only if an actual GitHub limitation requires it.
- [ ] Resolve the unique live Nohmi Project before each write, preserve human ownership and every existing PR attachment, add the final integration structured link to all direct issues, and retain In Progress until acceptance/merge criteria hold.
- [ ] Batch necessary metadata changes before collecting final hosted gates. Preserve original PRs and branches; do not close them until Lead verifies the integrated merge.
- [ ] Deliver exact head/base/parents, direct issues, source and runtime evidence, independent review, remaining live gates and production-observation limits. Never merge or enable auto-merge from Finance04.

## Evidence Already Available, Not Final-Candidate Claims

Authority `4121` and baseline `86d` have owner-reported actual runtime evidence; explicit-zero `939f` has6 actual PG passes. Setup durable `f2d5` has7 PG passes and currency `5ede` has4. F1 `ebd` has9 actual PG passes. Corrected effect proof `35f2` passed7 core plus1 SMS race; Activity `556a` passed6; exact-source lookup at `f44f` passed1; reviewed UUID repair `b0008` passed selected ReviewCase and contextual causal tests (1 each). All Finance04 owned runs settled cleanup with no new containers and preserved preexisting IDs. These receipts support their exact sources and cannot establish final union acceptance or production deployment.
