# Active Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only if Cooper selects delegated execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver persistent, draggable macOS cards for opted-in tasks/reminders, including
incomplete reminders that became due while the person was away.

**Architecture:** Extend the existing item domains and shared storage with a resolved flag and
an account creation default. A separate Rust feed coordinator supplies authoritative material to
a native Swift activity/router/presenter, preserving OS notification fallback and source revisions.

**Tech Stack:** TypeScript/Zod, PostgreSQL/Drizzle, React/shadcn, Rust/Tauri, Swift/AppKit/SwiftUI,
UNUserNotificationCenter; existing dependencies only.

**Spec:** [Active reminders design](../specs/2026-10-22-active-reminders-design.md).

Status: proposed execution plan; no implementation tasks have started. Cooper approved the core
interaction and away/return behavior and requested this plan. Review the proposed defaults and
native delivery tradeoff before executing. Recommended execution is native in this chat because
the work is sequential across one API/native contract; an independent whole-branch review follows.

## Global Constraints

- Product spelling is `nohmi`; macOS 14+ is the native first-release target.
- Existing items and `defaultActiveReminder` start false; device `activeRemindersEnabled` starts true.
- Create omission inherits the account default; explicit false wins; update omission preserves.
- Activity threshold is 120 seconds; native preparation starts two seconds before eligible delivery;
  the proposed OS safety fallback is five seconds after eligible delivery.
- Only fresh revalidation no older than 15 seconds may reveal a new card; refresh at most every
  15 seconds while active and immediately on return/authentication/action changes.
- Use one stack with three visible layers, all items accessible, and 24-point edge snapping.
- No new packages, permission prompts for input capture, production mutations, provider calls,
  autonomous merge, or unrelated workspace/object-model migration.
- Honor existing native notification enablement/source/permission/quiet-hour/privacy controls;
  do not claim custom cards automatically obey macOS Focus.
- Complete native boundary evidence, Rust/Swift tests, and `pnpm verify` before feature handoff.

## Review Focus

1. A person is active in a different application with nohmi's main window closed: card delivery
   must work without depending on the foreground delegate (Tasks 1 and 5).
2. An incomplete item falls outside the daily brief or pet's first 100 items: it remains reachable
   and is not silently retired (Tasks 3 and 4).
3. An account switches during an in-flight page or completion request: no card, content, or mutation
   result may cross server/account generations (Tasks 4 and 6).
4. A creation request is replayed after the default changes: the original item and resolved flag
   must be returned, preserving idempotency (Task 2).
5. A process dies or storage fails during takeover: retain the accepted OS fallback and reconstruct
   still-incomplete cards on authenticated restart (Tasks 1, 5, and 7).

## Ownership and file map

One implementation owner owns this vertical feature, including composition-root and migration
integration. No parallel writable work is proposed. Keep existing domain mutation owners intact.

| Responsibility | Existing files | New focused files |
| --- | --- | --- |
| Flag/default contract | `packages/domain/src/{task,reminder,index}.ts` | `packages/domain/src/active-reminders.ts` |
| Storage and serializers | `packages/database/src/schema.ts`, migration journal, `apps/api/src/serialization.ts` | next additive migration; migration integration test |
| Default resolution and mutation rules | `apps/api/src/{task-service,reminder-service}.ts` | `apps/api/src/active-reminder-preferences.ts` |
| Feed/preferences API | `apps/api/src/app.ts`, API-client feature registry | `apps/api/src/active-reminder-service.ts`, `routes/active-reminders.ts`, `packages/api-client/src/features/active-reminders.ts` |
| Item and default controls | `apps/web/src/app.tsx`, `features/tasks/task-dialog.tsx`, `features/desktop/{settings,bridge}.tsx/ts` | `features/reminders/reminder-dialog.tsx`, `features/notifications/active-reminder-settings.tsx` |
| Native feed/session/actions | `apps/desktop/src-tauri/src/{coordinator,desktop,lib,native,lifecycle,preferences}.rs` | `apps/desktop/src-tauri/src/active_reminders.rs` |
| Activity, routing, storage, cards | `apps/desktop/macos/Sources/IloNative/{Bridge,Models,Notifications}.swift` | `MacActivity.swift`, `ActiveReminderModels.swift`, `ActiveReminderRouting.swift`, `ActiveReminderStore.swift`, `ActiveReminderPanel.swift` |

Read the applicable repo-local architecture/database/frontend/MCP/testing skills before modifying
their surfaces. Read design foundations/system, database-migrations, and external-boundary reliability
docs. Use existing settings feedback, API errors, authentication, audit, migration, and icon patterns.

### Task 1: Prove native activity and notification takeover

