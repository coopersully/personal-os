# Today at a Glance refinements

Status: design for review; no product implementation is claimed.
Date: 2026-10-12. Source baseline: `f918b63a`.

## Purpose and agreed scope

Make today’s schedule, this calendar week’s outstanding commitments, and actionable account or
workspace problems understandable at a glance. Preserve a calm, stable page while adding optional
personality and useful summaries. The user requested this spec and its companion plan together,
followed by an assumption/refinement pass, before implementation.

Included: two main cards; correct calendar dates; reminders on the timeline; stable weather/location
controls; MapCN location preview; Default/Weather/Map backgrounds; independent Today preferences;
prominent account and review attention; desktop pet access; optional spending and ritual cards;
counted remembered filters; date grouping; and a Customize Today entry.

The user explicitly chose Calendar’s configured week boundaries, not a rolling seven-day window.
Quick rescheduling, extra meeting actions, earlier-today disclosure, pet-position reset controls,
drag-and-drop card ordering, arbitrary date windows, and a general dashboard builder are deferred.
Existing event actions and completion/reopen behavior remain available.

## Layout and interaction

Desktop composition, in reading order:

```text
Date / Today at a Glance       [Weather] [Location] [Customize Today]
Needs attention: actionable account problems and workspace review entries
┌ Your timeline · Today ──────────┐ ┌ To take care of · This week ───┐
│ Events, tasks, and reminders    │ │ Explicit calendar date range  │
│ All-day occasions / due today   │ │ All | Overdue | Tasks | Reminders
│ Remaining timed schedule       │ │ Overdue / Today / Later this week
│                                │ │ Optional Undated / Done today│
└────────────────────────────────┘ └───────────────────────────────┘
Optional supporting cards: Spending · Ritual · Desktop pet
```

Use standard shadcn Card surfaces and shared typography, radius, spacing, borders and reicon glyphs.
The main cards align at the top; do not stretch short content to match a long timeline. At narrow
widths the order is attention, timeline, commitments, then optional cards. No horizontal scrolling
or hidden urgent content. The weekly list remains height-bounded and paginated. Card headings and
controls remain outside its scrolling region. Group headings repeat when a group crosses a page.

The timeline subtitle reads “Events, tasks, and reminders”; its count uses “items,” not “events”
when mixed. The queue subtitle includes “Tasks and reminders” and the inclusive displayed week range.
Filter counts describe the full selected weekly dataset, not just the current page; All includes
undated items only when that preference is on. Changing filters resets pagination, preserves focus,
and saves the selected filter. Completing the last item on a page clamps the page index.

## Time and material contract

All Today boundaries use `user.planningTimezone`; week start follows Calendar’s saved `weekStartsOn`
(existing default Sunday). Do not add a second week-start setting. Calculate the next local midnight
and week boundary through timezone-aware local dates, never by adding 24-hour milliseconds. Refresh
on midnight, focus/resume, timezone or week-start changes; use a live clock rather than an indefinitely
cached brief timestamp. Do not clear usable data while refreshing.

| Material | Timeline today | Weekly queue |
| --- | --- | --- |
| Timed event | In-progress or upcoming intervals intersecting today; clip drawing to today | Never |
| All-day occasion | Source calendar dates include today; end date is exclusive | Never |
| Open scheduled task | Remaining reserved interval intersecting today | Due or scheduled this week, or overdue |
| Open task due today, without a remaining reservation today | Compact “Due today” area; no invented appointment duration | Due date and grouping below |
| Open reminder with `dueAt` today | Point marker at its actual time; earlier uncompleted reminders in “Due today” area | Due this week or overdue |
| Undated material | Never assigned an invented time | Optional explicit Undated group |

Task selection is a union of due-date relevance and reserved-time relevance, deduplicated by native
ID. Exclude non-open, deleted and completed tasks and completed reminders. Group overdue due dates
first; then today; then later this week, ordered by relevant timestamp and stable ID. A task reserved
earlier this week but still open belongs in Today as carry-forward work, labeled with its actual
earlier reservation; a past reservation alone does not invent an overdue deadline. An overdue task
reserved later this week stays in Overdue and retains its reservation metadata. Undated means no due
date and no reservation. Overdue includes all outstanding earlier due timestamps, including earlier
today. On the timeline a task appears once: a remaining reservation takes precedence over a separate
due marker. The same task can intentionally appear in both main cards, with shared mutation state.

The current reminder schema has a nullable timestamp, not a separate date-only flag. Treat a present
timestamp as timed, including midnight; do not infer “date-only” from midnight. A reminder point may
use visual minimum height but must not claim that it consumes a calendar block. Keep exact times
accessible and allow collision layout with events/tasks. Existing task duration rules remain intact.

### Calendar defect and repair boundary

