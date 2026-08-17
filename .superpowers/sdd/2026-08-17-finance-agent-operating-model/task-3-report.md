# Task 3 report — Finance action disposition

Status: DONE_WITH_CONCERNS

Commit: recorded in the parent handoff after the commit is created. A commit cannot contain its own immutable object hash without changing that hash.

Implemented a Finance action service backed by `finance_agent_action_reviews`, then routed agent-led supported profile, budget, categorization, merchant, recurring, alert, transaction, and income-stream mutations through prepare-before-disposition. Durable bypass is read from the Finance setting only after evidence preparation; disabled bypass queues a review, enabled bypass applies after a settings-row lock/re-read, and insufficient categorization evidence produces a durable question. Added human-only action-review list/approve/dismiss routes and a question-answer route; MCP now exposes `answer_finance_question` and keeps `resolve_finance_review` as an answer-only compatibility alias.

Verification:

- `pnpm exec vitest run apps/api/src/finance-action-service.integration.test.ts apps/api/src/routes/finances.test.ts apps/mcp/src/server.test.ts` — 20 passed.
- `pnpm --filter @personal-os/api typecheck` — passed.
- `pnpm --filter @personal-os/mcp typecheck` — passed.
- `pnpm exec vitest run packages/api-client/src/client.test.ts` — 8 passed, including forwarding an agent disposition without reading a human-only response field.
- `pnpm exec biome check apps/api/src/finance-action-service.ts apps/api/src/finance-action-service.integration.test.ts apps/api/src/routes/finances.ts apps/api/src/routes/finances.test.ts apps/api/src/app.ts packages/api-client/src/features/finances.ts apps/mcp/src/tools/finances.ts apps/mcp/src/tool-catalog.ts apps/mcp/src/server.test.ts` — passed.
- `pnpm --filter @personal-os/api test -- finance-action-service.integration.test.ts routes/finances.test.ts && pnpm --filter @personal-os/mcp test -- server.test.ts` — exited 0 but emitted no test-runner output; the explicit Vitest invocation above verified the intended files.
- `git diff --check` — passed.

Concerns:

- Existing Finance semantic writers still own their own database handles; approval locks/terminalizes the durable review in one transaction, but a writer's mutation/audit is not yet injected with that same transaction. This leaves a narrow atomicity gap that should be closed by adding transaction-executor parameters to the individual writers.
- Question answers are stored durably and never authorize an action or mutate bypass. The current question shape is intentionally bounded text, so action-specific evidence extraction remains a follow-up for transaction categorization/split questions.
- A completion review also found that preparation must load and revision-lock every affected owned record, and that review projections need precise redacted change/evidence details. The current generic projection is intentionally conservative but is not sufficient for a person to independently verify all material changes.

## Fix round 1/5 — Batch A: atomic execution lane

Status: DONE_WITH_CONCERNS

Refactored the action-service execution path so its bypass setting read/`FOR UPDATE` lock and every supported semantic writer receive the same Drizzle transaction. Profile, budget, ledger, categorization/evidence, income, recurring, alert/refresh, and merchant paths now accept the executor and write audits through it. The bypass-false queue path inherits the locked transaction rather than falling back to the root database. Approval replays an already-applied stored result without invoking the writer again; a terminal-review failure rolls back real transaction and profile updates and preserves the pending review.

Verification:

- `pnpm exec vitest run apps/api/src/finance-action-service.integration.test.ts apps/api/src/finance-service.integration.test.ts` — 44 passed, including real transaction/profile rollback injection and an external concurrent bypass-disable attempt held behind the action's settings lock.
- `pnpm --filter @personal-os/api typecheck` — passed.
- `pnpm --filter @personal-os/database typecheck` — passed.
- `pnpm exec biome check --write apps/api/src/finance-action-service.ts apps/api/src/finance-action-service.integration.test.ts apps/api/src/finance-service.ts` — passed after formatting.
- `git diff --check` — passed.

Remaining concern for later batches: prepare/revision evidence is not yet exhaustive across every action kind. This batch deliberately does not alter prepare/question/supersession behavior.

