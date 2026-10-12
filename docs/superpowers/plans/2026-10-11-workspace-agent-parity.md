# Workspace Agent Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give appropriately scoped agents documented, executable access to every supported workspace operation, with tested autonomous execution under the approved bypass policy.

**Architecture:** Domain APIs retain policy, data, and provider ownership. Typed client methods and focused MCP adapters expose those capabilities. A shared operation inventory connects UI/API coverage to protocol-level tests against real PostgreSQL.

**Tech Stack:** TypeScript, Hono, Zod, Drizzle/PostgreSQL, MCP SDK, Vitest/Testcontainers, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-11-workspace-agent-parity-design.md`.

**Status:** Implementation authorized in this chat. Adapter/policy changes, real MCP/PostgreSQL suites, generated dictionary and local HTTP smoke are implemented. Independent review identified three defects with reproducing tests and fixes. The final MCP run passed 65 tests and executed 232/232 audited tools. Type checking, 3,824-test coverage, builds and lint passed; final browser acceptance passed 80 tests with two intentional device-specific skips. Exhaustive variant/provider gates remain separately tracked; registration or tool counts do not complete them.

**Acceptance limits:** Checked items have implementation or execution evidence. Unchecked exhaustive variant/provider gates remain open; tool-level execution and broad repository coverage do not silently complete them. See the generated [execution matrix](../../engineering/workspace-agent-execution.md) and [verification notes](../../engineering/workspace-agent-verification.md).
## Global constraints

- Cover Mail, Tasks including Reminders, Calendar, Finances, and their shared workspace controls.
- No generic unrestricted settings/action tool, domain logic in MCP, or direct database access from MCP.
- Bypass cannot create scopes, defeat tenant isolation, manufacture evidence, or authorize provider login.
- Preserve already-authorized bypass-off behavior and truthful partial/uncertain outcomes.
- External providers may be simulated in deterministic tests; API authentication and PostgreSQL may not.
- No real-world sends, invitations, live schedule changes, or financial mutations as incidental tests.
- Run `pnpm verify` without lowering coverage thresholds before implementation handoff.
- Use current runtime identifiers where required; no unrelated protocol-name migration.
- Apply the spec's cohesive MCP interface contract to existing and new tools; no undocumented naming/input exceptions or synonyms.
- Measure parity by every shipped user outcome and tool variant, not tool count; required missing/skipped execution cases fail the completion gate.

## Review focus

1. An advertised tool calls a human-only route: every operation must execute with an actual agent token.
2. Success wrapping hides a failed domain disposition: assert effects and readback, not just protocol status.
3. Bypass or token revocation changes during execution: check authority before acceptance/dispatch, distinguishing already-accepted external effects.
4. Retries repeat external effects or use stale previews: prove safe replay and uncertain-effect recovery.
5. Queries work only on empty data: seed multiple owners, pages, revisions, and timezone boundaries.

## Task 1: Complete the capability and authority inventory

**Files:** Create `docs/engineering/workspace-agent-capabilities.md`; create
`integration/workspace-agent/operation-cases.ts`; inspect domain routes, typed client features,
MCP modules, and all four web feature directories. Include `routes/task-lists.ts`,
`routes/task-projects.ts`, `routes/workspace-search.ts`, and shared connection/settings routes.

**Interfaces:** Define `WorkspaceOperationCase` with `id`, `workspace`, `route`, `clientMethod`,
`tool`, `variant`, `requiredScopes`, `bypassOff`, `bypassOn`, `coverageState`, `fixture`,
`arguments`, `expectedOutcome`, `readback`, `failureCases`, `cleanup`, and `testId`.
This is test inventory metadata, not a second runtime authorization engine.

- [ ] Enumerate UI actions and API operations, including every discriminated mutation branch; seed Finance rows from the spec and complete the other workspaces.
- [x] Compare each row against tool discovery and actual route/service restrictions; identify aliases that do not provide equivalent behavior.
- [ ] Inventory field-level filters/settings, bulk variants, attachments, lifecycle transitions, and recovery outcomes; distinguish internal helper endpoints from independently useful agent operations.
- [x] Add the canonical tool dictionary to `docs/engineering/workspace-agent-capabilities.md`: names, schemas, examples, scopes, outcomes, and exceptions. Apply the spec's naming/input rules to all workspaces before implementation.
- [ ] Review each operation from discovery through verification: IDs/revisions must be obtainable from preceding tools, and ordinary workflows must not depend on hidden UI steps or undocumented data.
- [x] Assign each operation its exact authority under both bypass settings and its scope; flag proposed scope additions explicitly.
- [x] Resolve activation/send/recovery authority in the draft matrix and update canonical policy wording before implementation. Preserve the named owner-only exceptions.
- [ ] Add a coverage test that requires an executable case or documented owner/provider/unsupported exclusion for every row; require every registered workspace tool to map to at least one row.
- [ ] Validate every documented example against the discovered tool schemas; reject undocumented conventions, conflicting aliases, and unrelated optional-field variants. Record deliberate existing compatibility exceptions without adding new aliases.
- [x] Run the coverage test and retain the initial failing inventory as the implementation checklist. An exclusion cannot be used to waive an ordinary missing adapter.

## Task 2: Build real MCP-to-database execution fixtures

**Files:** Create `integration/workspace-agent/fixture.ts`,
`integration/workspace-agent/parity.integration.test.ts`, and
`integration/workspace-agent/operation-cases.test.ts`. Reuse construction patterns from
`apps/api/src/app.integration.test.ts`, the real client in `packages/api-client/src/client.ts`,
and `apps/mcp/src/server.ts`. Create `integration/tsconfig.json` with repository `rootDir` and
Vitest types; modify `vitest.config.ts` to include `integration/**/*.test.ts` and the root
`package.json` typecheck script to check this config. Keep test-only imports out of production
entrypoints and do not widen either application's source root.

**Interfaces:** Export `createMcpWorkspaceFixture()` returning `db`, `owner`, `otherOwner`,
`setBypass(enabled)`, `connectAgent({ scopes, credentialKind, readOnly })`, and `close()`.
`credentialKind` is `personal` or `oauth`; `connectAgent` returns the protocol `client` and its
authenticated credential/connection identity. The API client's existing `fetch` option forwards
requests to the real Hono app; authentication and routes use migrated PostgreSQL. Obtain scopes
from `getIloContext()` before constructing MCP, never from its all-scopes default. In-memory MCP
and in-process HTTP request dispatch do not claim network verification; Task 9 supplies that.

Create isolated owners/data per mutation case, a controllable logical clock, and bounded durable-run
polling. The fixture owns cleanup of every connected client, runtime, database pool and container,
including partial setup failure. Keep provider doubles at the connector boundary.

- [x] Add a fixture-backed transaction read that verifies seeded values and excludes another owner's rows.
- [x] Add the failing bank-sync agent regression with bypass on; confirm it fails at real authorization, not because a mock throws.
- [x] Add a mutation/readback/audit example and prove the harness fails when the effect is absent despite a success-shaped result.
- [x] Add empty/populated and multi-page query cases plus missing-scope and revoked-token cases.
- [x] Prove both personal-token and OAuth-bound fixtures authenticate correctly; test refresh/expiry and another connection for the same owner. Host continuations must use their actual connection lineage.
- [x] Test read-only endpoint/discovery behavior, hidden-tool invocation, and API denial independently. Default-full-scope server construction is forbidden in these tests.
- [ ] Validate returned domain payloads, not just the permissive shared MCP envelope. Include wrong records, incorrect aggregates, and successful envelopes containing failed items as disconfirming cases.
- [ ] Implement named per-operation/variant cases with fixtures, calls, expected dispositions, readbacks, failures, and cleanup; test omitted/null/empty values and invalid input combinations where relevant.
- [x] Add a result reporter that joins actual executed case results to the inventory. Missing, skipped, failing, and unverified-provider cases remain explicit; declarations alone never count as passing evidence.
- [ ] Run `pnpm exec vitest run integration/workspace-agent/parity.integration.test.ts`; distinguish intentional product failures from harness failures.
- [x] Run `pnpm exec tsc --noEmit -p integration/tsconfig.json` and confirm normal Vitest discovery includes the new suites. No failing characterization cases may remain in a completed slice; invert them to the desired success assertions when fixed.

## Task 3: Implement the approved authorization semantics

**Files:** `packages/domain/src/execution-policy.ts`, its tests,
`apps/api/src/execution-policy-service.ts`, `apps/api/src/finance/context.ts`, domain authorization
call sites identified in Task 1, and `docs/product/master-design.md` / `workspace-stewardship.md`.

**Interfaces:** Retain the `evaluateExecutionPolicy(settings, action)` entrypoint, but extend the
domain action schema to distinguish standing authorization from effect reversibility for approved
operations. The current irreversible-effect early return must be addressed explicitly; adding an
allowlist entry alone cannot authorize send. Domain services supply validated authority/effects;
MCP never calculates them. Preserve native non-Finance queues and direct-write behavior.

- [ ] Write table tests for every registered operation under bypass on/off and required-scope/capability states.
- [x] Test denied self-escalation under both settings and preservation of existing direct scoped writes.
- [x] Test explicitly registered irreversible operations separately from unregistered ones; do not mark an external send reversible. Verify old grants cannot silently obtain newly introduced effect authority.
- [x] Update approval-source schemas and persisted audit/approval provenance so agent bypass is recorded truthfully without human impersonation. If constraints require migration, follow the database skill and add migration-preservation tests before changing writers.
- [x] Add a database integration test for bypass change/revocation before commit, stale preview, and pending-review replay.
- [ ] Define each external operation's acceptance/dispatch checkpoint and test revocation before it versus recovery after provider acceptance; never require impossible cross-provider atomic rollback.
- [x] Replace actor-only restrictions for approved operations with domain authorization; keep genuine security/provider-consent restrictions.
- [x] Run focused domain and API policy suites, then the shared MCP execution cases.

## Task 4: Finish Finance parity

**Files:** `apps/api/src/routes/finances.ts`, owning `apps/api/src/finance/` services,
`apps/api/src/finance-action-service.ts`, `apps/api/src/finance-service.ts`,
`packages/api-client/src/features/finances.ts`, `apps/mcp/src/tools/finances.ts`,
`apps/mcp/src/tools/finances-stewardship.ts`, and new
`integration/workspace-agent/finances.integration.test.ts`. Split new policy/review adapters into focused
modules when needed; register them in `apps/mcp/src/server.ts` and `tool-catalog.ts`.

**Interfaces:** Expose existing typed client methods for accounts/categories, budget policies,
contextual questions, review history, configuration, position, and budget pace. Preserve existing
tool names and inputs; extend overview inputs with optional month/account filters. Use precise
domain nouns and operation-specific schemas for new tools.

- [ ] Add success cases for every Finance gap in the spec before changing its API/adapter.
- [x] Repair sync authorization and distinguish permission failure from provider reconnect.
- [x] Implement approved budget/guidance activation and policy management; test exact version/preview binding and bypass-off behavior.
- [x] Expose manual-account creation, disconnect/delete semantics, categories, queued review actions, contextual questions, history and reporting.
- [x] Verify classifications, merchant rules, split/link/import, reimbursement cancel/reconcile, goals and bucket branches, not just newly added tools.
- [ ] Exercise setup through activation and maintenance through terminal readback, including uncertain answers and replay.
- [ ] Document and test an actual usable bank-authorization handoff, with human provider consent and connected-account readback separately evidenced.
- [x] Run `pnpm exec vitest run integration/workspace-agent/finances.integration.test.ts apps/mcp/src/tools/finances.workflows.test.ts` and focused affected service tests.

## Task 5: Finish Mail parity

**Files:** `apps/api/src/routes/mail.ts`, `routes/mail-stewardship.ts`, owning Mail services,
`packages/api-client/src/features/mail.ts`, `features/mail-stewardship.ts`,
`apps/mcp/src/tools/mail.ts`, `tools/mail-stewardship.ts`, and new
`integration/workspace-agent/mail.integration.test.ts`.

**Interfaces:** Use existing typed draft, send, reconciliation, rule preview/activation, disposition,
obligation, question, feedback, and maintenance methods; add missing typed methods before adapters.
Sending must identify the exact draft/version and retain durable uncertain-send recovery.

- [x] Add operation cases for drafts, attachments where supported, sending, reconciliation, rule lifecycle, stewardship decisions, source sync, and query filters.
- [x] Specify bounded authenticated attachment/export transfer before exposing it: content type, size, expiry, and failure semantics. A session-only download link is not an executable agent path.
- [x] Expose missing adapters and apply Task 3 authority to the approved actor-restricted routes.
- [x] Test bypass-on end-to-end draft creation/edit/send using a controlled connector, with persisted receipt and sent-state readback.
- [x] Test timeout after provider acceptance; reconciliation must not resend, and retry must not duplicate mail.
- [ ] Test stale rule preview, missing sender capability, cross-account mistakes, pagination, and mixed batch failure.
- [x] Run `pnpm exec vitest run integration/workspace-agent/mail.integration.test.ts` and affected Mail service suites.

## Task 6: Finish Calendar parity

**Files:** `apps/api/src/routes/calendar.ts`, `calendar-service.ts`,
`calendar-stewardship-service.ts`, `packages/api-client/src/features/calendar.ts`,
`apps/mcp/src/tools/calendar.ts`, and new `integration/workspace-agent/calendar.integration.test.ts`.

**Interfaces:** Add typed MCP adapters over existing local-calendar create/update/delete,
selection, status, and review methods. Preserve event preview/revision, block privacy, provider
capability, and recoverable deletion contracts; do not promise unsupported recurrence/RSVP writes.

- [x] Add missing calendar-management/status/review operations and test existing event/block branches.
- [x] Execute create/read/update/trash/restore flows through MCP and real persistence, including source selection and visibility.
- [ ] Verify timezone/DST boundaries, all-day events, hidden calendars, pagination where supported, and read-only provider denial.
- [ ] Exercise supported Google and iCloud event operations separately with controlled connectors; record provider-specific denials instead of treating local-calendar success as provider coverage.
- [ ] Verify provider timeout and stale revisions do not create duplicate events or leak private block details.
- [x] Run `pnpm exec vitest run integration/workspace-agent/calendar.integration.test.ts` and affected Calendar suites.

## Task 7: Verify and finish Tasks/Reminders parity

**Files:** `apps/api/src/routes/tasks.ts`, `task-lists.ts`, `task-projects.ts`, `reminders.ts`,
`task-workspace.ts`; owning services; matching typed-client features;
`apps/mcp/src/tools/planning.ts`, `reminders.ts`, `task-workspace.ts`; create
`integration/workspace-agent/tasks.integration.test.ts`.

**Interfaces:** Preserve native List/Project/Task and Reminder contracts. Add adapters only for
inventory-confirmed gaps; do not introduce duplicate CRUD aliases or planned Prompt persistence.

- [x] Execute each lifecycle and move branch, lists/projects, mixed workspace reads, and Reminder operations through MCP.
- [ ] Verify archived parents, restoration after parent deletion, protected Inbox behavior, stale revisions, and foreign-owner IDs.
- [ ] Verify mixed scopes, cursor traversal, filters/grouping and date/timezone boundaries with populated fixtures.
- [x] Confirm bypass does not regress existing direct scoped mutations; close only inventory-confirmed gaps.
- [x] Run `pnpm exec vitest run integration/workspace-agent/tasks.integration.test.ts` and affected Task/Reminder suites.

## Task 8: Shared settings, search, notifications, and recovery

**Files:** `apps/api/src/routes/workspace-settings.ts`, `workspace-search.ts`, `notifications.ts`,
`automation-hosts.ts`; owning settings/notification/host services; `packages/api-client/src/client.ts`
and `features/automation-hosts.ts`; create focused `apps/mcp/src/tools/workspace-settings.ts` and
`workspace-recovery.ts`; create `integration/workspace-agent/controls.integration.test.ts`.

**Interfaces:** Typed workspace-discriminated settings methods retain revisions and domain scopes.
Notification tools distinguish inheritance/reset from explicit override. Recovery tools reference
owned existing runs and connections; they cannot grant host credentials or expand scopes.

- [x] Add real execution tests for each workspace's preferences/search, guidance, notification overrides/reset, and supported maintenance controls.
- [x] Expose authorized host status, schedule metadata, answer binding, run recovery, and delivery reconciliation; preserve external-platform schedule ownership.
- [x] Split ordinary maintenance controls from credential/fire-token/security administration according to Task 1's matrix.
- [x] Preserve original host-connection lineage for continuation reads and recovery. Test expired/refreshed credentials, same-owner different connections, and foreign owners; a matching workspace scope alone must not transfer control of a run.
- [ ] Test quiet-hour/inheritance behavior, concurrent settings writes, cross-workspace scope denial, durable recovery and no duplicate delivery.
- [x] Run `pnpm exec vitest run integration/workspace-agent/controls.integration.test.ts` and affected shared-service tests.

## Task 9: Documentation, deployed smoke, and completion evidence

**Files:** `docs/mcp.md`, `docs/engineering/workspace-agent-capabilities.md`, nearest domain and
external-boundary docs; create `scripts/qa-mcp-workspaces.ts` and
`docs/engineering/workspace-agent-verification.md`; update tool descriptions/catalog coverage.

**Interfaces:** The smoke runner accepts an explicit local/test MCP endpoint and credential through
environment configuration, never tool arguments or logs. Default to reads; fixture mutations require
an explicit test-owner selection. Refuse arbitrary production writes. Record redacted evidence by
operation and distinguish simulator, local transport, and real provider verification.

- [ ] Validate description/schema/scope consistency and ensure every inventory row links to a passing executable case or named exclusion.
- [ ] Execute documented examples and complete cross-tool workflows for every workspace, including obtaining required IDs/revisions through tools rather than fixture knowledge. Check that previews and result references can feed the next tool unchanged.
- [x] Review the assembled tool dictionary for consistent verbs, entity names, field semantics, bounds, errors and recovery; document any retained compatibility exceptions and coordinated migrations.
- [x] Start the worktree using `pnpm env:start`; use the lifecycle status/log actions to identify its origin.
- [x] Run the protocol smoke through the deployed HTTP MCP transport for all four fixture workspaces, then verify readback and audit.
- [x] Exercise both normal and read-only HTTP MCP paths, token forwarding, rejected/revoked tokens, and initialization/discovery. Use only disposable fixture ownership and bound every tool call/poll with a timeout.
- [ ] Run available provider sandbox/non-destructive smoke checks; record missing access or configuration as unverified with the exact remaining check.
- [x] Run `pnpm verify`; investigate failures without weakening coverage or replacing integrations with mocks.
- [x] Publish a per-workspace matrix of implemented, locally executed, provider-verified, and blocked/unverified operations. Do not call the overall result fully working while required execution cases fail.
- [ ] Report total inventoried operations/variants against executed passing cases and named exclusions; zero unexplained omissions, zero skipped required cases, and zero unusable advertised agent paths are release requirements.

## Assumptions checked during plan review

On October 11, eight existing test files passed all 117 tests, including 69 real PostgreSQL
integration cases. These establish the current Finance and host-policy baseline; they do not test
the proposed cross-workspace parity. The review also reproduced the TypeScript cross-app source-root
failure and confirmed connection-bound host authorization, the irreversible-effect bypass guard,
the typed client's injectable fetch transport, and the permissive shared MCP result payload.

The revised integration directory and verification wiring resolve the test-placement assumption.
Policy extension, provenance changes, the new fixture/harness, HTTP transport smoke, and provider
checks remain planned work, not verified implementation. Use focused tests while building each
slice and reserve full `pnpm verify` for the assembled implementation.

## Dependencies and handoff

Tasks 1–3 precede workspace changes. Tasks 4–7 share the policy and harness but retain independent
acceptance suites; Task 8 owns shared settings and recovery. Task 9 verifies the assembled result.
Keep changes reviewable by these boundaries. A future PR uses the repository create-pr workflow
and direct Nohmi Linear routing; writing these drafts does not create or authorize a PR or merge.
