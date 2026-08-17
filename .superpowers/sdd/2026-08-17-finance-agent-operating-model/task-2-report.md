# Task 2 report

Status: DONE_WITH_CONCERNS

Implemented self-contained Finance planning status, deterministic scenario comparison, atomic budget plans, HTTP/client/MCP exposure, and focused status/scenario/budget tests. Corrected ownership included `packages/domain/src/finance-maintenance.ts` for the enriched status contract.

Commit: `2407b33` (`feat(finances): make status drive planning`)

Verification passed:

- `pnpm --filter @personal-os/api test -- finance-status-service.integration.test.ts finance-scenario-service.test.ts finance-service.integration.test.ts` (exited 0; package test script is a no-op)
- `pnpm --filter @personal-os/api-client test -- client.test.ts` (exited 0; package test script is a no-op)
- `pnpm --filter @personal-os/mcp test -- server.test.ts` (exited 0; package test script is a no-op)
- `pnpm exec vitest run apps/api/src/finance-status-service.integration.test.ts apps/api/src/finance-scenario-service.test.ts apps/api/src/finance-service.integration.test.ts packages/api-client/src/client.test.ts apps/mcp/src/server.test.ts --reporter=dot` (69 passed)
- API, API-client, MCP, and domain `typecheck` commands passed.
- Biome check/write for Task 2 files and `git diff --check` passed.

Concern: the formerly dirty automation-settings dependency, including migration `0059` and its schema/domain support, is now committed in the Task 2 chain. Unrelated web and documentation edits remain unstaged.

## Fix round 1 — Batch A

Status: DONE_WITH_CONCERNS

Committed `e8e21756e5ce5a53633defcd36cb4c7ba8680e03` (`fix(finances): persist budget plans`). This makes the automation-settings dependency and 0059→0060 migration chain self-contained, adds a versioned durable budget-plan parent record, records plan metadata atomically, adds an explicit over-allocation acknowledgement, and removes exact totals from the new plan audit metadata.

`pnpm --filter @personal-os/api typecheck` and `pnpm --filter @personal-os/domain typecheck` passed. Remaining batches: shared cadence-aware capacity, status/close-readiness evidence, scenario edge cases, OAuth consent copy, and expanded focused tests.

## Fix round 2 — Batch A (planning capacity correctness)

Status: DONE_WITH_CONCERNS

Commit `af83529ad8eaa719668e252e9032691f341296ad` normalizes explicit expected take-home pay by profile cadence before calculating monthly capacity, ignores partial month-to-date ledger income for reliable planning capacity, and reserves the full stated amount for irregular obligations instead of treating them as zero. Both Finance status and budget-plan writes now pass the profile cadence into the shared resolver. The focused resolver tests cover biweekly pay, partial income, irregular obligations, and equivalent status/writer inputs. The new MCP forwarding assertion is Biome-formatted.

Verification passed:

- `pnpm exec vitest run apps/api/src/finance-planning.test.ts --reporter=dot` (1 file, 5 tests passed; red phase first demonstrated 4 expected failures)
- `pnpm exec vitest run apps/api/src/finance-planning.test.ts apps/api/src/finance-service.integration.test.ts apps/api/src/finance-status-service.integration.test.ts apps/mcp/src/server.test.ts --reporter=dot` (4 files, 67 tests passed)
- `pnpm --filter @personal-os/api typecheck` (exited 0)
- `pnpm --filter @personal-os/mcp typecheck` (exited 0)
- `pnpm exec biome check --write apps/mcp/src/server.test.ts apps/api/src/finance-planning.ts apps/api/src/finance-planning.test.ts apps/api/src/finance-status-service.ts apps/api/src/finance-service.ts` (exited 0)
- `pnpm exec biome check apps/mcp/src/server.test.ts` (exited 0)
- `git diff --check` (exited 0)

## Fix round 1 — final budget-plan durability coverage

Status: DONE_WITH_CONCERNS

Authoritative implementation HEAD at final verification: `e7847075b1680534274c25984bb30814f0fa99e3` (`test(finances): cover budget plan durability`). The added integration case proves that foreign categories and goals are rejected without partial writes; durable plan metadata (goal IDs, assumptions, rationale, replace flag, scenario fingerprint, version, and allocations) is stored and reloaded from the database; a forced failure on a later allocation rolls back the replacement/upsert; and budget-plan audit payloads contain only counts, month, fingerprint, and policy-safe metadata rather than monetary totals.

Verification passed:

- `pnpm exec biome check --write apps/api/src/finance-service.integration.test.ts` (exited 0)
- `pnpm exec vitest run apps/api/src/finance-service.integration.test.ts --reporter=dot` (1 file, 36 tests passed)
- `pnpm --filter @personal-os/api typecheck` (exited 0)
- `pnpm --filter @personal-os/database typecheck` (exited 0)
- `git diff --check` (exited 0)

The sole remaining concern is intentionally deferred Task 3 behavior: applied versus pending-review/needs-input disposition and durable bypass recheck/TOCTOU protection. This Task 2 work does not implement or assert either behavior.

## Fix round 1 — C4 Pass 2 (client transport tests)

Status: DONE_WITH_CONCERNS

Commit `7e8458b2f62e9ed6e351829c8b89a7947b57c3e5` adds API-client coverage for scenario comparisons and budget-plan writes. The test asserts each method's exact HTTP method, path, serialized body, and unwrapped result.

Verification passed:

- `pnpm exec biome check --write packages/api-client/src/client.test.ts` (exited 0)
- `pnpm exec vitest run packages/api-client/src/client.test.ts --reporter=dot` (1 file, 7 tests passed)
- `pnpm --filter @personal-os/api-client typecheck` (exited 0)
- `git diff --check` (exited 0 before commit)

## Fix round 1 — C4 Pass 2 (route transport tests)

Status: DONE_WITH_CONCERNS

Commit `5a17966b7e1b66caffe5a2b73a3e69c76809ce33` adds direct route coverage for `POST /v1/finances/scenarios/compare` and `PUT /v1/finances/budget-plan`. The test verifies parsed input forwarding, required read/write scopes, successful response status, and response envelopes under current Task 2 behavior.

Verification passed:

- `pnpm exec biome check --write apps/api/src/routes/finances.test.ts` (exited 0)
- `pnpm exec vitest run apps/api/src/routes/finances.test.ts --reporter=dot` (1 file, 6 tests passed)
- `pnpm --filter @personal-os/api typecheck` (exited 0)
- `git diff --check` (exited 0 before commit)

The planned Task 3 review-disposition behavior remains deliberately deferred; this coverage exercises only the current Task 2 user-request route behavior.

## Fix round 1 — completion chain

`0299446`, `4f9bf75`, `ad8da10`, `cc80ff0`, `c272fdb`, `a02b435`, and `8baaca4` respectively tightened close readiness/OAuth consent, centralized cadence-aware capacity, grounded evidence cutoff and missing facts, preserved provider evidence references, stabilized goal priority, projected conditional debt/goals, and added scenario boundary coverage. Focused scenario/status/client/MCP tests and API/domain typechecks were run during these batches; all reported passing except the corrected test-first typecheck iteration, which passed after the fixture was completed. Task 3 review dispositions and bypass recheck remain deliberately deferred by plan.
