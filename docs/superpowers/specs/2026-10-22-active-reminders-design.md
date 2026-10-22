# Active reminders design

Status: approved by Cooper on 2026-10-22 for inline implementation, including the recommended
first-release scope, defaults, activity threshold, and safety fallback. See the native evidence
record for observations and remaining release certification limits. This specification is not
a claim that the branch is deployed.

## Intent and approved behavior

An active reminder is a decorative, actionable nohmi card that remains on the Mac desktop until
its underlying item is completed. It appears centrally, stays above ordinary windows, and can be
dragged out of the way. The setting belongs to the item, with a configurable default for new items.
When the person is away, deliver the normal system notification. On return, show the card if the
item is still incomplete. Opening a card or dismissing its system notification is not completion.

## Approved first release

- Support timed reminders and tasks on macOS 14+, using the existing Swift/AppKit companion and
  Rust/Tauri host. Calendar, mail, finance notifications, Windows cards, and mobile cards are
  deferred: those sources need explicit acknowledgement and expiry semantics.
- Use the public field `activeReminder: boolean`; do not use `active`, which already means an
  incomplete/non-cancelled item in native models.
- Store a resolved boolean on each item. Existing items remain false. The account preference
  `defaultActiveReminder` starts false and affects only future creation when the field is omitted.
  An explicit false always overrides a true default. Changing the default never rewrites items.
- Sync the item flag and creation default through the API, including browser and agent creation.
  A separate device preference, `activeRemindersEnabled`, defaults true and pauses card
  presentation on that Mac without changing item flags or normal system delivery.
- Items without a due time may retain the flag but cannot produce a card until timed.
- Cards persist through focus changes and normal process restarts. Completion elsewhere,
  cancellation, deletion, removing the due date, moving the due date into the future, or disabling
  the item's flag retires the current card after authoritative reconciliation.

## Current implementation and constraints

`packages/database/src/schema.ts` stores tasks and reminders in the shared `reminders` table.
`packages/domain/src/task.ts` and `reminder.ts` own their public contracts; `apps/api/src/task-service.ts`
and `reminder-service.ts` own mutations and audit behavior. Reminder editing currently lives in
`apps/web/src/app.tsx`; task editing is domain-owned in `features/tasks/task-dialog.tsx`.

`apps/desktop/src-tauri/src/coordinator.rs` projects the daily brief and upcoming reminders into
`NativeSnapshot`. `Models.swift` plans notification occurrences, including aggregated overdue
catch-up. `Notifications.swift` schedules UNUserNotificationCenter requests and maintains a ledger.
`PetScene.swift` provides reusable patterns for floating windows, display changes, and sleep/session
observation. The pet's bounded snapshot is not an authoritative inventory of outstanding reminders.
`lifecycle.rs` and `pet.rs` already complete native items, but their action payloads are not a
revision-bound active-card acknowledgement protocol.

The API's shared notification policy currently has its own global/finance preference contract.
Native task/reminder scheduling currently uses local `NotificationPreferences` and `AlertPlanner`.
This release preserves those existing boundaries; it does not claim that they are already one
implemented policy engine or introduce a competing notification-eligibility rule for finance/SMS.

## Persistence and API

Add `reminders.active_reminder boolean NOT NULL DEFAULT false` and an owner-keyed
`active_reminder_preferences` table with `user_id`, `default_active_reminder`, `revision`, and
timestamps. Use an additive migration at the next available migration number and keep journal,
schema, and migration tests aligned. Keep existing notification-preference JSON constraints intact.

Extend task/reminder create, update, response, serialization, audit, and typed-client contracts.
Create input has an optional flag with no schema-level false default: the owning service resolves
omission against the account preference transactionally. Update omission preserves the stored flag.
Task idempotency fingerprints preserve the caller's omitted/explicit intent; replay returns the
original item even after the account default changes. Existing task revision and reminder
`expectedUpdatedAt` concurrency rules apply to flag changes and completion.

Add session-authenticated endpoints:

- `GET /v1/active-reminders/preferences` → `{ defaultActiveReminder, revision }`, with absent-row
  response `{ defaultActiveReminder: false, revision: 0 }`.
- `PATCH /v1/active-reminders/preferences` with `{ defaultActiveReminder, expectedRevision }` →
  saved preference. First insert uses expected revision 0; stale saves return the normal conflict.
  Browser preference reads/writes may bind an expected owner with `X-Nohmi-Account`; a mismatch
  fails closed before reading or saving another signed-in account’s preference.
