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

## Fix round 2 — Batch E (MCP authority documentation)

Status: DONE_WITH_CONCERNS

The architecture and MCP documents now state that `finances:write` may mutate the accounting ledger, financial profile/income data, and budget plans, while institution connection/import/account administration and external financial activity remain human-only. They also record that Task 3—not Task 2—will provide the `applied`, `pending_review`, and `needs_input` disposition based on the signed-in user's app-only review-bypass setting.

Verification passed:

- `pnpm lint` (exited 0; Biome and repository contract checks passed)
- `pnpm exec biome check docs/mcp.md docs/architecture/0003-finance-intelligence.md` (exited 0; Markdown paths are intentionally ignored by Biome, so no separate document formatter is configured)
- `git diff --check` (exited 0)

## Fix round 2 — final chain and concerns

Status: DONE_WITH_CONCERNS

The full round-two implementation chain is `af83529` (cadence-aware capacity), `ae550f3` (same-month plan serialization), `c183825` (deterministic scenario projections), and `fdc84e6` (trustworthy status evidence, reconciliation, and durable goal ordering). The accompanying documentation update records that `finances:write` reaches ledger/profile/budget mutations while provider administration and external financial activity remain outside MCP authority.

Current concerns are only the written Task 3 deferrals: it must introduce the `applied`, `pending_review`, and `needs_input` mutation dispositions governed by the signed-in user's app-only review-bypass setting, and durable bypass recheck/TOCTOU protection. No Task 3 behavior is implemented by Task 2.

## Fix round 2 — Batch D (status evidence, reconciliation, and goal priority)

Status: DONE_WITH_CONCERNS

Commit `fdc84e60906cd6c1c97a2036d978b0b04f2cb5e8` derives Finance evidence cutoff from the oldest current source, falls back to the oldest local manual-account revision when no provider timestamp exists, and omits provider evidence references that lack a provider transaction ID. Close readiness now includes pending ledger work and `reconciledThrough` stops before the earliest unresolved transaction/review/duplicate/provenance exception. Goal priority is now sourced only from the latest durable budget plan's ordered `goalIds`; active goals without that order remain deterministic in the separate active-goal list but prompt for an explicit priority and do not receive fabricated ranks.

Verification passed:

- `pnpm exec vitest run apps/api/src/finance-status-service.integration.test.ts --reporter=dot` (1 file, 17 tests passed after the red phase demonstrated the prior cutoff/priority failures)
- `pnpm exec vitest run apps/api/src/finance-status-service.integration.test.ts packages/domain/src/domain.test.ts --reporter=dot` (2 files, 47 tests passed)
- `pnpm --filter @personal-os/api typecheck` (exited 0)
- `pnpm --filter @personal-os/domain typecheck` (exited 0)
- `pnpm exec biome check --write apps/api/src/finance-status-service.ts apps/api/src/finance-status-service.integration.test.ts` (exited 0)
- `git diff --check` (exited 0)

## Fix round 2 — Batch C (scenario correctness)

Status: DONE_WITH_CONCERNS

Commit `c1838256dcd50d6c91a8f0c3eec4e1cf205f86a4` treats a zero debt balance as already paid (`debtPayoffMonths: null`), preserves an alternative's own goal timing alongside its relative reserve message, reports missing balance/payment facts for every scenario plan, and canonicalizes duplicate-label alternatives with full normalized-plan serialization before hashing. The domain contract test documents that zero payoff months remain invalid while the already-paid null value is valid.

Verification passed:

- `pnpm exec vitest run apps/api/src/finance-scenario-service.test.ts --reporter=dot` (1 file, 8 tests passed after the red phase showed 4 expected failures)
- `pnpm exec vitest run apps/api/src/finance-scenario-service.test.ts packages/domain/src/domain.test.ts --reporter=dot` (2 files, 38 tests passed)
- `pnpm --filter @personal-os/api typecheck` (exited 0)
- `pnpm --filter @personal-os/domain typecheck` (exited 0)
- `pnpm exec biome check --write apps/api/src/finance-scenario-service.ts apps/api/src/finance-scenario-service.test.ts packages/domain/src/domain.test.ts` (exited 0)
- `git diff --check` (exited 0)

## Fix round 2 — Batch B (concurrent complete-plan replacement)

Status: DONE_WITH_CONCERNS

Commit `ae550f326b12f7732e2da7d4788889927d9bc1ac` acquires a transaction-scoped PostgreSQL advisory lock keyed by Finance user and budget month before any category-specific work, deletion, parent upsert, or allocation write. This makes same-month `replace: true` plans serializable even when their category sets do not overlap. The focused integration race uses disjoint categories and a controlled parent-row barrier, then verifies the final allocations are exactly the second complete plan (never a hybrid) and the durable parent remains the version-2 upsert.

Verification passed:

- `pnpm exec biome check --write apps/api/src/finance-service.ts apps/api/src/finance-service.integration.test.ts` (exited 0)
- `pnpm exec vitest run apps/api/src/finance-service.integration.test.ts --reporter=dot` (1 file, 37 tests passed)
- `pnpm --filter @personal-os/api typecheck` (exited 0)
- `pnpm --filter @personal-os/database typecheck` (exited 0)
- `git diff --check` (exited 0)

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