Observed in source: `google.ts` normalizes `start.date`/`end.date` to UTC midnight but preserves a
calendar timezone. `calendar-service.ts` selects by timestamp overlap; the brief forwards all-day
matches without a date guard. For October 12 at UTC midnight, an America/New_York October 11 query
can overlap the holiday. This establishes a reproducible mechanism, not verification of the user's
particular production record.

Correct the calendar-owned normalization/selection contract, not just the visual card. Source date
values and exclusive end dates are authoritative. Normalize date-only provider values consistently
with the event timezone and compare their calendar dates for Today membership. Audit Google, iCloud,
local events, recurring instances and all-day editing together. Existing Google records must be
repaired idempotently using trusted stored provider date fields (where available) or an authoritative
resync; never shift all midnight events heuristically. Records without recoverable source dates are
an explicit repair gap, not guessed dates. No provider mutation is needed to repair a local mirror.

A Today projection may fetch a padded event candidate range (two local days each side), then apply
exact source-date membership for all-day items and instant overlap for timed items. Padding alone
is not the fix. Keep Calendar and native consumers consistent with normalization; ensure recurring
events and repaired records still use existing source identity and revision rules.

## Stable asynchronous UX rule

Keep each component’s identity, placement, and allocated space while its data loads or refreshes.
Initial loading uses an in-place skeleton or busy state; refresh retains the last usable value with
an accessible refreshing/stale indication. Never insert a temporary body row for header-owned data,
replace a usable page with a spinner, or change focus because a request completed. Real data changes
can change content size; this rule prevents transient status UI from doing so.

Weather and location buttons exist immediately, with bounded widths and matching heights/surfaces.
They load independently: a known location remains useful when weather fails. Their popovers explain
unavailable state, saved-location fallback and permission recovery. Permission requests happen on
explicit interaction, not because a decorative background was enabled. Refresh/action outcomes use
one Sonner toast; successful background saves stay silent. Persistent account problems belong in
Needs attention; they are not action-result banners.

Reserve a compact attention status region above the cards. It shows a stable checking state on first
load, “All clear” only after all relevant sources are checked, or persistent unknown/attention state.
This avoids a disappearing loading row. Pending data is never interpreted as zero problems. Actual
new problems may expand the region. Optional enabled cards retain their frames through refresh.

## Today personalization

One canonical editor at `/today/settings`, opened by Customize Today; use the existing settings
section and save/recovery patterns. Central Settings may link to it but does not duplicate the form.
Today stays a composition surface, not a fifth domain workspace. Do not expand `workspaceSchema`,
agent scopes, stewardship domains or the four-workspace model just to store presentation preferences.

Proposed typed preferences and defaults:

| Field | Values | Default |
| --- | --- | --- |
| `background` | `default`, `weather`, `map` | `default` |
| `showSpending` | boolean | false |
| `showRitual` | boolean | false |
| `showPet` | boolean | true; effective only on desktop with pet enabled |
| `spendingWindow` | `week`, `month` | `week` |
| `commitmentFilter` | `all`, `overdue`, `tasks`, `reminders` | `all` |
| `includeUndated` | boolean | false |

Timeline, weekly queue, weather/location controls and attention visibility are fixed. Overdue work
cannot be globally hidden by personalization; a selected Tasks/Reminders filter can narrow the list
but counts make other work discoverable. Pet quick-access settings remain independent.

Add `TodayPreferences`, `TodaySettings { revision, preferences }` and
`UpdateTodaySettings { expectedRevision, preferences: Partial<TodayPreferences> }` with strict schemas.
Use a dedicated `today_settings` table keyed by user, with typed fields, positive stored revision and
updated timestamp. GET `/v1/today/settings` returns defaults at revision 0 without writing. PATCH
requires an authenticated interactive account owner; agents cannot acquire new authority through
this route. Serialize per-user writes and audit in the same transaction. Reject stale revisions.
Do not silently retry with a newer revision. Read endpoints use the same owner/session boundary.
Typed MCP parity is a separately scoped follow-up, not an implicit scope expansion in this change.

UI saves retain unresolved edits, surface errors through Sonner and provide the existing explicit
reload/reapply recovery pattern. Account/session changes clear drafts and fence late callbacks.
The week/month selector and filter control share the same serialized Today save channel as settings.

## Backgrounds and MapCN decision

Default uses the current neutral page treatment. Weather reuses the existing condition/day-night
visual vocabulary as a page background without moving content. Map uses the resolved weather-location
source (authorized device location, otherwise explicitly labeled saved home location), a neighborhood
view, no precise pin in the decorative background, and no gestures or focusable map controls behind
cards. The location popover has an interactive map and a marker. Keep attribution links visible and
usable even when the decorative canvas is noninteractive. Card contrast must survive both themes.