- `GET /v1/desktop/active-reminders?cursor=...&limit=100` →
  `{ generatedAt, items: ActiveReminderCandidate[], nextCursor }`.

`ActiveReminderCandidate` contains `kind: "task" | "reminder"`, `id`, `title`, `dueAt`,
`activeReminder: true`, and a discriminated concurrency token: task `revision` or reminder
`updatedAt`. The server owns destinations derived from kind/id; arbitrary URLs are not accepted.
Only return the authenticated owner's incomplete, non-deleted, non-cancelled opted-in items with
a due time up to 24 hours ahead. Include all overdue ages through pagination, independently of
daily-brief truncation, system queue budgets, pet workspace selections, and pet enablement.
Order by immutable `(kind, id)`; bind cursors to the owner and fixed query cutoff. A page failure
never becomes an empty authoritative inventory. Existing domain/MCP authorization remains intact;
these new preference/feed endpoints require a user session, with no new agent permissions.

## Activity and lifecycle

`MacActivityMonitor` observes display/session sleep and wake and samples elapsed time since input.
The proposed activity threshold is 120 seconds, including keyboard, mouse, scrolling, and dragging.
Activity requires an awake display and an active, unlocked user session. Unknown state is away.
Use elapsed-input metadata only; do not capture keys, pointer traces, screenshots, or app usage.
Verify the selected public APIs on supported Macs without adding Accessibility/Input Monitoring
permission requirements; if that cannot be established, fall back to system notifications and
report the capability unavailable. Sleep and session activation signals alone are insufficient
proof of unlocked state: the native probe must verify the complete predicate.

While active, refresh candidates at most every 15 seconds; immediately refresh on return, launch,
authentication change, relevant settings changes, and completion. A new card requires a successful
revalidation no older than 15 seconds. Existing cards can remain in a clearly stale/retry state
offline, but cannot falsely announce successful completion. Do not resurrect cached cards before
an authenticated refresh after relaunch. Account/server changes immediately hide cards, invalidate
callbacks, clear the previous account's local card state, and discard late responses.

Cards hide on lock/display sleep and return after unlock, input, and successful reconciliation.
Idle alone does not dismiss an already-visible card; an active card is persistent, not a transient
banner. Closing the main window keeps the companion running. Explicit Quit stops it; launch and
wake recovery reconstruct due incomplete cards from the API. No process survives explicit Quit.

## Delivery ownership and safety fallback

Use the same stable occurrence identity `(server, account, kind, id, dueAt)` as native scheduling.
Do not rely exclusively on `willPresent`: Apple's delegate contract is for foreground arrivals,
whereas the Mac may be active in another app.

Recommended strategy, subject to the first native acceptance probe:

1. Keep the normal OS request scheduled at its eligible fire time while away, unavailable, paused,
   stale, or outside the shared native notification settings. Preserve existing catch-up semantics.
2. For an opted-in occurrence due while active, a native timer prepares delivery two seconds before
   the eligible fire time. Only with fresh eligible material, confirmed activity, and a ready card
   presenter, replace that occurrence's OS request with a safety fallback five seconds after its
   eligible fire time. Confirm replacement acceptance before claiming card delivery.
3. At the eligible fire time, recheck activity, identity, quiet hours, eligibility, and freshness.
   Present the card, persist its receipt atomically, then cancel the fallback. If preparation,
   presentation, or persistence fails, retain the fallback. If the person became away, restore
   delivery immediately when the eligible fire time arrives, with the five-second fallback retained
   until that immediate request is accepted. A crash during the claim interval leaves the fallback.
4. When returning after away delivery, revalidate the incomplete item and show its card. Do not
   reschedule another system banner for that same occurrence just because a card appears.
5. Late arrivals, already-overdue items, and recovery use the same occurrence identity. They do not
   create a second normal banner in addition to existing catch-up delivery.

The five-second fallback grace is a proposed reliability tradeoff, not a silent timing guarantee.
OS cancellation and native drawing cannot form one atomic transaction: a rare duplicate during
a crash/cancellation race is preferable to a lost reminder. Do not claim exactly-once delivery.
The existing scheduling reconciliation must preserve an in-flight takeover instead of replacing
its fallback with the original fire time or resubmitting a cancelled occurrence. Account-generation
invalidation, disabling the flag, and changing the due time revoke that claim. Re-enabling the
flag after an earlier normal delivery still permits a card for an incomplete due item, without
creating a second normal banner.
If the native probe cannot demonstrate safe replacement/cancellation and background operation,
stop before shipping routing; retain normal OS delivery and revise this strategy with evidence.

