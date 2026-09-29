# Morning and Night Rituals Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task in the current session. Use superpowers:subagent-driven-development only if the user selects delegation. Steps use checkbox syntax for tracking.

**Goal:** Install a usable macOS morning/night ritual experience with account-backed responses, reliable catch-up, and recorded escape behavior.

**Architecture:** Tracking owns definitions, occurrences, responses, and actions through the authenticated API. The resident desktop process schedules and persists delivery, while a dedicated native backdrop hosts the shared React checklist. One idempotent domain protocol serves online and offline actions.

**Tech Stack:** TypeScript, Zod, Hono, Drizzle/PostgreSQL, React/TanStack Query, existing shadcn controls, Tauri/Rust, Swift/AppKit, Vitest, Playwright.

**Spec:** [Morning and Night Rituals specification](../specs/2026-09-29-morning-night-rituals-design.md).

## Global Constraints

- Morning defaults to 06:00; night defaults to 21:00.
- Snooze lasts 10 minutes; confirmation starts at two prior confirmed snoozes in [press time minus 72 hours, press time).
- Counts are per account and ritual ID, across devices; cancelled attempts do not inflate confirmed snoozes.
- At most one currently eligible occurrence; the next enabled boundary expires unfinished prior work as missed.
- All configured steps must be submitted; text drafts do not auto-complete.
- Tracking data stays outside Task rows; short text remains a Tracking answer.
- Server identity, API authorization, revision checks, idempotency, and redacted audit apply to every mutation.
- macOS 14 minimum follows the desktop foundation. Preserve Windows compilation without claiming Windows overlay support.
- No sensitive text in plain native preferences, logs, audit, widgets, or analytics.
- Full pnpm verify and native/installed acceptance are release gates.

## Review Focus

- Sleep through several boundaries: present only the latest eligible ritual, preserve partial old evidence (Tasks 1, 4, 6).
- Definition or time-zone edits while a ritual is open: snapshot remains stable; future scheduling changes do not rewrite history (Tasks 1–3).
- Two devices snoozing/completing at once: deduplicate writes and re-confirm a changed count, never reopen terminal state (Tasks 2, 4).
- Sign-out while an offline text answer is queued: offer sync/discard, isolate encrypted data, prevent wrong-account replay (Tasks 2, 4, 6).
- Monitor removal/fullscreen/lock while confirmation is open: keep an escape available and record only actual user outcomes (Tasks 5, 6).

## Source baseline and prerequisite

Inspected current documentation base is main 095cda3f. Native files below were inspected on cooper/refine-macos-desktop at 33285305, not this older main checkout. Re-check main and the active foundation before starting; exact migration sequence numbers are allocated only after that reconciliation.

COO-51 — Harden macOS desktop connection and window reliability is an integration prerequisite for Tasks 3–6. Use the foundation's normal merge/integration path, preserve its unrelated work, and do not create a duplicate resident scheduler. A change of baseline requires a path/interface reconciliation in this plan, not blind copying.

- [ ] Inspect latest main and the foundation branch; confirm the desktop README, Keychain/session transport, native bridge, and coordinator are available.
- [ ] Record the implementation base and foundation integration commit in the execution issue.
- [ ] Keep implementation on a feature branch in a free managed worktree; follow repository ownership and migration rules.
- [ ] Implement sequentially by default. Integration changes to schema/composition roots stay with this workstream's integration responsibility.

## Task 1 — Tracking contracts, persistence, and schedule semantics

**Files**
- Create packages/domain/src/ritual.ts and ritual.test.ts.
- Create apps/api/src/ritual-schedule.ts and ritual-schedule.test.ts.
- Modify packages/domain/src/index.ts and packages/database/src/schema.ts.
- Add the next ordered migration in packages/database/migrations and its journal entry, following docs/engineering/database-migrations.md. Never renumber a published migration.
- Create apps/api/src/ritual-storage.integration.test.ts.

**Interfaces**
- Export RitualDefinition, RitualStep, RitualOccurrence, RitualResponse, RitualAction, RitualState plus validated request/result schemas described in spec §8.
- Define RitualWindow = { ritualId, definitionRevision, scheduledLocalDate, timeZone, dueAt, expiresAt }.
- Export currentRitualWindow(definitions: RitualDefinition[], now: string): RitualWindow | null.
- Export requiresSnoozeConfirmation(priorConfirmedCount: number): boolean, true when count >= 2.
- Persist lifecycle separately from snoozedUntil; response values are draft text, submitted text, or completed checkbox with supersession metadata.