**Files:** Create an isolated probe under `work/active-reminders-native-probe/` in the worktree;
keep throwaway code uncommitted. Record evidence in a new
`docs/superpowers/specs/2026-10-22-active-reminders-native-evidence.md` when the probe runs.

**Interfaces:** Consumes current `NotificationController`, `PetScene` window/session patterns,
and the spec's timing values. Produces a recorded go/no-go for the exact routing and activity
predicate, with supported OS version and observed permission behavior. This is an execution gate.

- [ ] Build the smallest signed/native harness that schedules one OS occurrence, samples elapsed
  input and lock/display/session state, and opens one non-activating panel at its due time.
- [ ] Verify keyboard, mouse, scroll, dragging, idle at 119/120 seconds, lock/unlock, and display
  sleep. Record whether public elapsed-input APIs work with no input-capture permissions.
- [ ] Run the spec's two-second preparation/five-second fallback protocol with nohmi in front,
  another app in front, and the main window closed. Verify current-notification request replacement,
  successful panel presentation, cancellation, and full-screen/Spaces behavior.
- [ ] Kill the process after fallback acceptance, after presentation, and before cancellation;
  verify the fallback or restored card remains available. Simulate permission denial and write
  failure. Verify normal system delivery continues while away.
- [ ] Record pass/fail observations and limitations. If background takeover, unlocked-state detection,
  or safety fallback is unproven, stop dependent native routing work and revise the design with
  Cooper. A mock or a foreground-only success does not pass this gate.

### Task 2: Persist item flags and account creation defaults

**Files:** Modify domain task/reminder exports, database schema and next migration/journal,
API serializers and owning task/reminder services. Create `active-reminders.ts` and
`active-reminder-preferences.ts`; add `apps/api/src/active-reminder-defaults.integration.test.ts`
and `active-reminder-migration.integration.test.ts`.

**Interfaces:** Export `ActiveReminderPreferences = { defaultActiveReminder: boolean; revision: number }`
and discriminated `ActiveReminderCandidate` as specified. Create/update inputs accept optional
`activeReminder`; response records expose a resolved boolean. Internal
`readActiveReminderPreferences(tx, userId): Promise<ActiveReminderPreferences>` returns false/0
for an absent row and is used within each owning create transaction.

- [ ] Write integration tests that assert: old task/reminder rows survive migration with false;
  absent preference is false/0; default true plus omitted flag creates true for both domains;
  explicit false creates false; update omission preserves; default changes leave existing rows alone.
- [ ] Add tests proving task idempotency replay after a default change returns the same ID and original
  flag; foreign-owner IDs cannot be changed; revision conflicts are rejected; audit redaction retains
  the flag without adding private content. Exercise task conversion/import paths that create shared rows.
- [ ] Run `pnpm exec vitest run apps/api/src/active-reminder-defaults.integration.test.ts apps/api/src/active-reminder-migration.integration.test.ts`;
  confirm failure is due to the missing feature, not environment setup.
- [ ] Implement the additive column/table migration, schemas, serializers, transaction-bound default
  resolution, idempotency intent handling, and mutation/audit coverage. Coordinate the next migration
  number with current main; never renumber shared migrations.
- [ ] Repeat the focused command and the existing domain/service tests selected by the verification
  planner. Expect all to pass, including old payloads with no flag.
- [ ] Commit as `feat: persist active reminder preferences and item flags`.

### Task 3: Expose preferences and authoritative candidate feed

**Files:** Create `apps/api/src/active-reminder-service.ts`,
`apps/api/src/routes/active-reminders.ts`, corresponding route/service tests, and
`packages/api-client/src/features/active-reminders.ts`. Modify `apps/api/src/app.ts` and the existing
API-client composition/export registry. Extend existing MCP task/reminder schemas only where their
current adapters enumerate fields; do not add a separate active-reminder business rule or tool.

**Interfaces:** `createActiveReminderService(db)` exposes `getPreferences(userId)`,
`savePreferences(userId, {defaultActiveReminder, expectedRevision}, mutationContext)`, and
`listCandidates(userId, {cursor?, limit?})`. Typed client methods are
`getActiveReminderPreferences()`, `saveActiveReminderPreferences(input)`, and
`listActiveReminderCandidates(query)`, returning the spec's response envelopes. Three endpoints,
auth requirements, cutoff, ordering, and concurrency follow the spec exactly.

- [ ] Write tests for user-session admission, rejected agent sessions, owner-bound cursor reuse,
  malformed cursors, first-write revision 0, concurrent-save conflicts, and preference audit writes.
- [ ] Write feed tests with 205 opted-in items spanning tasks/reminders and overdue ages; traverse
  all pages and assert no duplicates/omissions. Exclude completed/cancelled/deleted/untimed/opted-out
  items, include due times through the fixed 24-hour cutoff, and exclude other owners.
