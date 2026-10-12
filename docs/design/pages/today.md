# Today — reference page specification

## User job

Help me orient to today, see the work I owe this calendar week, and reach the next decision.
Today is a composition surface; Calendar, Tasks, Mail and Finances retain domain authority.
The accepted [refinement spec](../../superpowers/specs/2026-10-12-today-refinements-design.md)
and [implementation plan](../../superpowers/plans/2026-10-12-today-refinements.md) describe the
2026-10-12 scope. This document describes the branch implementation, not a production release.

## Hierarchy and boundaries

The app frame holds the planning date, weather, location and capture. Always reserve weather
and location control geometry, including loading and unavailable states. Resolve their data
independently; never add a transient conditions row to the body.

Needs your attention precedes two separate, flat cards: Your timeline and To take care of.
Show account recovery and workspace review totals regardless of optional-card preferences.
Group reviews by their owning workspace and open its existing review flow; never approve from
Today. If an attention source fails, retain available evidence and disclose incomplete checks.
Automatic provider retries are not reconnect demands. Poll visible attention sources each minute.

| Card | Scope | Interaction |
| --- | --- | --- |
| Your timeline | Today's all-day occasions, remaining events and task reservations, reminders at their actual due time | Existing event quick actions and material editors; reminders are point markers, not invented appointments |
| Due today within timeline | Open tasks due today without a remaining reservation, plus earlier uncompleted reminders due today | Compact titles/timing and existing completion/editor actions |
| To take care of | Open tasks/reminders due or reserved in the configured calendar week, plus all overdue deadlines | Remembered All/Overdue/Tasks/Reminders filters with full counts, six-row pages, and Overdue/Today/Later this week/optional Undated groups |
| Done today | Completed tasks/reminders from today | Standard Collapsible, closed initially |
| Spending, optional | Posted spending through today, week or month, using Finance's account selection | Shared saved period selector and Finance link; unavailable is never zero |
| Current ritual, optional | Existing current occurrence | Native ritual overlay on desktop; shared checklist dialog on web |
| Desktop pet, optional | Only desktop with pet enabled | Existing pet quick-access command, with Sonner feedback |

Use the account planning timezone and Calendar's saved Sunday/Monday week boundary. A past
reservation is carry-forward work within the current week, not an overdue deadline. Exclude
completed, trashed and non-open tasks. Truly undated work is opt-in; do not treat old reservations
as undated. The weekly endpoint reads owner-scoped material and full counts independently of the
bounded daily brief. Cursors bind account, permissions, local day/week, timezone and filters and
expire after fifteen minutes; Refresh starts a fresh page sequence.

All-day dates are inclusive-start/exclusive-end source calendar dates. Google DATE and iCloud DATE
values normalize at source-zone midnight. Google legacy rows with provable raw source dates are
repaired on read; uncertain rows are not shifted heuristically. Timed events intersect today's
planning-zone interval. The live clock rolls at midnight and refreshes on focus/visibility changes.

## Personalization and map contract

Personalize Today opens `/today/settings`. A separate typed, revisioned Today preferences object
stores Default/Weather/Map background, optional cards, spending period, filter and undated choice.
It does not extend the four-domain workspace enum. All controls use the shared serialized save
channel and exact-revision recovery. Background autosave success is silent; errors use Sonner,
with retained attempted values and explicit review/reapply in settings.

Default uses normal theme surfaces. Weather reuses semantic sky tokens and condition treatment;
its narrowly scoped gradient is an approved decorative-background exception. Foreground cards
remain opaque. Map uses an adapted MIT MapCN component with pinned MapLibre 6.14.0, reicon controls
and a same-origin module worker/shared module pair. Preview is interactive with a location marker;
background is inert without a precise marker. Attribution remains visible and keyboard accessible.
The explicit Open map link opens OpenStreetMap; the location trigger itself opens the preview.

Missing key/location, WebGL failure, denied resource, network failure or a ten-second timeout
leaves a quiet fallback and retains the saved preference. Maps are lazy, remove instances/workers
on unmount and never cache authenticated provider responses as offline tiles. Public CARTO keys
attach only to the exact HTTPS style/tile/glyph/sprite hosts in the map provider allowlist. Never
send task/event data or log keys/precise coordinates. See the external-boundary reliability contract.

## State and responsive rules

- Independent cards survive timeline, completed-history, weather or provider failures.
- Keep cached material on refresh failure. Show source uncertainty beside the affected content;
  manual refresh and native action outcomes use one Sonner toast.
- Desktop places timeline and weekly queue side by side. Mobile stacks them with no horizontal
  page overflow; urgent attention precedes both. Optional cards follow the main work.
- Long titles truncate visually with full accessible names and existing detail access.
- All-day occasions use the shared OccasionCard. Timed material uses the shared timeline and
  EventCard. Existing overlap and action-menu behavior remains owned by Calendar.
- Today has no contextual sidebar. Reminders belongs to Tasks. Goals, Motives and Activity stay
  in Settings. Follow the shared icon, feedback, theme and navigation contracts.

## Verification

Domain/provider tests cover source-date membership, DST and calendar-week boundaries. API tests
cover ownership, strict preferences, revisions/audit, permissions, mixed material, counts and
cursor tampering. UI tests cover saved choices, queued saves, source uncertainty and native
feedback. Desktop/mobile E2E exercises settings persistence, weekly filters, independent failure
states and responsive overflow. Live fixture QA verifies rendered CARTO tiles and layout;
packaged native WebGL and deployment-origin key restrictions need separate release evidence.