## Fix round 1/5 — Batch B: exhaustive prepare/revalidate/public review

Status: DONE_WITH_CONCERNS

Added schema-normalized, action-specific prepare handlers for profile, budget creation and plans, categorization, merchant rename/merge, recurring obligations, alerts, transactions, and income streams. Preparation verifies owned referenced records before reading bypass and records redacted change projections, source references, assumptions, and revision snapshots. The semantic commit and approval paths rebuild that snapshot under their transaction lock; revision drift supersedes the review and returns `needs_input` without invoking a writer. Categorization results containing a semantic failure are rejected rather than terminalized as applied.

Verification:

- `pnpm exec vitest run apps/api/src/finance-action-service.integration.test.ts apps/api/src/routes/finances.test.ts` — 14 passed, including stale-review supersession without writer invocation.
- `pnpm --filter @personal-os/api typecheck` — passed.
- `pnpm --filter @personal-os/database typecheck` — passed.
- `pnpm exec biome check --write apps/api/src/finance-action-service.ts apps/api/src/finance-action-service.integration.test.ts apps/api/src/routes/finances.ts` — passed after formatting.
- `git diff --check` — passed.

Remaining concern for later batches: durable question answers still do not resume prepared actions, and concurrent supersession policy remains intentionally untouched. Existing route-level schemas reject malformed path IDs before this service receives them; the service returns a bounded `needs_input` outcome for malformed direct action payloads.

## Fix round 1/5 — Batch C: durable questions and compatibility

Status: DONE_WITH_CONCERNS

Question rows are now excluded from approval listing/projection. Answering a question locks it, accepts only bounded JSON object input, merges it into its referenced original action, reruns preparation and bypass disposition inside the same transaction, records the terminal outcome, and supersedes the original question. Exact terminal replay is idempotent. The MCP `resolve_finance_review` alias is documented as deprecated and accepts either the current answer shape or a legacy transaction-categorization shape, translating the latter to the same answer path; it cannot toggle bypass or approve a generic action review.

Verification:

- `pnpm exec vitest run apps/api/src/finance-action-service.integration.test.ts apps/api/src/routes/finances.test.ts apps/mcp/src/server.test.ts packages/api-client/src/client.test.ts` — 34 passed.
- `pnpm --filter @personal-os/api typecheck` — passed.
- `pnpm --filter @personal-os/mcp typecheck` — passed.
- `pnpm --filter @personal-os/api-client typecheck` — passed.
- `pnpm exec biome check --write apps/api/src/finance-action-service.ts apps/api/src/finance-action-service.integration.test.ts apps/mcp/src/tools/finances.ts` — passed.
- `git diff --check` — passed.

Remaining concern for later batches: answer extraction currently accepts a bounded JSON object and relies on the original action's typed prepare schema for the final field validation. It does not yet expose individually tailored UI/MCP answer schemas for every possible prepare failure, and supersession-race coverage remains deferred.

## Fix round 1/5 — Batch D micro: semantic queue keys

Status: DONE_WITH_CONCERNS

Added internal durable `semantic_target_keys` to the unshipped Finance action-review migration and Drizzle schema. Prepared actions derive deterministic keys by family; queueing obtains sorted transaction-scoped advisory locks, then reuses an exact fingerprint or supersedes overlapping pending target keys before inserting the next review. Public `safeChanges` remains UUID-or-null and does not expose those internal keys.

Verification:

- `pnpm exec vitest run apps/api/src/finance-action-service.integration.test.ts packages/database/src/schema.test.ts` — 23 passed.
- `pnpm --filter @personal-os/api typecheck` — passed.
- `pnpm --filter @personal-os/database typecheck` — passed.
- `pnpm exec biome check --write apps/api/src/finance-action-service.ts packages/database/src/schema.ts packages/database/src/schema.test.ts` — passed.

Remaining concern: the full concurrent same/disjoint target matrix remains to be added.

Additional concurrency verification: overlapping categorization proposals now have a real concurrent regression test; one proposal is superseded while a current pending proposal remains.
