# Today at a Glance Refinements Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task after design review. Steps use checkbox (`- [ ]`) syntax. Delegation is optional only if subsequently authorized; this documentation task does not start implementation.

**Goal:** Deliver the original Today refinements and accepted first-pass cards/filters with correct dates, stable loading, saved personalization and honest recovery.

**Architecture:** Keep Calendar, Tasks, Reminders, Finance and Reviews authoritative. Compose Today in a focused web feature, add an independent revisioned presentation-preference store, and serve a bounded weekly commitment projection. Adapt MapCN to existing icons, local worker delivery and browser/desktop security contracts.

**Tech Stack:** Existing React 19, TypeScript, TanStack Query, shadcn/Tailwind, reicon, Hono, Drizzle/PostgreSQL, Vitest/Playwright and Tauri/Swift. MapCN vendor source over a tested exact MapLibre GL JS 6.x release is the only new runtime library family.

**Spec:** [Today refinements design](../specs/2026-10-12-today-refinements-design.md).

Status: review draft, self-refined against source baseline `f918b63a`; no implementation started.
The user requested spec and plan together, so plan preparation does not wait for a separate spec-only review.

## Global constraints

- Timeline is today; queue is the configured calendar week plus overdue; planning timezone governs boundaries.
- Keep the four-workspace authority model; Today preferences do not add a workspace or agent permission.
- `background=default`, `showSpending=false`, `showRitual=false`, `showPet=true`, `spendingWindow=week`, `commitmentFilter=all`, `includeUndated=false`.
- Shared reicon registry only; Sonner for discrete action results and settings errors; silent successful background saves.
- Stable component footprints during loading/refresh; no temporary weather/location body row.
- MapCN worker is same-origin; map attribution remains visible; no anonymous demo tiles as production fallback.
- Maps have a 10-second initial readiness budget, explicit retry, and at most two live instances.
- No rescheduling, new meeting shortcuts, earlier-today disclosure, pet reset UI or card-order editor in this scope.
- Follow repository database, frontend, testing, external-boundary and connector skills/contracts when implementing their respective tasks.
- Read `docs/engineering/delivery-verification.md` before release; do not claim mocked tests prove native/provider readiness.

## Review focus

- Date-only holiday crosses UTC/local midnight: Task 1 tests previous/current/next day and persisted repair.
- Live page spans DST, week rollover or machine sleep: Tasks 2–3 test invalidation and local boundaries.
- Account switches during failed/queued saves: Task 2 tests owner isolation and late callback fencing.
- Partial review/finance/connector data appears empty or healthy: Tasks 4–5 test unknown counts and retained sibling content.
- Maps pass jsdom but fail packaged desktop CSP/WebGL2: Task 6 requires actual browser and desktop rendering plus denied-resource fixtures.

## Task 1: Calendar date correctness

**Files:** modify `packages/connectors/src/google.ts`, `icloud.ts` and their tests;
`packages/domain/src/calendar.ts`; `apps/api/src/calendar-service.ts`,
`calendar-service.integration.test.ts`, `daily-brief-service.ts`, `daily-brief-service.test.ts`.
Create `packages/domain/src/calendar-day.ts` and `calendar-day.test.ts`, exported by `index.ts`.
Put any idempotent legacy-mirror repair in `apps/api/src/calendar-all-day-repair.ts` with integration
tests; allocate a migration only if the audited source formats require persistence changes.

**Interfaces:** `calendarEventOccursOnDate(event: CalendarEvent, day: LocalDate, planningTimezone: string): boolean`;
`normalizeProviderAllDayRange(startDate: string, endDateExclusive: string, timezone: string): { startsAt: Date; endsAt: Date }`.
Use existing local-date utilities, validate the exclusive end, and do not reinterpret timed events.
The API daily brief continues its existing public shape; exact date membership happens before capacity and event selection.