- [ ] Run `pnpm exec vitest run apps/api/src/active-reminder-service.integration.test.ts apps/api/src/routes/active-reminders.test.ts`;
  confirm intended failures.
- [ ] Implement service queries and cursor validation, thin routes, OpenAPI/export wiring and typed
  client. Reuse existing authorization/error/audit transport. Store defaults server-side; never infer
  them from the creating client's local settings.
- [ ] Repeat focused tests and relevant API-client/MCP contract checks. Expect existing create calls
  to inherit the default and explicit booleans to survive every adapter.
- [ ] Commit as `feat: expose active reminder preferences and desktop candidates`.

### Task 4: Synchronize native candidates without pet limits

**Files:** Create Rust `active_reminders.rs`, Swift `ActiveReminderModels.swift`, and focused native
tests. Modify Rust `lib.rs`, `desktop.rs`, `preferences.rs`, `coordinator.rs` only for registration,
refresh triggers and device settings; extend Swift `Bridge.swift` dispatch and native status.

**Interfaces:** Rust owns a separate candidate inventory and calls native op
`active_reminders_snapshot` with `{serverUrl, accountId, generation, generatedAt, items}` only after
all pages succeed. Swift decodes `ActiveReminderCandidate` and accepts only the current account
generation. Native op `active_reminders_clear` invalidates timers, cards and pending action callbacks.
These operations must return explicit unavailable errors on other platforms.

- [ ] Add Rust tests proving 205 items are fetched across pages, page failure does not publish empty
  success, changed account generations discard late pages, and opted-in cards work with the pet off.
  Add Swift decoding tests for old snapshots/settings with absent fields and unknown additive fields.