- [ ] Write table-driven failing tests: 05:59 has the previous eligible night when configured; 06:00 selects morning; 20:59 retains morning; 21:00 selects night; one disabled ritual expires at its own next day boundary. Test initial enablement does not backfill old dates.
- [ ] Add explicit DST fixtures in America/New_York: nonexistent 2026-03-08 02:30 resolves to 03:00; ambiguous 2026-11-01 01:30 resolves to the earlier offset exactly once. Test a saved zone change affects future occurrences only.
- [ ] Add schema/storage tests for two kinds per owner, unique occurrence keys, owner-bound references, immutable snapshots, 20-step/5,000-character limits, and snooze thresholds 0/1/2.
- [ ] Run pnpm exec vitest run packages/domain/src/ritual.test.ts apps/api/src/ritual-schedule.test.ts apps/api/src/ritual-storage.integration.test.ts; confirm failures are missing behavior.
- [ ] Implement contracts, migration, pure schedule calculation, and persistence constraints. Use an existing zone-aware dependency if available; otherwise isolate a tested zone conversion adapter rather than hand-rolling offsets.
- [ ] Repeat focused tests and migration checks from repository policy; require all pass and git diff --check clean.
- [ ] Commit this unit as “feat: define ritual tracking and schedule contracts”.

## Task 2 — Account API, action ledger, and reconciliation

**Files**
- Create apps/api/src/ritual-service.ts, ritual-actions.ts, routes/rituals.ts, ritual-service.integration.test.ts, ritual-actions.test.ts.
- Create packages/api-client/src/features/rituals.ts and rituals.test.ts.
- Modify apps/api/src/app.ts, apps/api/src/openapi.ts, packages/api-client/src/client.ts.
- Update the existing scope registry, account export/deletion integration, and audit registration located during baseline reconciliation.

**Interfaces**
- RitualService.current(actor, now): Promise<RitualState> reconciles expiry transactionally.
- RitualService.saveDefinition(actor, input): Promise<RitualDefinition>.
- RitualService.saveResponse(actor, input): Promise<RitualState>.
- RitualService.act(actor, input): Promise<RitualActionResult>, where result is applied(state), confirmation_required(count, challenge), or conflict(state).
- RitualService.history(actor, query), export(actor), and deleteData(actor, ritualId) implement the bounded API in spec §8.
- Typed client exports listRituals, saveRitual, getCurrentRitual, saveRitualResponse, recordRitualAction, listRitualHistory, exportRitualData, deleteRitualData.
- Mutations carry requestId/deviceId and expectedRevision; confirmation carries a server-issued challenge bound to the presented count/occurrence. The server supplies authoritative recordedAt.

- [ ] Write failing API tests for every route: owner isolation, authentication, tracking:read/write checks, default-denied legacy tokens, validation and pagination limits.
- [ ] Write lifecycle tests: final submitted answer completes atomically; draft does not; skip preserves answers; next boundary expires pending/snoozed occurrences; disabled definitions cancel pending; retries return the same logical result.
- [ ] Write action tests with fixed instants: counts 0/1 apply; count 2 challenges; exactly 72-hour-old event is included and older is excluded; cancellation/skip/duplicate requests do not increase the count; morning/night remain separate.
- [ ] Add concurrent tests: two clients confirm against a stale count, answer versus Skip, replay after expiry, and action press followed by process abandonment. Require explicit conflict or refreshed confirmation without silent overwrite.
- [ ] Run pnpm exec vitest run apps/api/src/ritual-actions.test.ts apps/api/src/ritual-service.integration.test.ts packages/api-client/src/features/rituals.test.ts and confirm behavioral failures.
- [ ] Implement transactions, owner constraints, idempotency, append-only response correction, redacted audit, history/export/delete, and typed client/route registration. Historical offline evidence cannot mutate terminal state.
- [ ] Repeat tests; add deletion/log assertions proving private text never appears in audit or survives requested data deletion.
- [ ] Commit as “feat: persist ritual responses and escape history”.

## Task 3 — Setup, settings, and account history

**Files**
- Create apps/web/src/features/tracking/ritual-settings.tsx, ritual-history.tsx, ritual-queries.ts and matching tests.
- Modify apps/web/src/features/desktop/settings.tsx for the setup entry.
- Modify apps/web/src/app.tsx and the existing settings/navigation registry only for route registration.
- Reuse existing shared controls and semantic theme tokens.

**Interfaces**
- RitualSettings uses Task 2 typed client; edits use definition revision checks.
- RitualHistory uses listRitualHistory and exposes export/delete with explicit destructive confirmation.
- ritualKeys supplies owner/server-partitioned query keys and invalidation for definitions/current/history.
- Setup hands per-installation presentation enablement to the native settings bridge from Task 4.

