# Finances — agent guidance specification

## User job

**See whether my Finance context is ready for a scoped agent and understand
which decisions still require me.**

Agent guidance belongs in the Finance feature's Profile section. The shared
Agent access page continues to own connection and authorization; this surface
explains Finance readiness and routes there without duplicating its controls.

## Content contract

- Profile state is explicit: not configured, draft, or active.
- Source readiness counts only current Finance accounts owned by the user.
- Suggested-workflow readiness comes from the Finance API, not UI inference.
- The safety summary renders every typed `humanOnlyActions` value returned by
  the Finance API through an exhaustive label map; the UI does not duplicate
  or infer that policy.
- Loading and failure remain local to the guidance card and do not hide the
  human-managed financial profile.

## Responsive and accessibility contract

- Guidance precedes the financial profile so readiness and boundaries are read
  before administrative fields.
- Status is text as well as color. Every route to Agent access is a labelled
  link with a standard keyboard target.
- Compact rows wrap at narrow widths; no count or policy meaning is conveyed by
  an icon alone.

## Verification

1. Open Finances → Profile with no domain profile and confirm “Not configured.”
2. Save draft and active profiles and confirm the state changes without editing
   shared Settings UI.
3. Confirm source and workflow counts match the guided-context API.
4. Fail either readiness request and confirm an actionable local error while
   the financial profile remains usable.
5. Verify keyboard operation and narrow/mobile wrapping.