- [ ] Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml active_reminders` and
  `swift test --package-path apps/desktop/macos --filter ActiveReminder`; confirm intended failures.
- [ ] Implement separate authenticated polling, coalesced wake/action refresh, identity fencing,
  freshness accounting, full-page publication and device pause persistence. Never derive retirement
  from a failed or partial fetch. Revalidate a source item before newly revealing its card.
- [ ] Repeat focused tests. Exercise a failed feed then successful empty feed: only the latter
  retires previously eligible cards. Verify source-revision fences prevent late page/action results
  from replacing newer material within the same account.
- [ ] Commit as `feat: synchronize authoritative active reminder candidates`.

### Task 5: Implement activity-aware delivery and persistent card placement

**Files:** Create Swift `MacActivity.swift`, `ActiveReminderRouting.swift`, `ActiveReminderStore.swift`,
`ActiveReminderPanel.swift` and tests under `apps/desktop/macos/Tests/IloNativeTests/`.
Modify `Bridge.swift`, `Models.swift` and `Notifications.swift` at their existing notification seams.

**Interfaces:** `MacActivityState` contains `isActive` and availability; the monitor exposes
`sample(now:)` with injected input/session/display providers. `ActiveReminderRouter` consumes candidate
inventory, activity, native preferences, time and injected OS/panel/store adapters. Its outputs use
the stable occurrence identity and existing `AlertPlanner` quiet-hour/time-zone calculation.
`ActiveReminderStore` atomically persists minimal receipts and per-display normalized placement.
`ActiveReminderPanelController` renders a single ordered stack and reports presentation success
or failure; it never decides eligibility or completes API records.

- [ ] Add deterministic tests named for `activeAt119Seconds`, `awayAt120Seconds`,
  `unknownOrLockedIsAway`, `quietHoursDeferReveal`, `returnShowsOnlyIncomplete`,
  `fallbackSurvivesStoreFailure`, `restartRequiresFreshAuthentication`, and
  `dateChangeCreatesNewOccurrence`. Assert the exact spec timing values and DST behavior.
- [ ] Add geometry/stack tests: 24-point snapping, monitor removal, reduced visible frame, stable
  selection after new arrival, more than three pending items, privacy redaction and paused device.
  Include due-time edits/flag removal and failures between each OS/panel/store handoff.
  Assert ordinary notification reconciliation cannot overwrite a claimed fallback or reissue a
  cancelled occurrence, and re-enabling a due item's flag shows a card without another normal banner.
- [ ] Run `swift test --package-path apps/desktop/macos --filter ActiveReminder`; confirm the
  tests fail for missing feature behavior.
- [ ] Implement monitor, atomic store, timer/router and theme-consistent accessible panel. Keep OS
  scheduling for away/unavailable/failed/stale cases. Only apply the takeover protocol proven in
  Task 1; cancellation races remain observable, never advertised as exactly once.
- [ ] Repeat focused tests and all native Swift tests. Repeat Task 1's other-app/closed-window smoke
  with the actual implementation, including permission loss, lock, quit and full-screen behavior.
- [ ] Commit as `feat: present persistent activity-aware reminder cards`.

### Task 6: Complete from cards and expose user controls

**Files:** Extend Rust `active_reminders.rs` and the native callback dispatch in `lifecycle.rs`;
extend Swift router/panel/bridge action result handling. Modify web task dialog and desktop settings;
extract the existing `ReminderDialog` from `app.tsx` into `features/reminders/reminder-dialog.tsx`
as part of this feature. Create `features/notifications/active-reminder-settings.tsx` and tests;
update the desktop TS bridge and settings registry/search metadata where necessary.

**Interfaces:** Native action `active_reminder_complete` carries `{requestId, serverUrl, accountId,
generation, kind, id, dueAt, revision|updatedAt}`. Rust validates current identity and source then
calls the existing task/reminder complete endpoint with its proper concurrency body. It returns
`active_reminder_action_result` containing request/occurrence identity and
`outcome: "completed" | "conflict" | "failed"`. Card removal requires confirmed completion or an
authoritative source retirement. Opening uses existing validated destinations and does not retire.

- [ ] Write action tests for success, double-click, offline/timeout, stale revision, completion
  elsewhere, due-time edit while submitting, auth loss and account change before response. Assert
  errors remain on the originating card and no late result dismisses a different occurrence.
- [ ] Write UI tests for create default false/true, explicit override, edit persistence, default
  save conflict/retry, device pause, and unchanged old items after default changes. Assert copy:
  **Active reminder**, **Use active reminders for new items**, **Pause active reminders on this Mac**.
  Explain the away/return behavior and that cards can appear during macOS Focus.
- [ ] Run `pnpm exec vitest run apps/web/src/features/reminders/reminder-dialog.test.tsx apps/web/src/features/tasks/task-dialog.test.tsx apps/web/src/features/notifications/active-reminder-settings.test.tsx apps/web/src/features/desktop/settings.test.tsx`
  and the Rust/Swift active-reminder tests; confirm intended failures.
- [ ] Implement revision-bound callbacks, explicit action results, pending/error/retry UI and
  material-refresh events. Add controls using existing shadcn/settings feedback patterns. Default
  lookup failure must not silently save false; allow retry or an explicit per-item choice.
- [ ] Repeat focused tests, existing reminder creation UI tests and desktop bridge/session tests.
  Verify toggling device pause hides cards immediately while normal OS scheduling continues.
- [ ] Commit as `feat: add active reminder controls and reliable completion actions`.

### Task 7: Acceptance, rollout evidence and implementation handoff

**Files:** Add `e2e/active-reminders.spec.ts`; update canonical product/settings/design documentation
only where implemented behavior or accepted decisions require it. Add delivered evidence to
`docs/product/implementation-log.md` only after implementation. Update native evidence from Task 1.

**Interfaces:** Consumes all previous tasks. Produces a reviewable branch with verification receipts,
native smoke evidence, compatible migration/API rollout and explicit remaining limitations.

- [ ] Add browser E2E for default save → task/reminder create → per-item override → reload. Keep
  native-only assertions in the native harness; browser success is not proof of card delivery.
- [ ] Run all Rust and Swift tests with `pnpm --filter @personal-os/desktop test:native`; expect
  passing results. Run `pnpm verify` through the repository lifecycle runner; retain failures as
  failures and resolve them without reducing coverage requirements.
- [ ] Use local fixtures to verify away OS delivery → complete elsewhere → return without a card,
  and away OS delivery → return incomplete → move card → complete successfully. Also verify
  process death during takeover, network loss, permissions, preview off, quiet hours, device pause,
  display removal, keyboard access and reduced-motion/transparency modes.
- [ ] Exercise rollback by disabling card presentation and verifying outstanding occurrences are
  restored to ordinary scheduling while stored flags/defaults remain intact. Confirm older clients
  can omit fields and that the new API is deployed before clients submit those fields.
- [ ] Update evidence and canonical docs to distinguish native observations, automated tests,
  limitations and genuinely delivered behavior. Commit as `test: verify active reminder delivery and recovery`.
- [ ] Obtain independent whole-branch review after Cooper selects execution/review scope. Resolve
  findings before handoff. If a PR is requested, use repository `create-pr`, resolve the live Nohmi
  Linear Project, link the direct issue, and attach the resulting PR. Do not merge automatically.

## Plan self-review

Spec requirements map to Tasks 1–7: native boundary evidence (1), storage/defaults (2), API and
paging (3), identity/freshness transport (4), routing/appearance/placement/lifecycle (5), actions
and settings (6), and regression/rollout evidence (7). Review-focus failures each have an owning
test step. A single resolved flag, candidate type, stable occurrence identity, and discriminated
concurrency token travel through all layers. Native delivery is gated on actual Mac evidence;
no task claims a foreground callback is sufficient for background activity-aware presentation.