Native enabled/source toggles, notification permission, privacy-preview rules, and quiet hours
continue to gate new cards. Already-visible cards remain during quiet hours, but hidden cards
are not newly revealed until quiet hours end. Custom panels do not automatically inherit macOS
Focus suppression; disclose this in the setting and provide the device pause control. Do not
claim Focus awareness without a supported, verified integration.

## Card interaction and appearance

Use a focused native `NSPanel`/SwiftUI presenter, following nohmi's existing card palette,
typography, radius, border, and elevation. Solid readable content takes priority over translucency.
Decorative means theme, subtle entrance, and polished placement; no perpetual animation or pet
dependency. Honor reduced motion, increased contrast, reduced transparency, and keyboard access.

Presentation revised by Cooper on 2026-10-22: show each pending task/reminder in its own compact
native window, matching the app's shared completion-checkbox, title and due-metadata rows. Keep
all pending items visible without pagination or decorative stacked layers. New cards use unoccupied
screen space; completion reclaims that area without moving siblings. On a full screen retain every
window with reachable drag handles, rather than introducing a hidden queue.

Each card starts at 320 × 88 points and can be moved and resized independently down to 240 × 72.
Use native resize edges and a visible corner grip. Snap within 24 points of a visible-frame edge.
Persist normalized position and size per account, item and display UUID, and restore to that display
when available. Fit to usable bounds on monitor/resolution changes. Stay above ordinary app windows
and available across Spaces without activating nohmi or stealing typing focus. Preview-off titles
remain hidden. Pending/error/completion state belongs to the originating card.

Active-item system notifications expose Open and Complete. No card close, dismiss, or snooze action in this first release: the requested promise is persistence
until completion. Opening the item leaves the card present. Device pause is the explicit escape
hatch. Mark complete shows pending, disables duplicate submits, and removes the card only after
the server confirms completion. On failure, retain the card with **Try again**; a revision conflict
refreshes the item and requires a new click against the new revision. Completion on another client
retires the card within the next successful reconciliation cycle.

## State ownership and boundaries

- API/domain/database own item identity, flag/default, eligibility facts, completion, concurrency,
  and audit. Do not create duplicate tasks or a generic new notification object model.
- Rust owns authenticated feed retrieval, paging, account-generation fencing, and API actions.
  A separate active-reminders coordinator avoids enlarging the daily-brief coordinator.
- Swift owns activity, native timing/routing, card presentation/placement, and an atomic local
  occurrence receipt store. Store minimal IDs, timestamps, and placement; titles come from the
  current authenticated feed. Surface storage failures instead of claiming durable delivery.
- Completion actions carry occurrence identity, request ID, and the source concurrency token.
  Return an explicit action result to the card; do not treat a fire-and-forget callback as success.
- Maintain one item/occurrence identity across card and system delivery. Source and account changes
  invalidate queued native timers, network responses, and action results before presentation.

## Verification and rollout

Begin with a native probe covering foreground, another foreground app, closed main window,
lock/unlock, display sleep, full-screen/Spaces, process death during fallback, and permission
states. Keep the feature disabled until this boundary has runtime evidence.

Then cover migration preservation, defaults/overrides/idempotency, owner isolation, API conflicts,
paging beyond the pet cap, stale/failed feeds, old native snapshot decoding, quiet hours/DST,
activity boundaries, receipt failures/relaunch, revision-bound completion, and display geometry
with deterministic clocks and adapters. Test creation/editing/default controls on web and desktop.
Run Rust and Swift tests as well as `pnpm verify`; browser E2E alone cannot verify native behavior.
Use local fixtures, not production mutations. Record runtime smoke evidence separately from mocks.

Roll out additive schema/API changes before clients that send the new fields. Older clients may
omit create/update flags without changing existing items. Older native decoders must tolerate
the additive response field. Rollback disables card presentation and restores ordinary scheduling;
it preserves item flags/defaults in storage. Do not drop columns as an operational rollback.

## Sources

- Current product contract: `docs/product/master-design.md`, section 6.10.
- Boundaries: `docs/architecture/0001-system-shape.md`,
  `docs/engineering/external-boundary-reliability.md`, `docs/engineering/feature-ownership.md`.
- Apple: [foreground notification delegate](https://developer.apple.com/documentation/usernotifications/unusernotificationcenterdelegate/usernotificationcenter%28_%3Awillpresent%3Awithcompletionhandler%3A%29),
  [event source elapsed-input API](https://developer.apple.com/documentation/coregraphics/cgeventsource).
  API availability is not proof of runtime activity permission or background delivery behavior;
  the native probe is required evidence.
