# Calendar

## Immediate job

See when commitments occur across the selected calendars, then open or place an
event without losing the shape of the day.

## Composition

- The contextual sidebar places `My calendars` before connected-provider
  account groups because local calendars are a separate first-party source.
- Calendar composes the shared secondary app bar in every view. The day bar
  owns all-day material, the week bar owns weekday/date controls and all-day
  material, and the month bar owns weekday wayfinding.
- The week secondary bar expands only for real all-day material and meets the
  timeline without a decorative divider.
- The persistent Calendar orientation occupies the shared workspace app bar's
  `identity` slot, with Today and the view selector in `context`. It names the
  selected day, week, or month; the calendar body begins directly with its
  spatial material and only that body scrolls.
- Week views keep their shared secondary bar vertically pinned and their time
  axis horizontally pinned. Month views keep the shared weekday bar pinned
  while the date grid scrolls. These are wayfinding anchors, not optional
  decoration.
- The app-frame controls are two understandable groups: a Today action and a
  connected Day/Week/Month segmented control. They remain available on mobile;
  mobile reduces the creation action to its labelled icon so it cannot overlap
  navigation.
- Timeline columns carry a subtle horizontal rule at every hour. The rule
  continues through today highlighting and remains behind events, drag
  previews, and the current-time marker.
- Vertical day separation remains visible. Horizontal rules communicate time,
  not card boundaries.

## Acceptance

- Local calendars remain first regardless of provider response order.
- Week headers preserve weekday/date controls and all-day events while using
  less vertical space when no all-day events exist.
- Hour rules align with the time axis in day and week views.
- Current-time, selection, event, and drag states remain visually dominant over
  the hour grid.
- Day, week, and month views retain an explicit app-frame date-range heading
  at every scroll position. The Today control remains a standard action, not a
  selected state. Their grid wayfinding uses the shared secondary app bar, not
  Calendar-only chrome. On narrow screens, Calendar compacts primary-bar labels
  while the secondary spatial bar remains horizontally aligned with its grid.
- A Calendar-enabled account that requires renewed authorization produces one warning callout with
  a direct Connections link. Automatic retry and ilo-owned service repair remain non-destructive
  freshness state and do not interrupt the calendar with credential advice.

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
