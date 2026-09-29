# Morning and Evening Rituals — Product and Technical Specification

Date: 2026-09-29
Status: Product behavior agreed in chat; implementation specification ready for execution review. No feature code or deployment is included in this documentation change.

## 1. Outcome and scope

Give Cooper a calm, ordered morning and evening checklist that appears over the macOS desktop, saves responses to the signed-in Nohmi account, and remains available when the computer wakes after the configured time.

The first release provides two editable rituals, checkbox, short-entry, time, date, number, and multiple-choice steps, daily scheduling, a native desktop backdrop, completion history, and recorded snooze/skip behavior. It does not require an agent, the full Tracking workspace, analytics, task recurrence, or a new journal product.

Confirmed behavior:
- Morning defaults to 06:00; night defaults to 21:00. Both times and enablement are configurable in the app.
- These times make a ritual due; they are not appointments the user must be present to catch.
- A due ritual appears on wake/unlock or app launch and remains pending until completed, skipped, or superseded.
- Each ritual shows all steps in order, emphasizing the next unfinished step. Completing all steps dismisses it.
- Snooze and Skip are small, visible escape actions. Every press is recorded.
- Snooze lasts 10 minutes. If that same ritual has already been snoozed at least twice in the preceding 3 days, another snooze requires confirmation showing that count.
- A new due ritual expires the previous unfinished ritual as missed, preserving partial responses. Old checklists never pile up.

Implementation defaults below resolve engineering details without adding a separate product phase.

## 2. Existing foundations and integration prerequisite

The older master plan covers habits/reflection (Epic 8), daily start/shutdown (Epic 7), and desktop surfaces (Epic 10). The newer Tasks and Tracking Ledger Design, dated 2026-08-12, supersedes the old task/habit framing: finite work belongs to Tasks; repeated observations belong to Tracking. Rituals are a first Tracking slice, not recurring Task rows.

Inspected sources:
- Current documentation checkout: main at 095cda3f.
- Desktop foundation: branch cooper/refine-macos-desktop at inspected commit 33285305, in /Users/cooper/.codex/worktrees/424c/personal-os.
- Desktop foundation README describes Tauri/Rust residency, native Swift integration, Keychain identity, close-to-background, and wake reconciliation.
- That branch contains docs/superpowers/specs/2026-08-12-tasks-and-tracking-ledger-design.md and docs/product/tasks-workspace-charter.md; these are absent in this older checkout.
- Existing Linear dependency: COO-51 — Harden macOS desktop connection and window reliability.

Execution must refresh main and reconcile the desktop foundation before coding. Do not overwrite its worktree, assume its changes are merged, or copy a second independent desktop runtime. Integrate the relevant foundation through its normal branch/PR path. Planning can finish before that integration.

## 3. Setup and configuration

After desktop sign-in, onboarding offers Morning and Evening rituals without enabling them silently. Existing users find the same controls under Settings → Rituals, plus a menu action to reopen the current ritual. Account configuration is shared; automatic presentation is enabled per installation so a second Mac does not start interrupting unexpectedly.

Each ritual has:
- Stable ID and kind: morning or night, unique per account.
- Enabled flag, title, local wall-clock due time, account IANA time zone, and revision.
- Ordered steps with stable IDs, label, kind (checkbox, short_text, time, date, number, or multiple_choice), and optional text placeholder.
- At least one and at most 20 steps; label 1–240 trimmed characters; text answer at most 5,000 characters.
- Reorder, add, edit, and remove controls. All configured steps must be answered to complete; Skip is the escape for an unfulfilled ritual.

Starter examples are offered for review: medication checkbox, teeth checkbox, journal short text. Do not assume a medication schedule or silently add medication to both rituals. Night starts from the user's chosen steps.

Use the existing account planning time zone when present, otherwise propose the device zone at setup and save it explicitly. Show the zone beside the time fields. Travel does not silently reinterpret account history. Reject identical morning/night times when both are enabled.

Configuration changes create a new revision. A pending occurrence keeps its step snapshot. Schedule edits apply to future occurrences; disabling a ritual immediately suppresses presentation and settles its current occurrence as cancelled_configuration, preserving responses. Re-enabling starts at the next scheduled boundary. Initial enablement can create the current eligible occurrence if its due time has passed; do not backfill earlier days.

