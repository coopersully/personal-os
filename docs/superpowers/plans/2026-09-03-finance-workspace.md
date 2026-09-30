# Shared Finance workspace implementation plan

> Execute the approved design in this session. Independent Finance modules have disjoint ownership;
> use the dispatching-parallel-agents workflow for those modules, then integrate and review together.

**Goal:** Make the portal a coherent, trustworthy companion to Finance MCP.

**Architecture:** Feature modules consume existing typed Finance API methods and domain records.
The Finance page dispatches routes; the shell owns navigation placement. Existing import/manual
transaction and legacy routes remain compatible. No financial meaning moves into the UI.

**Tech stack:** React 19, React Query, React Router, existing shadcn, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-03-finance-workspace-design.md`.

## Constraints

Preserve unrelated changes. No new dependencies, providers, migrations, or external financial
actions. API values own displayed totals; null is unavailable. Forms use exact version guards
and idempotency keys. Use semantic tokens, registry icons, labelled fields, and responsive dialogs.

## Task 1: Complete Plan

Files: create `apps/web/src/features/finances/plan-page.tsx`, `plan-editor.tsx`, and focused tests.
Export `FinancePlanPage()`; use `getFinanceBudget`, `getCanonicalFinanceBudgetStatus`,
`createFinanceBudget`, `reviseFinanceBudget`, `approveFinanceBudget`, categories and buckets.

- [x] Test an agent-created proposed version renders all allocations and assumptions, and approval sends
  `{ budgetVersionId: plan.id, expectedVersion: plan.version, approvalSource: "user_instruction", idempotencyKey }`.
- [x] Implement typed complete-plan display/editor, preserve resource/allocation identities and kinds,
  reject unbalanced form input, expose pending/error/conflict state, invalidate related queries.
- [x] Run `pnpm exec vitest run apps/web/src/features/finances/plan-page.test.tsx`.

## Task 2: Canonical Review and setup

Files: create `review-page.tsx`, `setup-page.tsx`, their focused tests in the Finance feature.
Export `FinanceReviewPage()` and `FinanceSetupPage()`; use canonical Inbox, setup protocol and
existing review components for explicitly labelled older work.

- [x] Test one requested question, typed answer mutation, post-response progression, failed-answer
  preservation, and setup version guards.
- [x] Render source-backed questions and resolution choices without raw JSON; preserve legacy
  questions and approvals behind disclosure. Resume setup with server state and show budget before approval.
- [x] Run `pnpm exec vitest run apps/web/src/features/finances/review-page.test.tsx apps/web/src/features/finances/setup-page.test.tsx`.

## Task 3: Trustworthy Overview, Wealth, and Accounts

Files: create `overview-page.tsx`, `wealth-page.tsx`, `accounts-page.tsx`, and focused tests.
Export `FinanceOverviewPage()`, `FinanceWealthPage()`, `FinanceAccountsPage()`.

- [x] Test null amounts remain unavailable, proposals remain visible, ownership corrections use exact
  revision, and source failures remain local.
- [x] Consume snapshot/status/plan/playbook/goals/accounts APIs. Add account interpretation editor,
  manual/connect/import entry points and real goal management. Show only supported history/evidence.
- [x] Run focused tests for each owned module.

## Task 4: Integration, Transactions, Cash flow, navigation

Files: Finance `page.tsx`, `navigation.tsx`, new `cashflow-page.tsx`, associated tests; minimal `app.tsx` wiring.

- [x] Add seven destinations, secondary setup/settings/import/health links, compatible budget and
  subscription routes, canonical Inbox count, and route-specific actions.
- [x] Dispatch new pages without fetching the compatibility page's unrelated queries.
- [x] Add URL-backed ledger search/account/review filters; preserve server cursor/sort behavior.
- [x] Build cash-flow evidence view, dated forecast with labelled assumptions, recurring management,
  subscriptions and reimbursement sections without null-to-zero coercion.
- [x] Run Finance tests and app routing tests, then typecheck.

## Task 5: Documentation and QA

- [x] Update Finance page specification and current MCP/setup documentation where it conflicts with
  implemented operations; do not rewrite historical delivery claims.
- [x] Load local fixtures, inspect all routes, exercise plan and review/setup flows on named fixtures,
  check desktop and 390px layouts and console errors.
- [x] Run `pnpm verify`; report concrete failures and fix Finance regressions.
- [x] Review the complete Finance change for stale data, lost relations, permissions, and deep links.

## Progress

- Design and implementation scope recorded; no real-user Finance mutations authorized or performed.

- Integrated canonical Profile and read-only Scenarios. Added source transaction IDs, bounded
  server/MCP ledger search, account timestamp guards, and setup reconciliation across surfaces.
- Finance UI and full app routing suite: 290 tests passed. Narrow account/Inbox integration checks,
  ownership-scoped search, setup cross-surface behavior, and MCP argument forwarding passed.
- Independent review found and corrected unsupported forecast scopes, terminal idempotency retries,
  profile multiline-note preservation, and mobile filter density.
- Browser QA used the repository `qa+loaded@ilo.test` fixture. All seven destinations were inspected;
  setup was resumed across a reload, a balanced proposal was created and approved at its exact version,
  maintenance remained honestly pending for agent judgment, legacy review remained reachable, and the
  transaction ledger was exercised at desktop and 390px widths with no browser console errors.
- The production build separates Finance into its own lazy-loaded chunk, reducing the main application
  bundle from about 2.23 MB to 0.94 MB while preserving offline precaching.
- Forecast values are withheld whenever shared, excluded, or unresolved account scope cannot be represented
  by the compatibility forecast. The overview links to this qualified Cash flow view instead of repeating
  an unqualified projection.
- Remaining product limits are explicit: debt and insurance context is currently display-only in the
  canonical profile editor, agent reasoning and audit stages need a capable caller, and the older
  classification queue remains available as a labelled compatibility route.
- Repository verification was run after the final Finance fixes. Static checks and type checking passed,
  and 1,699 tests passed, including every Finance suite. Coverage stopped on 44 failures in concurrent
  Tasks work: 43 app tests rendered an undefined `TaskListBranch` icon component and one Tasks MCP test
  omitted the newly forwarded `icon` field from its expectation. Because the gate stops at coverage,
  its build and E2E stages did not run. A separate current `pnpm build` passed for API, MCP, web, PWA,
  and offline precaching. The checked-in runtime was then started, QA fixtures were reloaded, and the
  Overview rendered without console errors or an unqualified cash-flow projection.