- [ ] Add failing regression fixtures for Google October 12–13 date-only holiday in America/New_York: absent October 11, present October 12, absent October 13. Add iCloud DATE, local all-day, recurrence, multi-day, timed midnight, DST and source/planning-timezone mismatch cases.
- [ ] Run `pnpm exec vitest run packages/connectors/src/google.test.ts packages/connectors/src/icloud.test.ts packages/domain/src/calendar-day.test.ts apps/api/src/daily-brief-service.test.ts`; confirm failures expose current normalization/membership behavior.
- [ ] Implement the shared date contract, audit source normalization and all-day write round trips, and use exact membership after padded candidate retrieval in the brief. Timed items use half-open instant overlap; future items outside today are excluded.
- [ ] Implement idempotent repair of legacy local mirrors from trusted provider date fields or authoritative resync. Test rerun, missing source evidence, unchanged provider IDs, recurring instances, and no outgoing provider mutation. Never blindly shift midnight rows. Record unresolved records and explicit recovery.
- [ ] Run the focused tests plus `pnpm exec vitest run apps/api/src/calendar-service.integration.test.ts apps/api/src/calendar-all-day-repair.integration.test.ts`; require all passing with real test database. Check Calendar/native snapshot consumers against repaired records.
- [ ] Commit the date fix and its tests as one independently reviewable change.

## Task 2: Today preferences and bounded weekly commitments

**Files:** create `packages/domain/src/today.ts`, `today.test.ts`; export from domain `index.ts`;
modify `packages/database/src/schema.ts` and generate the next migration with the repository database workflow;
create `apps/api/src/today/settings-service.ts`, `commitments-service.ts`, `settings-service.integration.test.ts`,
`commitments-service.integration.test.ts`, and `apps/api/src/routes/today.ts`; register in `apps/api/src/app.ts`.
Create `packages/api-client/src/features/today.ts` and `today.test.ts`, composed from `client.ts`.
Create `apps/web/src/features/today/preferences.ts`, `preferences.test.tsx`, `settings.tsx`, `settings.test.tsx`.
Use the existing `settings-save.ts` and workspace save/recovery behavior without expanding workspace types.

**Interfaces:** spec's `TodayPreferences`, `TodaySettings`, `UpdateTodaySettings`;
client methods `getTodaySettings(): Promise<TodaySettings>` and
`updateTodaySettings(input: UpdateTodaySettings): Promise<TodaySettings>`.
Add `getTodayCommitments(query: { filter: TodayPreferences['commitmentFilter']; includeUndated: boolean; cursor?: string; limit?: number }): Promise<TodayCommitmentPage>`
at GET `/v1/today/commitments`. `TodayCommitmentPage` contains `generatedAt`, `timeZone`,
`weekStart`/`weekEndExclusive` local-date strings, `items`, `nextCursor`, `counts` (all/overdue/tasks/reminders)
and `unavailableSources` (tasks/reminders). Items are `{ kind, group, material }`, discriminated by
task/reminder with native domain records and groups overdue/today/later_this_week/undated.
Counts are nullable when their contributing source is unavailable; do not imply zero.

- [ ] Add strict-schema tests for exact defaults, partial patch without default injection, unknown-field rejection, invalid enums and revision validation.
- [ ] Add API tests for missing revision 0 read with no row creation, exact-revision save, conflicting parallel writes, wrong account, denied agent writes, transaction rollback including audit, and saved values equal to subsequent read.
- [ ] Add weekly projection tests for Sunday/Monday, DST, overdue from earlier weeks, earlier-today due timestamps, task reservation/due union, earlier-week carry-forward, undated off/on, completed/deleted exclusions, empty and failed sources, stable tie ordering and counts across pagination. Default page limit 6, maximum 100; filter and group before pagination. Bind cursors to owner, selected week/timezone, filter and undated flag; changed query/boundary rejects old cursors. Use bounded database queries and aggregate counts, not unbounded pet/client pagination.
- [ ] Run `pnpm exec vitest run packages/domain/src/today.test.ts apps/api/src/today packages/api-client/src/features/today.test.ts` and confirm the new tests fail before implementation.
- [ ] Implement the dedicated settings table, owner/session authorization, audited transaction and typed routes/client. Use server-side Calendar week-start preferences and account planning timezone for the weekly projection. Preserve independent Tasks/Reminders access and unavailable states.
- [ ] Implement `useTodayPreferences()` using one account/session-scoped serialized save channel, observed revisions, retained failed intent and explicit recovery. Add the canonical `/today/settings` editor and preview choices; all controls use this hook. Read-only settings search links can reveal this surface without writing.
- [ ] Test two mounted controls saving different fields, failed field followed by successful unrelated save, stale revision, ambiguous network outcome, account switch away/back, late completion, silent success and Sonner failure without inline result copy.
- [ ] Run all new focused tests and domain/API/web type checks. Commit settings and projection with migration, authorization and recovery evidence.

## Task 3: Main cards, timeline, loading and filters