## 4. Schedule and lifecycle

For each enabled ritual, compute daily boundaries in the saved IANA time zone. For a nonexistent DST wall time use the first valid instant after the gap; for an ambiguous time use the earlier instant, once. Identify each occurrence by account, ritual ID, and scheduled local date; persist resolved dueAt, zone, and definition revision.

An occurrence is due from its dueAt until the next enabled ritual boundary across either ritual. With only one enabled ritual, the next occurrence of that ritual is the boundary. At a boundary, expire any previous open or snoozed occurrence as missed before presenting the new one. Completion or Skip is terminal and never becomes missed later.

Persist lifecycle states: pending, completed, skipped, missed, cancelled_configuration. Snoozed is a presentation state on pending, represented by snoozedUntil, rather than completion.

A pure schedule calculation returns the latest eligible occurrence and its expiry; it never creates a presentation queue for every missed day. Reconciliation settles previously materialized occurrences and creates only the currently eligible one. Days during which the app never reconciled remain an unobserved gap, not invented records of user action.

Native reconciliation runs on launch, wake, unlock, significant clock/time-zone changes, relevant account refresh, and while resident at due/snooze deadlines with a bounded periodic fallback. The API independently enforces expiry on every state read/write; native scheduling is a delivery mechanism, not domain authority.

Do not wake the Mac or show private text on the lock screen. At 08:30 unlock, show the 06:00 morning ritual if it is still eligible. At 22:00 launch, show the 21:00 evening ritual and settle a materialized unfinished morning as missed. After explicit Quit, no foreground overlay is promised until the app launches again. Close-to-background and open-at-login use the existing desktop controls.

## 5. Responses and completion

Checkbox answers record completed; unchecked is unanswered, not a negative observation. Short-text steps need a nonempty trimmed answer. Persist text automatically after a brief 250 ms pause; nonempty trimmed text counts as answered. No per-field Save buttons. Saving an answer never completes or dismisses a ritual.

Each accepted response carries occurrence/step identity, observation time, recorded time, revision, and request ID. Repeated writes or retries do not duplicate the answer. Corrections append superseding records; unchecking before terminal completion retracts the prior completion without deleting its audit trail. Terminal occurrences are read-only in this release.

An explicit Complete Morning Ritual or Complete Evening Ritual action atomically marks completed only when every step in the immutable snapshot has an accepted response. The button remains disabled while answers are incomplete or saving, and includes the centered X of Y complete count. The overlay closes after that result, or after durable native offline capture with a clearly visible queued-sync status in history. Completion of a stale occurrence cannot complete the next day's ritual.

Short entries remain private Tracking text answers in v1. They are readable in ritual history and are not silently duplicated into the separate Journal domain. Future journal linking must preserve a single authoritative source.

## 6. Snooze, Skip, and exact counting

Every escape press gets a client-generated action ID and durable action record. Separate action kinds:
- snooze_pressed
- snooze_confirmed
- snooze_cancelled
- skip_pressed
- skip_applied

The rolling window is exactly 72 hours, [pressedAt - 72 hours, pressedAt), for the same account and ritual ID across occurrences and devices. Count prior accepted snooze_confirmed events only; the current press, cancelled confirmations, skips, retries, and delivery attempts do not count.

The first and second snoozes in that window apply immediately, recording pressed and confirmed. From the third onward, show:
“You’ve snoozed your morning ritual {count} times in the last 3 days. Snooze another 10 minutes?”
Use “evening ritual” for night. Buttons: “Snooze 10 minutes” and “Go back.” Confirmation cancellation records snooze_cancelled and leaves the overlay present.

A confirmed snooze sets snoozedUntil to confirmedAt + 10 minutes. Clamp presentation to the occurrence's expiry: at the next boundary, the new ritual takes precedence. A cancelled or expired confirmation cannot defer a later occurrence. Count queries use server time online. A concurrent count change returns the updated count and requires renewed confirmation if the displayed count is stale.

Skip applies to this occurrence only, records both press and applied outcome, dismisses the overlay, and preserves completed steps. It does not disable tomorrow's ritual. A rejected/stale press still has an attempt record but no applied outcome.

Confirmation and outcome IDs make double-clicks and retries idempotent. If a prompt is abandoned by process exit, the pressed event remains without an invented confirmed/cancelled event.