Use MapCN as vendored React composition over MapLibre GL JS, lazy-loaded only for map background or
an opened location popover. Reuse one product wrapper for both modes. Download and adapt the registry
source during implementation; preserve upstream license/provenance. Import only needed map, marker
and control primitives. Replace its Lucide imports with the central reicon registry; do not add
`lucide-react`. No new animation library: use existing CSS/motion support and reduced-motion behavior.

Research on 2026-10-12 found the current registry requests `maplibre-gl@^6`, whose module worker and
shared module should be emitted together as versioned same-origin build assets. Pin a tested exact
6.x release in the lockfile at implementation; do not assume older v5 worker examples apply. Use the
installed shadcn tooling/source workflow rather than an unreviewed latest install over existing UI.
Desktop currently has `script-src 'self'`; the upstream unpkg worker is incompatible with that policy.
Keep script loading same-origin and set the narrow worker/resource policy proven necessary by the
packaged desktop smoke test. No wildcard script allowance.

MapCN's documented default styles are CARTO Positron/Dark Matter. CARTO's current provider docs require
a project key on styles, tiles, glyphs and sprites, plus visible CARTO/OpenStreetMap attribution.
Use CARTO conditionally on provisioning that key and confirming its project quota/restrictions.
Do not treat “free” in MapCN documentation as production service authorization. No paid subscription
or provider account is created by this documentation work. Use a public client map key configured
for this project, never an administrative credential; send it only to approved CARTO resource hosts.

If no key, location, WebGL2, worker or network is available, retain Default in the same footprint and
explain the map fallback in its settings/location surface. The saved Map preference is retained.
Do not load demo tiles as a production fallback. Keep map configuration and resource allowlists in
one module; deployment/build configuration must supply the same values to browser and desktop.

### External boundary record

| Concern | Decision / required evidence |
| --- | --- |
| Owner/capability | Web map wrapper fetches display resources; existing location/weather owners acquire coordinates/conditions |
| Authority | Existing location permission; project CARTO key and service allowance; no new location permission prompt on page load |
| Transport | Client HTTPS 443 to exact style/tile/glyph/sprite hosts discovered from configured styles; local worker/shared module; verify packaged Tauri CSP |
| Time/capacity | 10-second initial map readiness budget; destroy failed instance and show fallback; explicit retry, no application retry loop; at most two live maps; destroy on unmount |
| Commit/lifecycle | Only preference saves are durable; map loading is cancellable display work; no background job or location tracking is introduced |
| Privacy | Tiles disclose viewed area to provider; no user identity, task/event data or raw coordinates in diagnostic logs; do not persist precise device location in Today preferences |
| Recovery | Keep last usable weather/location, stable map fallback; an explicit retry starts a new bounded attempt |
| Observation | Redacted map-ready/failed category and duration; do not log keyed URLs; resource/key quotas observed in provider tooling |
| Verification | Deterministic timeout/denial tests plus actual browser and packaged-desktop map rendering, attribution, zoom, theme switch and cleanup |

Green mocks can still miss WebGL2 support, OS webview worker restrictions, bad asset paths, provider
key restrictions, changed style subresources, rate limits and attribution obstruction. Real runtime
smokes are a map release gate, not evidence already obtained in this document.

## Needs attention

Compose existing owner-authorized work-item/review projections and connector health. Use canonical
source IDs to deduplicate one failure that appears as both connector health and an attention item.
Show actionable connection failures first, then outstanding workspace decisions, with account/
workspace name, concise problem, count where authoritative, and one specific recovery action.
Do not promote normal syncing or automatically recovering transient errors into review noise.

Calendar/Mail/iCloud/Google account failures and Finance connection failures must all be covered;
inventory other connected-account types exposed by the application before calling coverage complete.
Use existing provider failure disposition to distinguish user repair from automatic recovery.
Review buttons navigate to the owning workspace with `?review=open` or an encoded item ID. Do not
reuse the obsolete `ReviewsEntry` link to `/reviews`, which currently redirects to Settings.
Do not add approval actions directly to Today or bypass workspace review authority.

Each source has independent loading/fresh/error state. An unavailable source remains “Couldn’t check”
with retry/navigation; healthy siblings remain visible. Counts never claim global completeness when
sources fail or return partial results. Respect summary metadata and cursors; never count just the
first page. Refresh on return from recovery/review and existing query invalidations, with a bounded
60-second polling interval only while Today is visible. Connection failures remain discoverable
even when optional cards are off. No duplicate transient toast on every background poll.

## Supporting cards