**Files:** extract Today-owned code from `apps/web/src/app.tsx` into
`apps/web/src/features/today/page.tsx`, `timeline.tsx`, `commitments.tsx`, `conditions.tsx`,
`use-today-clock.ts`, with colocated tests. Modify existing Today CSS in `apps/web/src/styles.css`
(confirm stylesheet owner before edits), `apps/web/src/app.test.tsx`, and existing calendar `day-timeline.tsx`
only where point-marker support requires it. Add route/app-bar wiring in `app.tsx`.

**Interfaces:** `TodayPage` composes existing brief, Task/Reminder actions, Task 2 weekly client and
preferences. `TodayConditions` accepts independent location and weather query states.
`useTodayClock(timeZone: string, weekStartsOn: 'sunday' | 'monday'): Date` updates at least every 30
seconds while visible and on focus/resume, with a next-local-midnight invalidation timer.
`TodayTimeline` accepts native event/task/reminder discriminated items; reminder items are points,
not intervals with invented duration. Keep native source identity for all mutations.

- [ ] Add rendering tests for two named cards, mixed timeline kinds, due-today area, today-only boundary, task deduplication, true overnight overlap, and no fabricated reminder duration/date-only inference.
- [ ] Add queue tests for all four count-bearing filters, server pagination, grouping on page boundaries, retained filter preference, last-row completion, cross-card invalidation and completed history reopening.
- [ ] Add fake-time tests for midnight, week rollover, timezone change and resume after sleep; old cursors reset and fresh requests use the new boundary. Keep visible data marked stale until refreshed, without labeling yesterday as today's confirmed data.
- [ ] Add loading tests: weather/location buttons remain present, fixed container dimensions, location usable when weather fails, no TodayConditions body status row, cached content retained during refresh, and Sonner action feedback without inline outcome messages.
- [ ] Run `pnpm exec vitest run apps/web/src/features/today`; confirm failures, then implement the smallest extraction and composition. Do not refactor unrelated app-shell routes.
- [ ] Add Customize Today entry with keyboard focus return, semantic headings, real date range, and responsive stacked layout. Keep settings/card defaults from Task 2; no optional-card fetches before preferences resolve.
- [ ] Run focused tests and `pnpm exec vitest run apps/web/src/app.test.tsx`; commit the page refinement with updated canonical Today loading/layout rules.

## Task 4: Unified actionable attention

**Files:** create `apps/web/src/features/today/attention.tsx`, `attention-model.ts` and tests;
integrate `features/reviews/flow.tsx` navigation and existing connector/Finance health queries.
If the authoritative projection lacks a source, extend its owning reader in
`apps/api/src/agent-access-work-items.ts` and its source-reader modules, with
`agent-access-work-items.integration.test.ts`; do not create a second review store.

**Interfaces:** `TodayAttentionItem { id: string; sourceId: string; workspace: string; title: string; description: string; action: { label: string; href: string } }`;
`TodayAttentionState { items: TodayAttentionItem[]; state: 'checking' | 'clear' | 'attention' | 'unknown'; unavailableSources: string[] }`.
Build from typed existing owner results; route helpers validate known internal destinations. No raw provider URL or error string becomes an arbitrary action.

- [ ] Inventory every connected-account source and its actionable failure field/recovery route. Test Google/iCloud Calendar and Mail, Finance connections, other shipped account providers, shared-account duplication, review counts, and recovery disappearing only after authoritative refresh.
- [ ] Add tests for failed/partial source reads, denied domains, more than one result page, automatic recovery versus user intervention, zero results with unknown sources, optional cards off, and stale cached attention.
- [ ] Run `pnpm exec vitest run apps/web/src/features/today/attention-model.test.ts apps/web/src/features/today/attention.test.tsx`; confirm failures and implement independent composition with canonical identity deduplication.
- [ ] Implement stable attention status area; critical recovery first, then workspace reviews. Link to `/<workspace>?review=open` or encoded native item; connector repairs deep-link to the existing canonical editor. Never use obsolete `/reviews` or implement approval on Today.
- [ ] Verify 60-second visible-page polling and return-from-recovery invalidation; no background error-toast loop. Run owner API tests if projection readers change, plus existing review navigation tests. Commit.

## Task 5: Optional spending, ritual and pet cards

**Files:** create `apps/web/src/features/today/spending-card.tsx`, `ritual-card.tsx`, `pet-card.tsx`
and tests. Reuse `features/desktop/ritual-bridge.ts`, `bridge.ts`, `appearance-preview.ts`,
`features/tracking/ritual-overlay.tsx` (`RitualChecklist`) and Finance evidence formatting.
Make only the minimal platform separation needed in the shared ritual checklist.