## 7. Desktop experience

Use a dedicated native overlay window over the current display, with native macOS backdrop blur and a centered opaque, legible checklist. Cover other connected displays with backdrop-only windows so unrelated content recedes. Reuse the existing Tauri/Rust ↔ Swift bridge. Web CSS blur alone is insufficient to blur unrelated application windows.

Keep decoration restrained: morning/night accent, greeting, date, and progress. Support keyboard navigation, screen-reader labels, reduced motion, high contrast, and Reduce Transparency (solid dimmed backdrop). Small Snooze and Skip controls remain keyboard reachable. Escape exits confirmation back to the ritual; it must not silently record a skip.

The overlay must not be a kiosk or security lock: OS switching and Quit remain possible. It stays above ordinary windows while active without repeatedly stealing focus. Test fullscreen apps, Spaces, monitor removal, and screen sharing; do not claim universal exclusion from screen capture. Render sensitive details only in the unlocked user session. No screenshot capture or Screen Recording permission is needed for the backdrop approach.

Native close/hide events never fabricate completion or Skip. If the main window is closed, the resident process still handles due rituals. Manual “Open current ritual” can reveal a snoozed occurrence without erasing its action history.

## 8. Domain, persistence, and interfaces

Tracking owns the account data and lifecycle. Desktop owns presentation/delivery; Integration wires routes, schema migrations, typed client, account settings, and native bridge.

Proposed module: packages/domain/src/ritual.ts.
Core contracts: RitualDefinition, RitualStep, RitualOccurrence, RitualResponse, RitualAction, RitualState. All IDs are opaque, times ISO instants, and revisions positive integers. RitualState includes current occurrence, saved responses, serverNow, snooze count, and sync status.

PostgreSQL tables:
- ritual_definitions and versioned ritual_definition_revisions (including step snapshot).
- ritual_occurrences with unique owner/ritual/local-date and snapshot reference.
- ritual_responses with supersession links and per-request uniqueness.
- ritual_actions with owner/ritual/occurrence/device/action IDs, event kind, observedAt, recordedAt, and applied/rejected outcome.

Use owner-bound foreign keys, optimistic concurrency, idempotency, and append-only redacted audit evidence. Do not store responses in Task rows or generic audit payloads.

API under /v1/rituals:
- GET / and PUT /:id for definitions (PUT carries expected revision).
- GET /current for reconciliation and current state.
- PUT /occurrences/:id/responses/:stepId for drafts/submitted values and corrections.
- POST /occurrences/:id/actions for escape press/confirmation/cancel/skip.
- GET /history with bounded cursor pagination and ritual/date filters.
- GET /export and DELETE /:id/data for user data portability/deletion; deletion disables the ritual and removes its response/action history.

Every mutation includes requestId, expectedRevision where applicable, and deviceId; derive account identity from authentication, never a caller's owner field. State conflicts return a typed conflict with current state. Snooze decisions return applied, confirmation_required (count and challenge bound to occurrence/revision), or conflict. Enforce body/field limits.

Direct human sessions use existing account authorization. Add tracking:read and tracking:write scopes to the existing token policy layer, default denied to old tokens; write permission does not imply read permission. This slice does not add agent orchestration or MCP tools. Export and deletion remain direct-human operations.

## 9. Offline, identity, and privacy

Persist account/server-bound native state and an encrypted durable outbox before acknowledging offline answers or escape presses. Key material uses the existing Keychain boundary; never put journal text in plain preferences, logs, analytics, widget snapshots, or generic audit fields. Use the same canonical occurrence/request IDs online and offline.

If history freshness cannot establish the 72-hour count, always require confirmation and say “Recent snooze history is unavailable. This device has recorded {count} snoozes in the last 3 days.” Never present a partial count as the account total. Reconcile server history on reconnect.

Offline actions preserve observedAt and recordedAt separately. Replay is idempotent and account-bound; a late action may contribute historical response evidence but cannot reopen a terminal occurrence, override an online Skip/completion, or affect a newer occurrence. Retain and visibly label rejected/conflicting local evidence rather than silently deleting it. Online server ordering wins terminal conflicts.

