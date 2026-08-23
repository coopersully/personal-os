# Calendar

## Immediate job

See when commitments occur across the selected calendars, then open or place an
event without losing the shape of the day.

## Composition

- Calendar is the one full-screen workspace and does not render the contextual
  or mobile workspace sidebar. Date jumping and calendar visibility stay
  available in Calendar-owned controls instead of consuming grid width.
- Calendar composes the shared secondary app bar in every view. The day bar
  owns all-day material, the week bar owns weekday/date controls and all-day
  material, and the month bar owns weekday wayfinding.
- The week secondary bar expands only for real all-day material and meets the
  timeline without a decorative divider.
- The persistent Calendar orientation occupies the shared workspace app bar's
  `identity` slot beside the workspace switcher, with Today and the view
  selector in `context`. The primary bar remains one vertically centred 52 px
  row: its controls share one optical height, never wrap, and shed secondary
  labels before truncating the selected date. It names the selected day, week,
  or month; the calendar body begins directly with its spatial material and
  only that body scrolls.
- Week views keep their shared secondary bar vertically pinned and their time
  axis horizontally pinned. Month views keep the shared weekday bar pinned
  while the date grid scrolls. These are wayfinding anchors, not optional
  decoration.
- The app-frame controls keep Day/Week/Month, Today, period back/forward, and
  the synced-calendar disclosure in that order. The disclosure shows account
  avatars with an `X of X calendars` label and uses switches for visibility.
- Timeline columns carry 15-minute rules with an hour/half-hour/quarter-hour
  weight hierarchy. Half-hour labels in the gutter make the hierarchy readable
  without counting subdivisions. Rules remain behind events, drag previews,
  and the current-time marker.
- Vertical day separation remains visible. Horizontal rules communicate time,
  not card boundaries.
- A bottom-centred floating pill owns date jump, search, and event creation.
  Each action transforms the pill in place. Search moves to screen centre,
  focuses immediately, searches a bounded event range plus dates, and supports
  direct relative-date phrases such as `last Christmas`. Creation exposes the
  standard event fields without launching a second surface.
- The pill and its date, search, create, and event-detail states share one
  persistent Motion layout surface. Bounds morph with a restrained spring while
  outgoing and incoming content crossfade with a short lift. Exiting controls
  become inert, and the global reduced-motion preference remains authoritative.
- Selecting a spatial Calendar event replaces that pill with an event-details
  card in the same floating host used by creation. The card retains the full
  event inspector—including write capability, linked busy blocks, provider
  context, notes, edit, and deletion—without opening the legacy side sheet.
  Event inspection initiated outside Calendar keeps its existing surface.
  Its title is followed immediately by the same compact time range used on the
  spatial event card. Active events expose a live time-remaining status, and
  linked calendars live in an outlined `Shared With` section. `Details Included`
  calendars receive the full event; `Shown as Busy` calendars receive only the
  occupied time. Both rows remain visible, and their calendar-colored badges can
  be removed or added with inline controls that write through to synchronization.
  Event cards repeat this distinction in their calendar-color rails: solid for
  details included and dotted when shown as busy.
- Transient Calendar action and connection-recovery failures use the app-level
  Sonner toaster. They never insert material between the shared app bar and the
  spatial calendar or shift the grid after it has rendered. A failure that
  prevents the calendar itself from loading still replaces the unavailable
  grid with an in-context error state.
- In event creation, start and end controls size to their content and stay
  start-aligned; the duration rule absorbs the remaining inline space. At
  compact widths, the pair stacks without changing its time semantics.
- Optional location, conferencing, and related-link fields expand in place and
  dismiss back to their compact add actions. Time inputs expose editable hour
  and minute segments with an explicit meridiem. An untouched end follows start
  changes at a one-hour duration; a manually chosen valid end is preserved, and
  any end invalidated by a later start is repaired to one hour after that start.
- Conferencing follows the selected calendar's real capabilities. Writable Google calendars can
  request a unique Google Meet conference from Google; every calendar can attach an existing Zoom,
  Teams, Webex, or other meeting URL. Provider-generated options are never shown as available when
  Ilo does not hold that provider's host authority.

## Acceptance