**Interfaces:** each card consumes Task 2 preferences. Spending calls existing `getFinancePosition`
with local `from`/`through` and Finance `spendAccountIds`; period end is today, not the future week end.
Ritual uses `readRitualState()` and occurrence identity; desktop calls `openCurrentRitual()`, browser
opens `RitualChecklist` in a controlled dialog. Pet calls `nativeAction('quick_access')`.

- [ ] Add tests proving disabled/unauthorized cards issue no requests and pet appears only with desktop + pet enabled + showPet. Native failures deliver Sonner and no inline action outcomes.
- [ ] Add spending cases for week/month, saved account null/empty/subset, qualified/unavailable facts, no Finance accounts, stale refresh and timezone rollover. Assert missing evidence is never rendered as zero.
- [ ] Add ritual cases for pending/new/resumed/completed/skipped/no current occurrence, native pending-sync state, stale identity, browser checklist responses and absence of native readiness calls in browser.
- [ ] Run `pnpm exec vitest run apps/web/src/features/today/spending-card.test.tsx apps/web/src/features/today/ritual-card.test.tsx apps/web/src/features/today/pet-card.test.tsx`; confirm failures, implement and rerun until passing.
- [ ] Verify current native `quick_access` end to end in an installed desktop build and record observed behavior. Do not add appearance/reset controls or a new native Show pet command in this task.
- [ ] Run existing ritual and pet feature tests for any shared changes; commit cards and their tests.

## Task 6: MapCN and page backgrounds

**Files:** create adapted `apps/web/src/components/ui/map.tsx`,
`apps/web/src/features/today/location-map.tsx`, `map-config.ts`, `background.tsx` and tests;
modify `apps/web/src/components/icons.ts`, relevant CSS, `apps/web/package.json`, `pnpm-lock.yaml`,
`apps/web/vite.config.ts`, `apps/desktop/src-tauri/tauri.conf.json` only as required;
add `apps/web/scripts/prepare-map-assets.mjs` and its Node test if build-time copying is used.
Update environment/build/deployment documentation and configuration owners for the public map key.

**Interfaces:** `LocationMap({ coordinates, mode }: { coordinates: WeatherCoordinates; mode: 'preview' | 'background' })`;
`TodayBackground({ mode, weather, location })` uses spec's background enum and independent resolved data;
`map-config.ts` owns approved resource origins, theme style URLs and client-key URL transformation.
Worker/shared artifacts live side by side under a versioned same-origin asset directory.

- [ ] Start with MapLibre 6.14.0, whose archive was inspected during design; recheck package metadata/license and MapCN registry, then lock the version after build/runtime verification. Record upstream revision/hash. Inspect vendor source before importing only required primitives; use central reicon instead of Lucide.
- [ ] Add failing tests for exact worker/shared asset pair, missing/changed installed version, same-origin worker URL, CARTO key attached to approved resource requests only, denied hosts, attribution presence, timeout and unsupported WebGL fallback.
- [ ] Run `node --test apps/web/scripts/prepare-map-assets.test.mjs` and focused map tests; implement asset delivery, explicit style configuration and lazy wrapper. Keep third-party keyed resources out of service-worker precache/offline bulk downloads.
- [ ] Implement Default/Weather/Map previews and backgrounds: neutral fallback retains preference, no forced geolocation, no background gestures, reduced motion, readable card surfaces and accessible attribution outside any aria-hidden canvas.
- [ ] Verify map failure clears its 10-second timer, destroys its instance and has explicit retry; no render after account/location changes from an obsolete request. At most background plus one open preview; unmount cleans workers/listeners/WebGL resources.
- [ ] Provision a project-appropriate CARTO key through the normal operator configuration process before enabling real maps. Confirm resource URLs, quotas and allowed origins including packaged desktop; no paid plan or terms acceptance is implied by this plan.
- [ ] Run browser and packaged-desktop smokes using real authorized tiles. Check CSP console, local worker/shared module loading, light/dark, marker, controls, attribution, missing key, network block, unsupported WebGL2 and navigation cleanup. Record exact library version and build identity. Unresolved runtime/provider failures block map release even if unit tests pass.
- [ ] Commit the integration, lockfile, asset/configuration tests and boundary documentation together.

## Task 7: Integrated verification and handoff