**Spending:** opt-in; default This week with This month alternative. Show posted spending through
today from `getFinancePosition`, respecting Finance saved spending-account selection (`null` means
all eligible, `[]` means none). Reuse Finance evidence formatting and its verified/qualified/
unavailable semantics; missing data is not zero. Do not introduce scheduled outflow forecasts or
currency conversion. The period starts at the same configured calendar week boundary or local month
start. A View Finances link opens the owning workspace. Query only when enabled and authorized.

**Ritual:** opt-in; reuse `RitualState` and the relevant current occurrence. Show morning/evening title,
Start/Resume when pending and actionable, and honest completed/skipped/none/stale/sync state inside
the stable card. Desktop uses the existing local-aware ritual bridge and open command; browser uses
the existing `RitualChecklist` in a dialog, with native readiness calls kept desktop-only. Do not
silently call the current browser `openCurrentRitual` no-op. Preserve occurrence identity, saved
responses, native pending sync and existing dismissal behavior; no new schedule or ritual is created.

**Pet:** visible only when showPet is on, a desktop runtime is present and the pet is enabled.
Display current appearance via the existing preview approach and an Open quick access button using
`nativeAction("quick_access")`. This is supported today; do not promise a new Show pet native command.
Use a link to existing pet settings for appearance. Browser never renders dead native controls.

## Acceptance and review boundaries

Required evidence: calendar date/DST/provider regressions; exact week selection, deduplication and
counts; settings owner/revision/recovery tests; independent card failure tests; Sonner and absence
of inline action-result tests; desktop/browser action routing; map failure and real rendering checks;
keyboard and narrow-layout verification; dark/light/reduced-motion variants; deterministic `pnpm verify`
before a PR, following delivery-verification policy when shipping.

The plan sequences calendar correctness, preferences, page composition, attention, supporting cards,
maps, and integrated verification as independently testable deliverables. No production changes,
dependency installation or provider provisioning have been performed for this spec.

## Refinement evidence and remaining release gates

| Assumption challenged | Finding and correction |
| --- | --- |
| Weekly reminders already exist in the brief | The brief only exposes overdue/today/anytime; add a bounded weekly projection rather than filtering that incomplete dataset |
| Pet filters can be reused directly | Rust pet projection is due-date based, limited to 100, and has independent windows; reuse concepts, not its incomplete Today selection |
| All midnight reminders are date-only | Schema has no such distinction; retain real timestamp semantics |
| Today is another workspace | Workspace enum has four authority domains; separate typed presentation store |
| MapCN can be installed unchanged | Registry includes Lucide, unpkg worker and v6; adapt icons, bundle worker pair and test WebGL2 |
| Default tiles need no setup | Current CARTO docs require a key and attribution; provision before map release |
| Ritual launch is cross-platform already | Browser bridge returns a no-op; explicitly compose existing checklist in a web dialog |
| A cross-workspace Reviews component is usable | Existing `/reviews` redirects; route attention into workspace-scoped review flows |
| Pet access needs a new command | Existing `quick_access` native action is available |

Open release gates, not unspecified product choices: provision/restrict the CARTO project key;
validate the exact locked MapLibre build in the packaged desktop runtime; confirm legacy all-day
repair against representative stored source formats; prove connector-source coverage in fixtures.
These do not block reviewing the design. They block declaring the corresponding implementation done.

Additional checks performed during refinement:

- A timezone-aware calculation reproduced the October 12 UTC-midnight holiday overlapping both
  October 11 and 12 in America/New_York. Source-date membership selected October 12 alone. This is
  a behavioral probe of the observed algorithm, not an API integration or production-data test.
- Downloaded and inspected the live MapCN registry without installing it. Registry SHA-256:
  `1817e5f387d49de7b0ae1ec6c00e8e33583f4276fe7e72eaf1f10cfef43b59eb`.
  It declares MapLibre 6 and Lucide; the source contains the unpkg worker and CARTO theme styles.
- Inspected npm metadata and the MapLibre **6.14.0** distribution archive: ESM, BSD-3-Clause, and
  the worker, shared module, main module and CSS files are present. Use 6.14.0 as the initial
  implementation candidate, subject to actual Vite and packaged-desktop verification. The upstream
  [MapCN repository](https://github.com/AnmolSaini16/mapcn) identifies its source as MIT licensed.
- The provider's current key page and MapCN's repository contain differing service descriptions;
  use CARTO's live provider terms/configuration, not MapCN marketing, as the deployment authority.

Research: [MapCN installation](https://www.mapcn.dev/docs/installation),
[MapCN registry](https://www.mapcn.dev/r/map.json),
[MapCN API](https://www.mapcn.dev/docs/api-reference),
[MapLibre v6 migration](https://maplibre.org/maplibre-gl-js/docs/guides/v5-to-v6-migration-guide/),
[CARTO key setup](https://carto.com/basemaps/apikey/),
[CARTO attribution](https://carto.com/attribution/index.html).