- Local calendars remain first regardless of provider response order.
- Week headers preserve weekday/date controls and all-day events while using
  less vertical space when no all-day events exist.
- Hour rules align with the time axis in day and week views.
- Current-time, selection, event, and drag states remain visually dominant over
  the quarter-hour grid. Dragging a writable event visibly lifts it and the
  drop preview advances only in 15-minute increments.
- Day, week, and month views retain an explicit app-frame date-range heading
  at every scroll position. The Today control remains a standard action, not a
  selected state. Their grid wayfinding uses the shared secondary app bar, not
  Calendar-only chrome. On narrow screens, Calendar compacts primary-bar labels
  while the secondary spatial bar remains horizontally aligned with its grid.
  At compact widths the workspace identity becomes icon-only and the range
  uses a shorter equivalent label; neither becomes a second app-bar row.
- A Calendar-enabled account that requires renewed authorization produces one warning callout with
  a direct Connections link. Automatic retry and ilo-owned service repair remain non-destructive
  freshness state and do not interrupt the calendar with credential advice.

## Schedule health review

`/calendar/review` is the authenticated, Calendar-owned review surface for the first shipped
stewardship slice. It asks the domain/API to assess a fixed window from 30 days before through 90
days after the evidence cutoff. The server-owned playbook currently reports only these finding
kinds:

- stale or unavailable source evidence;
- recurrence that this release cannot assess;
- direct overlap between timed busy events;
- transition-buffer shortfalls from the active Calendar profile; and
- tentative holds that have not been updated recently.

The page presents loading and retryable read-error states, assessment-in-progress and assessment-
error feedback, and every lifecycle in the domain contract: never assessed, stale, queued, active,
maintained, maintained with findings, blocked, and failed. It also distinguishes current, stale,
unavailable, partial, and absent source evidence; unknown finding counts; a supported-checks empty
result; prior immutable findings whose current count is unknown; and open findings whose detail is
unavailable. Partial or stale evidence is blocked or shown as unknown, never converted to a healthy
zero.

Each durable review shows its evidence cutoff, next review time, playbook version, and rulebook
version. Source rows show provider, freshness, completeness, evidence cutoff, and when the source is
read-only; attention states explain evidence that cannot be relied on. Findings retain their
evidence-bound kind, severity, and last-observed time; recommendations disclose confidence,
assumptions, and tradeoffs without implying permission to act. Review responses exclude private
event prose, attendees, locations, raw provider payloads, and credentials.

This slice is read-scoped and advisory. The API may calculate findings and publish an owner-scoped,
immutable review, but neither the page nor its typed API changes events, invitations, provider
state, or user policy. Calendar judgment and versioned playbook policy remain in the domain/API.
There is no MCP change and no external client automation; MCP remains a stateless intent surface.

This is not the complete Calendar Ilo target. Durable maintenance runs and recovery,
`maintain_calendar`, MCP wiring, bounded questions and one-off decisions, explicitly approved
reusable rules, rule-authorized Calendar actions, collaboration stewardship, and travel routing
remain deferred. Live travel feasibility stays unknown until a separately approved routing
integration supplies current evidence.

## Agent-guided setup and proposals

- Calendar setup runs through the shared agent handoff and Calendar-owned skill reference; the
  Calendar page does not duplicate Settings or Agent Access.
- The durable profile names calendar/source meanings, one default writable destination,
  hard/flexible semantics, time zone, busy-block privacy, buffers, and accepted strong-evidence
  kinds.
- Removing a referenced source or losing write access to the default destination returns an active
  Calendar profile to draft for review.
- Evidence-based event creation is candidate-first. The exact destination, time, source, provider
  effect, possible exact-match hint, policy reason, and warnings are visible in the proposal
  contract before a person creates the event. Exact matching is not durable source deduplication.
- The bounded intake path never adds attendees or recurrence, creates buffer events, scans Mail, or
  silently rearranges an existing non-flexible event.
- Caller-supplied evidence remains preview-only. Rule-authorized apply waits for durable,
  server-verified source ownership/revision and idempotency in a later integration.
- Important and upcoming state uses linked shared attention items after a person confirms the
  commitment, rather than duplicating event records from an unverified preview.