- [ ] Write failing UI tests: opt-in onboarding, 06:00/21:00 defaults, explicit time zone, editable ordering/types/labels, separate morning/night toggles, same-time rejection, and no automatically prescribed medication steps.
- [ ] Add tests for mid-session definition edits, stale revision recovery, history showing attempts versus confirmed outcomes, text drafts versus submitted answers, queued/conflicting state, export and deletion.
- [ ] Run pnpm exec vitest run apps/web/src/features/tracking/ritual-settings.test.tsx apps/web/src/features/tracking/ritual-history.test.tsx; require behavioral failures.
- [ ] Implement settings/history and thin composition wiring. Show capability unavailable on unsupported servers; do not label locally queued content cloud-saved.
- [ ] Repeat focused UI tests, run typecheck, and check keyboard/mobile settings layout.
- [ ] Commit as “feat: configure rituals and view response history”.

## Task 4 — Resident scheduling and encrypted offline delivery

**Files**
- Create apps/desktop/src-tauri/src/ritual_schedule.rs and ritual_outbox.rs, with Rust unit tests.
- Modify apps/desktop/src-tauri/src/coordinator.rs, desktop.rs, preferences.rs, lifecycle.rs, native.rs and lib.rs only at bridge/lifecycle seams.
- Modify apps/desktop/macos/Sources/IloNative/Bridge.swift and Storage.swift for wake/unlock and secure persistence integration.
- Create apps/web/src/features/desktop/ritual-bridge.ts and ritual-bridge.test.ts.

**Interfaces**
- Native reconcile_rituals(reason, identity_generation) reads Task 2 state or cached schedule and publishes RitualState to the overlay.
- Native enqueue_ritual_mutation(identity, request) durably encrypts and records before returning locally_queued or cloud_accepted.
- Native flush_ritual_outbox(identity_generation) replays request IDs in order and reports conflicts.
- Web bridge exports readRitualState(), submitRitualResponse(input), submitRitualAction(input), subscribeRitualState(callback), and openCurrentRitual().
- Native state/events carry the current identity generation; obsolete callbacks cannot update another account.

- [ ] Write failing Rust/native tests for sleep across boundaries, wake after snooze, repeated reconciliation, app restart, lock suppression, clock change, one enabled ritual, and no backlog queue.
- [ ] Add outbox tests for crash after persist/before acknowledgment, double delivery, stale counts requiring honest confirmation, offline late replay against terminal server state, account/server switch, and deletion tombstones.
- [ ] Run cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml and swift test --package-path apps/desktop/macos; require new behavior tests fail.
- [ ] Implement resident deadline reconciliation using the existing lifecycle. Implement encrypted account-partitioned persistence with Keychain-backed key material and scoped, generation-fenced replay.
- [ ] Implement sync/discard choice before sign-out with pending writes; enforce no cached content after sign-out and no wrong-account replay. Keep crash/quit recovery durable.
- [ ] Repeat native tests and pnpm exec vitest run apps/web/src/features/desktop/ritual-bridge.test.ts. Inspect logs/files for plaintext response leakage.
- [ ] Commit as “feat: deliver rituals across wake and offline recovery”.

## Task 5 — Native backdrop and guided checklist

**Files**
- Create apps/desktop/macos/Sources/IloNative/RitualOverlay.swift and corresponding native tests.
- Create apps/web/src/features/tracking/ritual-overlay.tsx and ritual-overlay.test.tsx.
- Modify native bridge/window registration and desktop web entry routing for a dedicated overlay surface.
- Update apps/web/src/styles.css only for semantic overlay tokens/layout.

**Interfaces**
- Native presentRitualOverlay(identityGeneration, occurrenceId) creates the active-display content window and backdrop-only windows elsewhere.
- Native dismissRitualOverlay(occurrenceId) tears down only the matching occurrence.
- React RitualOverlay consumes Task 4 state subscription/mutation functions, never a separate private cache or direct provider connection.
- Escape-action responses use Task 2 challenge/count semantics; native queued outcomes remain visible in history.

- [ ] Write failing UI tests: ordered full list, next-step emphasis, explicit text submission, automatic final completion dismissal, 10-minute snooze, small Skip, exact count-2 confirmation copy, and recorded cancellation.
- [ ] Add tests for network failure, queued save indicator, stale occurrence replacement, window closure with no fabricated Skip, focus retention, and Escape returning from confirmation.
- [ ] Run pnpm exec vitest run apps/web/src/features/tracking/ritual-overlay.test.tsx plus new Swift overlay tests; require behavioral failures.
- [ ] Implement the native AppKit backdrop and dedicated checklist view, using reduced-transparency solid fallback. Do not request screen capture permissions or create a kiosk.
- [ ] Implement multi-display teardown/recreation and identity fencing; observe lock state before presenting sensitive content.
- [ ] Repeat tests and manually inspect keyboard/VoiceOver, reduced motion/transparency, fullscreen/Spaces, display unplug, and OS switching/quit. Record actual platform limits.
- [ ] Commit as “feat: present morning and night ritual overlays”.

