# Calendar

## Immediate job

See when commitments occur across the selected calendars, then open or place an
event without losing the shape of the day.

## Axis layout contract

Calendar has two wayfinding axes: the top date/all-day rail and the leading time rail.
All axis surfaces use `--calendar-axis-background`, mapped to the default page `--background`,
in every view and theme. Mark axis elements with `data-calendar-axis="top"`,
`"left"`, or `"corner"`; the shared CSS rule owns their background. Do not apply
weekday alternation, gradients, or event colors to these surfaces. The current-day
Week header is the explicit exception: it shares `--calendar-today-background`
with its timeline column. Month uses that same tint for today’s date cell; Day
remains neutral, including its all-day lane.
Today's date button can still indicate the current date.

| View | Top rail | Leading rail | Alignment |
| --- | --- | --- | --- |
| Day | Inline all-day bar | `TimeAxis` | Both use `--calendar-time-gutter-width` |
| Week | Weekday/date cells and All Day corner | `TimeAxis` | Header and timeline share the gutter token and day-column template |
| Month | Inline weekday bar | None: month has no time scale | Seven equal columns align with the date grid |

Keep spatial secondary bars inline with their view, not in the shell's secondary
outlet. Week's header stays vertically pinned, and the time gutter plus both corner
cells stay pinned to the leading edge during horizontal scrolling. Its all-day event
lanes belong to the day columns: their fades remain below the date rail and never
paint the time gutter. This separation preserves grid context without coloring the axes.

Implementation: `DayCalendarView`, `WeekCalendarView`, `MonthCalendarView`, and `TimeAxis` in
`apps/web/src/app.tsx`; shared axis tokens and `[data-calendar-axis]` rules in
`apps/web/src/styles.css`. When adding a view, identify its axes, apply these markers,
and verify matching computed backgrounds and column alignment in both themes.

## Composition

- Calendar is the one full-screen workspace and does not render the contextual
  or mobile workspace sidebar. Date jumping and calendar visibility stay
  available in Calendar-owned controls instead of consuming grid width.
- Calendar composes the shared secondary app bar in every view. The day bar
  owns all-day material, the week bar owns weekday/date controls and all-day
  material, and the month bar owns weekday wayfinding.
  These bars use the shared inline-placement option rather than the default
  layout outlet, preserving horizontal alignment with the spatial grid.
- The week secondary bar expands only for real all-day material and meets the
  timeline without a decorative divider.
- All-day events use compact rounded event bars. A multi-day event is one
  continuous bar spanning its occupied day columns, while overlapping events
  stack into separate all-day lanes. Each all-day control retains at least a
  24 px target with spacing between adjacent lanes. Provider date-only events
  stay on their source dates instead of shifting with the planning time zone.
- Visible event feeds collapse provider mirrors into one canonical occurrence.
  A shared iCalendar UID plus the exact start, end, and all-day state is the
  preferred identity. When no shared UID exists, non-local events may match
  only across different calendars and different connected accounts when their
  Unicode-normalized, whitespace-collapsed, case-insensitive title and exact
  occurrence fields agree. Events within one calendar, and every local event,
  remain distinct under that fallback. Managed busy/detail blocks are excluded
  from both mirror identities so separate source commitments remain actionable.
  The first visible projection supplies
  the canonical event while source associations remain available for linked
  block behavior. Backing source calendars are excluded from block destinations,
  and duplicate block relationships to one destination are presented as one
  effective visibility state while changes apply to every backing relationship.
  This conservative display rule does not merge provider
  records, and two independently created cross-account events with identical
  fallback fields remain a known false-positive boundary.
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
  without counting subdivisions. At scroll-top, the midnight label remains
  fully visible below the pinned week bar. Every rule is quieter than the
  standard border token, with half- and quarter-hour marks progressively more
  subdued. Rules remain behind events, drag previews, and the current-time
  marker.
- Overlapping timed events with different start instants stack at full column width,
  with later starts above earlier ones and a 4px horizontal step capped at 16px. Only events sharing the same start instant
  divide into equal side-by-side lanes. Time and duration geometry stays intact.
  A quiet layers icon and count button identifies each overlap group and reveals the existing
  spread interaction. Hover, keyboard focus, click/touch, and Escape remain available;
  the control has no decorative push-pin anatomy.
