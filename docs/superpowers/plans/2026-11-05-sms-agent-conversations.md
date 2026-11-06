# SMS Agent Conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Persist and display one SMS conversation and wake fresh Claude sessions for all authorized workspaces.
**Architecture:** Extend shared Texting with an opt-in routine binding, durable batches and fenced agent claims. Keep provider transport in connectors and workspace effects in their existing APIs.
**Tech Stack:** TypeScript, Zod, Drizzle/PostgreSQL, Hono, MCP, React/TanStack Query, Vitest.
**Spec:** ../specs/2026-11-05-sms-agent-conversations-design.md

## Global Constraints

- Subscription routine only; no paid model fallback. Human confirms paid extra usage disabled.
- Five-second burst window, at most 25 inputs per run, one unfinished run per owner.
- Preserve owner, connection, consent epoch and domain permissions. No automatic replay of uncertain effects.
- Fixed HTTPS endpoint, 15-second timeout, 16 KiB response limit, redirects disabled.
- No production sends or merge. Sonner action feedback; shared Messages is not a workspace.

## Review Focus

- STOP or reconnect between queueing and execution: deny stale work.
- Provider success followed by a lost response: retain uncertainty without a second fire.
- Competing sessions: only one invocation owns the fixed input batch.
- Partial cross-workspace completion: persist reported successes and unresolved work separately.
- Owner/session changes during UI fetches: no private history leaks.

## Task 1: Contracts and durable storage

Files: packages/domain/src/texting-agent.ts, packages/domain/src/texting.ts,
packages/database/src/schema.ts, packages/database/migrations/0132_texting_agent.sql and journal.
Interfaces: TextingAgentSettingsInput, TextingAgentStatus, TextingAgentRun; claim/run membership and work records.
- [x] Add schema tests for bounded inputs, strict settings and work states.
- [x] Run focused contract tests and observe missing exports fail.
- [x] Implement contracts and additive owner-bound storage; no historical backfill.
- [x] Run contract tests and PostgreSQL migration integration tests.
- [x] Include contracts and storage with their tests in the consolidated implementation commit.

## Task 2: Queue, host dispatch and agent protocol

Files: apps/api/src/texting-agent-service.ts, apps/api/src/texting-agent-dispatcher.ts,
apps/api/src/texting-service.ts, apps/api/src/routes/texting-agent.ts, apps/api/src/app.ts,
packages/connectors/src/claude-routine.ts; corresponding tests.
Interfaces: configure(principal,input), status(principal), claim(principal,runId,invocationId),
checkpoint(principal,runId,input), reply(principal,runId,input), dispatch(shouldContinue).
- [x] Write integration regressions for owner/epoch isolation, burst batching, duplicate claims and uncertain handoffs.
- [x] Exercise the API behavior through focused PostgreSQL integration tests.
- [x] Add atomic inbound queueing, durable claims, provider adapter and bounded runtime dispatch.
- [x] Add authenticated settings/status/agent endpoints and checkpoint/reply persistence.
- [x] Prove STOP, grant loss, competing dispatch and atomic reply behavior with real PostgreSQL.
- [x] Include the verified API path in the consolidated implementation commit.

## Task 3: Typed client, MCP and app history

Files: packages/api-client/src/features/texting.ts, apps/mcp/src/tools/texting.ts,
apps/mcp/src/tool-catalog.ts, apps/web/src/features/texting/conversation.tsx,
apps/web/src/features/texting/agent-settings.tsx, apps/web/src/features/texting/page.tsx,
apps/web/src/app.tsx, apps/web/src/navigation/manifest.ts; corresponding tests.
Interfaces: getTextingAgentStatus, configureTextingAgent, claimTextingAgentRun,
checkpointTextingAgentRun, replyToTextingAgentRun.
- [x] Write client, tool-discovery and UI tests for history, pagination, setup and errors.
- [x] Run focused client, MCP and UI tests.
- [x] Implement typed adapters, bounded tools, Messages route and owner-keyed history queries.
- [x] Verify permissions, disabled history, Sonner feedback and no inline action-result copy.
- [x] Include client and UI implementation in the consolidated implementation commit.

## Task 4: Review and delivery evidence

- [x] Update canonical Texting documentation and external-boundary record with implemented behavior and pending live evidence.
- [x] Run affected type checks, lint and focused regression suites; inspect every result.
- [x] Obtain independent whole-branch review: no remaining concrete blocking defect; material findings repaired and affected checks rerun.
- [x] Record verification and remaining production evidence in COO-61 — Shared Texting general inbox.

## Implementation evidence — November 5

Routing, recovery UI and independent review ran in parallel. General inbox ownership persists
through cancellation so old Finance recovery cannot consume those messages. Finance routing now
requires a matched choice or explicit numbered response. STOP, START and HELP remain in history.
Pending work is paginated, with at most 100 cumulative work records per run and 20 per checkpoint.
The Messages shell is a shared channel; run history and recovery are paginated independently of SMS.
Staggered arrivals extend the five-second burst delay without shortening provider backoff.
Known rejected submissions can be retried; retry marks the old run as superseded. Unknown execution
requires confirmation that the host stopped before closing and never automatically replays effects.

Focused suites cover 194 tests across 17 files, including PostgreSQL migrations/lifecycle/routing,
existing Finance recovery, client contracts, MCP permissions and frontend behavior. The initial
consolidated run had one test-isolation failure; isolating earlier owners from the bounded rotating
queue scan fixed it, and the lifecycle suite passed again. Review-fix recheck: 17 tests passed.
Desktop and mobile browser acceptance: 2 passed, with screenshots inspected. Repository typecheck
and production build passed. Repository lint passed with existing warnings. Full release coverage and `pnpm verify` are not claimed by this
contribution. A real routine fire, SMS round trip, production grants and Claude account billing
configuration remain live rollout evidence. No production messages were sent.

Final review repair verification: staggered burst regression failed before the fix, then all 31
lifecycle, routing and legacy Texting tests passed. Reviewer found no remaining concrete blocker.
Review noted that more than 100 unresolved items across pending-work pages and individual audit
rows are not directly asserted by the focused tests; those remain coverage limitations.