Sign-out/server switch removes visible/cached account content and prevents old queues from replaying into another account. If unsynced work exists, warn before sign-out with explicit discard or sync options; OS/process exit retains it encrypted. Account data deletion purges local snapshots/outbox on the next authenticated reconciliation. Do not show a cached ritual when signed out.

History shows due/completed/skipped/missed timestamps, answers, partial progress, each escape press, confirmation/cancellation outcomes, and queued/conflict state. Export preserves that distinction; deletion removes private answers and action details while retaining only allowed redacted audit metadata.

## 10. Acceptance and delivery

Acceptance scenarios:
1. 06:00 morning and 21:00 night defaults render in settings; times/steps/order/enablement persist to account.
2. Unlock at 08:30 presents the still-due morning ritual; completing checkbox/text steps closes it exactly once.
3. Closing the main app window preserves delivery; explicit Quit and relaunch catch up without duplicates.
4. First and second snoozes apply; third within 72 hours displays count 2; cancel is recorded but does not increase count.
5. Morning/night counts are separate; boundary timestamps, double clicks, retries, and concurrent clients cannot inflate counts.
6. Snooze preserves answers; Skip records an explicit skip; the next boundary marks unfinished work missed and presents only the new ritual.
7. Night spans midnight correctly; DST, clock changes, one disabled ritual, and changed schedules do not duplicate occurrences.
8. Offline answers/actions survive restart; stale history prompts honestly; reconnect does not duplicate or cross account boundaries.
9. Text autosaves; only the explicit Complete action completes an answered ritual; network failures never falsely claim cloud save.
10. Keyboard, VoiceOver, reduced motion/transparency, multiple displays, fullscreen/Spaces, and lock/unlock are exercised on the installed app.
11. Unauthenticated/cross-account/token-under-scoped calls fail; export/deletion and sensitive-log checks pass.
12. Hosted migration/API capability is verified before installing a compatible desktop build. Older clients keep working; unsupported servers show a clear unavailable state.

Required checks: focused unit/API/UI/native tests, migration checks, pnpm verify, cargo test, Swift tests, packaged app build, and installed macOS acceptance. Keep the minimum supported macOS version from the desktop foundation (currently 14). Do not claim Windows overlay support in this release; preserve Windows compilation.

Release order: integrate foundation → migrate/deploy API additively → verify authenticated hosted capability → build/install desktop → run acceptance with Cooper's configured rituals. User outcome is an installed usable feature, not merely passing web tests. Same-day delivery is a target, not a guarantee.

## 11. Scope boundaries

Deferred: full Tracking workspace, streaks/charts/goals, numeric trackers, standalone Journal integration, arbitrary ritual types, agent-generated steps, medication advice, SMS/push escalation, Windows native overlays, and OS-enforced blocking. No finance or task-ledger refactor is necessary.

The companion implementation plan and Linear parent/sub-issues own execution status. These documents describe intended behavior, not delivered capability.

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

### Ritual presentation refinement

The small centered nohmi logo sits above the rounded card. The card has no visible icon or title. Form fields are start-aligned; progress, save status, snooze confirmation, and other supporting content are centered. Snooze and Skip are text buttons below the card. The checklist scrolls within the available screen height while its completion footer remains visible. The entrance fades and lifts over 600 ms, respecting reduced-motion preferences.

### Settings and response types refinement

Use Morning and Evening in product copy; retain the stored `night` identifier for compatibility. Settings use the Reviews single-select segmented control, a responsive card grid, autosaving schedule and checklist editors, device controls, and history. Each ritual has an interactive preview isolated from account answers and action history. Steps support checkbox, short entry, time (HH:mm), date (YYYY-MM-DD), finite number, and single-answer multiple choice (2–12 distinct options). Non-checkbox responses retain their string representation for export and offline compatibility; submitted values are validated against the immutable step definition. All six types participate in explicit completion gating online and offline.

### Settings organization and replay refinement

Morning, Evening, and History and data share the top segmented navigation. Checklist steps use secondary shadcn Items with pointer drag handles and arrow-key reordering. This Mac combines device enable/pause controls and one Show ritual action for the selected ritual. Show ritual opens the native full-screen presentation, even after completion, with matching answers from today when available. Replay edits remain in memory and never create occurrences, responses, or escape events. Close preview and Escape dismiss the replay. Browser previews fill the viewport.