## Task 6 — Integration, hosted rollout, and installed acceptance

**Files**
- Create e2e/rituals.spec.ts using existing acceptance conventions.
- Update apps/desktop/README.md, docs/product/implementation-log.md, API capability inventory, and this plan's execution record.
- Use the existing deployment and macOS build/install tooling; do not add a second release pipeline.

**Interfaces**
- Consumes all prior deliverables; publishes a tested compatible API capability and installed app.
- Evidence record includes API version/migration, app build commit, test output, installed path, known limitations, and actual configured ritual times.

- [ ] Add E2E scenarios for setup → morning responses → completion/history, third snooze confirmation, Skip/missed distinction, and server-unavailable recovery.
- [ ] Run focused acceptance with deterministic clock fixtures and repeat the critical paths on the native build.
- [ ] Run pnpm verify; require all checks including repository coverage floors and desktop/mobile browser acceptance to pass.
- [ ] Run cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml, swift test --package-path apps/desktop/macos, and pnpm --filter @personal-os/desktop exec tauri build --debug --bundles app --ci; require success. Follow foundation README for additional native/release checks and preserve Windows CI compilation.
- [ ] Verify additive migration and older-client compatibility on staging/local database before the hosted rollout. A desktop-only install cannot deliver account saving without the API capability.
- [ ] Prepare the hosted API rollout and compatible app bundle using existing release tools; satisfy any actual environment approval rules at execution time. Deploy API first, then verify authenticated ritual endpoints on the chosen server.
- [ ] Install the compatible desktop build and exercise 08:30 catch-up, close-to-background, lock/unlock, 21:00 replacement, offline restart/reconnect, logout with unsynced text, and multi-display escape access.
- [ ] Update Linear issues and implementation log with results; distinguish code complete, deployed API, and installed acceptance. Do not close the parent until the user can use it.
- [ ] Commit verification/docs updates as “test: verify installed ritual lifecycle”.

## Coverage and handoff

Spec §§3–4 map to Tasks 1/3/4; §§5–6 to Tasks 1/2/4/5; §7 to Task 5; §§8–9 to Tasks 1–4; §10 to Task 6. Export/deletion, identity isolation, action attempts, and offline conflicts are part of this slice, not unspecified follow-ups.

Default implementation order is 1 → 2 → 3 → 4 → 5 → 6. Tasks 3–6 also depend on the desktop foundation integration. Linear will contain one parent outcome, six matching sub-issues with blocking relations, and full copies of this plan and its spec. No implementation, deployment, or installation is performed by this planning request.

## Linear execution record

- Parent: [COO-62 — Deliver morning and night desktop rituals](https://linear.app/coopersully/issue/COO-62/deliver-morning-and-night-desktop-rituals).
- [Specification in Linear](https://linear.app/coopersully/document/morning-and-night-rituals-specification-2646dbf63ead).
- [Implementation plan in Linear](https://linear.app/coopersully/document/morning-and-night-rituals-implementation-plan-39fb833566a0).
- Task 1: [COO-63 — Define ritual tracking contracts and schedule semantics](https://linear.app/coopersully/issue/COO-63/define-ritual-tracking-contracts-and-schedule-semantics).
- Task 2: [COO-64 — Persist ritual responses, snoozes, and account history](https://linear.app/coopersully/issue/COO-64/persist-ritual-responses-snoozes-and-account-history).
- Task 3: [COO-65 — Add ritual setup, settings, and history screens](https://linear.app/coopersully/issue/COO-65/add-ritual-setup-settings-and-history-screens).
- Task 4: [COO-66 — Deliver rituals across wake and offline recovery](https://linear.app/coopersully/issue/COO-66/deliver-rituals-across-wake-and-offline-recovery).
- Task 5: [COO-67 — Build the native ritual backdrop and checklist](https://linear.app/coopersully/issue/COO-67/build-the-native-ritual-backdrop-and-checklist).
- Task 6: [COO-68 — Verify and install the complete ritual experience](https://linear.app/coopersully/issue/COO-68/verify-and-install-the-complete-ritual-experience).

All implementation issues start in Todo with High priority. Blocking relations follow the plan order; desktop settings and native work additionally depend on COO-51 — Harden macOS desktop connection and window reliability. Linear owns execution status; repository documents retain the design and build contract.