**Files:** extend `apps/web/src/app.test.tsx`; create `e2e/today-refinements.spec.ts` using existing
fixture conventions; update `docs/design/pages/today.md`, `docs/design/feedback.md`,
`docs/product/workspace-settings.md`, `docs/design/pages/settings.md` and deployment notes.
Update `docs/product/implementation-log.md` only after actual delivery evidence exists.

- [ ] Check every spec section against Tasks 1–6 and resolve contradictions before integration. Keep source ownership and exact settings names consistent across schema, API, UI and fixtures.
- [ ] Add desktop/mobile acceptance fixtures for full/empty/overdue week, provider date regression, connector failure + review, unknown attention, optional cards, Default/Weather/Map and unavailable location.
- [ ] Test keyboard navigation, popover/dialog focus restoration, screen-reader loading/status, long names, narrow viewport, light/dark/reduced motion, no horizontal overflow and stable header/card geometry during delayed refresh. Assert no temporary body condition row or inline action-result copy.
- [ ] Run `pnpm exec playwright test e2e/today-refinements.spec.ts` against the checked-in lifecycle runtime; use `pnpm env:start`, `pnpm env:status` and fixtures workflow, not ad hoc background servers.
- [ ] Run required focused native checks for any native/shared bridge change. Perform the real map/ritual/pet desktop checks from Tasks 5–6; browser E2E does not replace them.
- [ ] Run `pnpm verify` before opening a PR, or the documented frozen-candidate equivalent during an authorized ship-it run. Require no unexplained failure and no waived coverage gate.
- [ ] Review final diff and target-versus-shipped docs. Report migration/repair execution state, map key/runtime evidence and unresolved release gates. Follow create-pr workflow if a PR is requested; no merge is authorized by this plan.

## Refinement pass completed for this draft

The review checked scope coverage, source paths, type names, defaults, platform behavior, dependency
requirements and negative cases. Corrections made before handoff: independent Today store; bounded
weekly projection rather than incomplete brief/pet data; all-day normalization and legacy repair;
point reminders rather than fake time blocks; cross-platform ritual launch; existing pet command;
workspace-specific reviews; optional-card lazy queries; local MapLibre worker pair; reicon adaptation;
CARTO key/attribution; real native/WebGL checks; stable attention region and independent location state.

No dependency was installed or product implementation tested by writing this plan. Static source
inspection, downloaded registry inspection, official documentation research and document consistency
checks establish design feasibility; runtime and migration behavior remain execution acceptance gates.


## Execution evidence — 2026-10-12

Tasks 1–6 are implemented in this branch, including the calendar-week projection, owner-scoped
Today settings, independent cards, attention aggregation, optional cards and MapCN integration.
The task checklists above preserve the original acceptance plan; this record distinguishes completed
source/browser evidence from release checks that still require the packaged applications.

- Final source commit: `5c23c210`. Full `pnpm verify` exited successfully: 408 test files and
  4,029 tests passed; coverage was 97.17% statements/lines, 94.08% branches and 95.79% functions.
  Repository contracts, lint, workspace types, production builds and 136 desktop/mobile browser
  tests passed, with two intentionally desktop-only tests skipped in the mobile project.
- Independent final review findings were resolved: iCloud outbound source dates, legacy Google
  repair before Calendar filtering, empty final commitment pages, and duplicate connector attention.
  Full acceptance additionally exposed local all-day events ending at 23:59; source-date membership
  now uses the final occupied instant, preserving both those events and midnight-exclusive holidays.
- One full run hit a Docker port-binding timeout before Finance Inbox setup. The unchanged suite
  passed 7/7 in isolation; after pausing the preview runtime, the single full retry passed. No test
  timeout, assertion or coverage threshold was relaxed.
- Migration `0112_today_preferences` ran against test and local fixture databases. There was no
  production migration or bulk historical repair. Legacy Google events with reliable raw DATE
  evidence repair on read; other uncertain source records require provider resynchronization.
- The public CARTO key was configured in ignored local environments. Real style, sprite, glyph
  and vector requests succeeded, and fixture-browser QA rendered tiles, preview controls, marker
  and attribution. Mobile filters and settings previews were measured and visually checked.
- Remaining release gates: real packaged desktop map/WebGL, ritual and pet smoke checks, and
  CARTO key/origin configuration in the intended production and desktop release environments.
  Browser mocks and native type checks do not establish packaged runtime behavior.

No PR, merge or deployment was requested or performed.