- Vertical day separation remains visible. Horizontal rules communicate time,
  not card boundaries. Week timelines alternate between two subtle
  neutral row-style surfaces so adjacent days read as distinct tiles. Today
  overrides that alternation with a restrained tint from the current-time
  accent.
- The pinned week bar keeps weekday and date labels on its opaque navigation
  surface. Immediately below that label row, a per-day downward fade inherits
  the corresponding column surface, so alternating and current-day tints flow
  naturally into the timeline. The surface-colored fade
  with bounded backdrop blur carries through the remaining all-day area and
  into the scrolling timeline so content recedes without a hard edge. The fade
  remains translucent and paints behind header and all-day material; navigation
  content itself stays fully opaque and sharp.
- A bottom-centred floating pill owns date jump, search, and event creation.
  Its complete resting surface uses the primary button treatment, with all
  three actions inheriting its foreground. Each action transforms the pill in
  place. Search moves to screen centre,
  focuses immediately, searches a bounded event range plus dates, and supports
  direct relative-date phrases such as `last Christmas`. Creation exposes the
  standard event fields without launching a second surface.
- The pill and its date, search, create, and event-detail states share one
  persistent Motion layout surface. Bounds morph with a restrained spring while
  outgoing and incoming content only crossfade; they never run a competing
  positional transform. Exiting controls become inert, and the global
  reduced-motion preference remains authoritative. On collapse, expanded
  content fades deliberately while the pill waits until the surface is near its
  resting size, preventing a full-width pill-navigation flash. Opening a pill
  surface moves focus to its primary control; Escape closes it and restores
  focus to the action that opened it.
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
  Ilo does not hold that provider's host authority. Provider acceptance is not treated as link
  completion: pending generation and provider failure remain explicit in the returned event and
  produce visible, non-blocking feedback.

## Acceptance

- Local calendars remain first regardless of provider response order.
- Week headers preserve weekday/date controls and all-day events while using
  less vertical space when no all-day events exist.
- Hour rules align with the time axis in day and week views.
- Current-time, selection, event, and drag states remain visually dominant over
  the quarter-hour grid. Dragging a writable event visibly lifts it and the
  drop preview advances only in 15-minute increments. Pointer range creation
  cancels with Escape. A keyboard user can start a one-hour range, adjust its
  end in 15-minute increments, and commit it into the same inline composer.
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

Day and Week both compose `CalendarAllDayEvents` with the same span layout algorithm,
plain rounded event buttons, accessible date labels, and linked-calendar indicators. Day
passes a single date; Week passes seven. Keep differences in column geometry, not
in duplicate event renderers. Month uses its date-cell event list because all-day
and timed events share that cell.

Every Calendar view consumes the available viewport below the app bar, including
narrow layouts. Floating controls overlay the calendar rather than reserving mobile
dock padding. Month rows stretch equally to fill tall viewports, retain a minimum
readable height, and scroll when that minimum exceeds the available height.

Hovering any event brings it above every sibling, whether the overlap stack is pinned
or transiently expanded. The hover and control layers derive from the group size,
so large stacks cannot cover the hovered event or their toggle. The stack toggle has no tooltip and appears at the center only while the stack is
open (hovered, pinned, or an event card is keyboard-focused). The toggle also stays
visible when it has keyboard focus, without forcing cards open; Escape closes the
stack and returns focus to that toggle. Its resting state is visually hidden on hover-capable devices. Touch/coarse-pointer
devices keep the control visible so users can open and close the stack. Opening a stack changes card positions only; it
does not apply hover styling to every card. A stationary padded hover envelope covers
the resting and spread cards, including their gaps, to prevent hover flicker during
movement. Opening a stack adds no background gradient.

Calendar uses the default page background across Day, Week, and Month. Hour rules,
cell dividers, and the alternating `--calendar-tile-background` provide spatial
structure. The same tile token drives Week columns and their all-day fades;
Month uses it for dates outside the current month. Today remains a red tint over
the page background in Week and Month.

Floating action sizing, colors, and labels use the shared
[floating workspace actions contract](../system.md#floating-workspace-actions).
Workspace placement and opened-workflow behavior remain owned by this page.
