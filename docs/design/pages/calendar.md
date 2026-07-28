# Calendar

## Immediate job

See when commitments occur across the selected calendars, then open or place an
event without losing the shape of the day.

## Composition

- The contextual sidebar places `My calendars` before connected-provider
  account groups because local calendars are a separate first-party source.
- The week header is a compact orientation row. It expands only for real
  all-day material and meets the timeline without a divider.
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

## Agent-guided setup and proposals

- Calendar setup runs through the shared agent handoff and Calendar-owned skill reference; the
  Calendar page does not duplicate Settings or Agent Access.
- The durable profile names calendar/source meanings, one default writable destination,
  hard/flexible semantics, time zone, busy-block privacy, buffers, and accepted strong-evidence
  kinds.
- Evidence-based event creation is candidate-first. The exact destination, time, source, provider
  effect, possible exact-match hint, policy reason, and warnings are visible in the proposal
  contract before a person creates the event. Exact matching is not durable source deduplication.
- The bounded intake path never adds attendees or recurrence, creates buffer events, scans Mail, or
  silently rearranges an existing non-flexible event.
- Caller-supplied evidence remains preview-only. Rule-authorized apply waits for durable,
  server-verified source ownership/revision and idempotency in a later integration.
- Important and upcoming state uses linked shared attention items after a person confirms the
  commitment, rather than duplicating event records from an unverified preview.
