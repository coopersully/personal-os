# Finance Configuration and Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open Finance setup directly into shared editable configuration and explain feature prerequisites without imposing a global setup lock.

**Architecture:** Add a read-only aggregate over existing Finance records, with domain-owned capability readiness. Reuse authoritative, revision-checked mutation services; Setup and Settings share an autosaving editor. Keep workflow execution explicit and separate from navigation.

**Tech Stack:** TypeScript, Zod, Drizzle/PostgreSQL, Hono, React Query, React, shared shadcn primitives, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-05-finance-configuration-readiness-design.md`

## Global Constraints

- Page loading must not approve a budget, start maintenance, or create repeated proposals.
- Empty is unknown, zero is explicit, and None records a confirmed empty collection.
- No per-question Save or Skip buttons and no routine “All changes saved” message.
- Financial facts retain versioned records, provenance, and budget references.
- Gate only the unavailable capability; keep useful records and unrelated sections accessible.
- Use owner-scoped queries, shared theme tokens/components, and registered reicon glyphs.
- Preserve existing routes, agent contracts, execution safeguards, and working-tree changes.

## Review Focus

- A GET or remount must never advance setup or create a financial effect (Task 1).
- Income per paycheck, monthly expected income, and reliable budget resources must not overwrite one another (Tasks 1–2).
- Blur saves completing out of order must preserve newer local edits (Task 2).
- Provider/read failures must not masquerade as missing user configuration (Tasks 1, 3–4).
- A formerly ready workspace must retain existing records when readiness regresses (Tasks 3–4).

## Task 1: Read-only configuration and domain readiness

**Files:** Create `packages/domain/src/finance/configuration.ts`, `apps/api/src/finance/configuration-service.ts`, and corresponding unit/integration tests. Modify `packages/domain/src/finance.ts`, `apps/api/src/finance-service.ts`, `apps/api/src/routes/finances.ts`, and `packages/api-client/src/features/finances.ts` with their existing tests.

**Interfaces:** `FinanceConfiguration` contains typed sections for workspace preferences, canonical financial profile, pay schedule/employment details, guidance, and setup execution summary. Sections distinguish loaded values (including null) from unavailable reads. `FinanceCapabilityReadiness` contains `capability`, `state` (`ready`, `needs_input`, `running`, `blocked`, `unavailable`), `blockers`, and resolution destinations. Add `getFinanceConfiguration(): Promise<FinanceConfiguration>` via authenticated `GET /v1/finances/configuration`.

- [ ] Add tests asserting first/returning GET performs no setup mutation, budget creation, approval, or maintenance start; another owner's profile/session cannot appear; failed sibling reads leave successful sections available.
- [ ] Run the new unit/integration tests and confirm they fail before implementation.
- [ ] Implement the aggregate using existing workspace settings, financial profile, income profile, guidance, budget, and execution reads. Derive defaults in memory for absent settings; no initialization write is required to render the page.
- [ ] Implement readiness from existing domain prerequisites. Existing budgets remain inspectable; forecast prerequisites apply to forecast material, not unrelated cash-flow tabs; accounts, transactions, recorded assets, goals, and reviews remain accessible. Missing producers report blocked operational state, not a user questionnaire requirement.
- [ ] Add client/route tests for authentication, serialization, null configuration, and unavailable sections. Run `pnpm exec vitest run apps/api/src/finance/configuration-service.test.ts apps/api/src/finance/configuration-service.integration.test.ts apps/api/src/routes/finances.test.ts packages/api-client/src/features/finances.test.ts`.

## Task 2: Shared configuration editing and safe autosave

**Files:** Create `apps/web/src/features/finances/configuration-editor.tsx`, `configuration-fields.tsx`, `use-finance-configuration.ts`, and their tests. Refactor `profile-editor.tsx`, `settings.tsx`, and structured field composition in `setup-answer-fields.tsx`. Modify canonical Finance mutation services/contracts only where revision-safe editing is missing.

**Interfaces:** `useFinanceConfiguration()` exposes the Task 1 query and serialized, revision-aware section mutations. `FinanceConfigurationEditor` accepts a section selection (`household`, `income`, `expenses`, `goals`) and optional focus target. Both Setup and Settings consume this editor; no independent copies of field state or validators.

- [ ] Add tests for scalar blur, select change, invalid draft preservation, zero versus null, explicit None, incomplete collection rows, confirmed failed retries, and typing a newer value while an earlier save completes.
- [ ] Run tests and confirm the unsupported behavior fails.
- [ ] Map jurisdiction/household/reserves/preferences to canonical financial profile fields; map stated resources/needs to its planning section. Keep pay frequency, next payday, employment, and per-paycheck amounts in their existing authoritative income records. Do not equate per-paycheck amounts with monthly take-home or treat expected income as reliable resources. Remove duplicate controls for the same fact; reuse the existing legacy-to-canonical bridge instead of adding competing synchronization.
- [ ] Save partial patches using existing idempotency and expected-version checks. Serialize edits sharing a revision, retain later drafts after responses, and expose conflict recovery beside affected fields. Add expected-version protection to any income mutation that currently lacks it; keep existing callers compatible and cover stale-write rejection in API tests.
- [ ] Render normal labelled settings fields and editable collections with CurrencyInput, DateInput, Select, Item, and SettingsSection. Keep all saved fields visible. Validate valid rows on meaningful blur; an incomplete new row stays local. Scope draft caching to the authenticated user, retain across section navigation, and clear on logout.
- [ ] Replace Finance Settings' duplicate profile forms with the shared sections. Preserve guidance activation, account associations, existing settings deep links, and searchable field destinations. Run editor, profile, settings, mutation-service, and API client focused tests.

## Task 3: Setup composition and prerequisite screens

**Files:** Refactor `apps/web/src/features/finances/setup-page.tsx` and `setup-navigation.tsx`; create `prerequisite-screen.tsx` and tests. Modify `plan-page.tsx`, `cashflow-page.tsx`, `wealth-page.tsx`, and `overview-page.tsx` where prerequisite material belongs.

**Interfaces:** `FinancePrerequisiteScreen({ readiness, returnTo })` consumes Task 1 readiness. `returnTo` accepts only internal Finance destinations. Setup sections use `section`/`field` URL parameters for resolution links.

- [ ] Add tests that Setup loads saved fields without a Start/Resume action, reload does not invoke `setupFinances`, and section navigation preserves drafts. Test a missing prerequisite, a running operation, a failed read, and an operationally blocked capability separately.
- [ ] Run tests and confirm they fail before replacing the questionnaire.
- [ ] Compose Profile, Accounts and records, and Budget as independently navigable sections, sharing Task 2 forms. Replace sequential stage percentage with factual section status. Existing records and approved/draft budgets remain accessible; keep review controls in the existing shared review flow.
- [ ] Keep proposal generation, budget approval, and maintenance as explicit commands with current prerequisite and version checks. Use existing durable execution records for pending work, refresh status after navigation, and reject stale input-bound results rather than overwriting newer plans. Do not start background work from rendering or blur saves.
- [ ] Render prerequisite screens only when the destination has no meaningful usable content. Otherwise render useful content and gate the unavailable portion. Show one clear resolution action, an honest pending/error state, and a return link after configuration is resolved. Never offer setup as the repair for a missing backend producer.
- [ ] Run setup, prerequisite, plan, cash-flow, and wealth tests covering direct URLs, partial data, readiness regression, and failed refresh with existing records.

## Task 4: Finance navigation and search alignment

**Files:** Modify `apps/web/src/features/finances/navigation.tsx`, `workspace-header.tsx`, related route-title composition in `apps/web/src/app.tsx`, and Finance search metadata under `apps/api/src/workspace-search`. Update navigation/app/search tests.

**Interfaces:** Sidebar and search use Task 1 readiness and the same existing Finance destinations. Entries remain links to their pages or prerequisite screens, not dead disabled controls.

- [ ] Add tests for groups/order: Overview; Money (Accounts, Transactions); Planning (Budget, Cash flow, Wealth); Setup (Financial setup). Assert no Finance settings sidebar entry and no review footer for zero actionable items.
- [ ] Run tests to confirm the current menu fails the new expectations.
- [ ] Implement labels/grouping and accessible unavailable-state metadata using shared sidebar components. Keep `/finances/plan` and historical redirects working while displaying Budget consistently in navigation and search.
- [ ] Verify desktop, collapsed sidebar, mobile menu, search destinations, active states, and direct unavailable-page navigation. Keep the standard Settings entry and Finance settings page intact.

## Task 5: End-to-end acceptance and canonical documentation

**Files:** Extend `e2e/workspace-search.spec.ts` or add `e2e/finance-configuration.spec.ts`; update `docs/design/pages/finances.md`, `docs/product/implementation-log.md`, and the design spec's implementation status.

- [ ] Cover empty/partial/returning profiles, independent section editing, saved values visible on reload, prerequisite-to-field-to-return navigation, and usable sibling features during backend failure on desktop and mobile.
- [ ] Run the focused unit/API/component tests, web/API/domain/client/E2E type checks, theme/icon contracts, and Playwright acceptance tests. Inspect real desktop/mobile screenshots and keyboard focus/error recovery.
- [ ] Run `pnpm verify`. If the deployment-drain scenario stall persists, retain its logs and report the incomplete gate rather than claim full verification.
- [ ] Replace the old questionnaire contract in the canonical Finance page doc only after verified behavior lands. Record exact limitations and supported asynchronous workflows; do not claim unavailable financial evidence or background producers now exist.
- [ ] Review the final diff against all spec requirements and existing uncommitted work before committing implementation changes at an authorized checkpoint.
