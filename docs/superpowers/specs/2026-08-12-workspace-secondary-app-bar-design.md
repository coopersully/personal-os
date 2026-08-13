# Workspace Secondary App Bar Design

## Outcome

Every shell route can compose the same secondary app-bar primitive beneath the
primary `WorkspaceAppBar`. Calendar and Mail become the reference consumers.
Calendar uses it for pinned date-grid wayfinding and all-day material; Mail uses
it for actions on the selected conversation.

## Diagnosis

- **Symptom:** Calendar and Mail present comparable persistent contextual chrome
  with unrelated markup, colors, dimensions, and responsive behavior.
- **Conditions:** Calendar day, week, and month views; Mail with a selected
  conversation; desktop and narrow widths.
- **Cost:** People must relearn where contextual tools live, while feature code
  duplicates a layout responsibility that belongs to the shared frame.
- **Root cause:** The design system defines only the primary app bar. The
  secondary bar exists visually but has no shared primitive or contract.
- **Invariant:** A contextual row immediately beneath the primary app bar uses
  one shared slot anatomy, semantic surface, responsive policy, and accessible
  landmark contract regardless of workspace.
- **Maturity:** Established.
- **Owner:** Integration (`apps/web/src/components` and shared styles).

## Component Contract

`WorkspaceSecondaryAppBar` owns the semantic region, shared surface, minimum
height, width, and slot order. It provides optional `leading`, `content`, and
`actions` slots as composable subcomponents. It accepts a required accessible
label and ordinary layout `className` for domain-specific grid geometry, but
features cannot override its semantic color or base spacing.

The primitive is available to every page but renders only when a page has real
secondary context. It does not reserve an empty row.

## Calendar Migration

- Day view wraps its all-day row in the shared secondary bar.
- Week view places one sticky shared secondary bar across the scroll-synchronized
  grid. Its content slot contains the time corner, weekday/date controls, and
  compact all-day events.
- Month view places its weekday labels in the shared secondary bar above the
  month grid.
- Calendar retains ownership of date logic, event controls, horizontal scroll,
  and dynamic height.

## Mail Migration

Mail renders the shared secondary bar only when a conversation is selected.
Reply and Archive remain labelled primary tools. Snooze, Star, and read state
remain compact controls and collapse into More at narrow widths. Mail removes
its independent secondary-bar surface and geometry.

## Responsive and Accessibility Contract

The DOM and focus order remain `leading`, `content`, then `actions`. Content may
scroll horizontally when its domain requires it; actions remain reachable and
compact according to the feature's existing overflow menu. Every rendered bar
has a distinct accessible label. The shared surface is flat, uses semantic
background tokens, and adds no shadow, gradient, or decorative divider.

## Verification

Focused component coverage verifies slot order and omission. App integration
coverage verifies that Calendar and Mail both expose the same secondary-bar
contract. Existing Calendar and Mail behavior tests protect date navigation,
conversation actions, responsive overflow, and mutations. Web type checking,
linting, and focused tests complete the automated evidence; live browser QA
covers desktop and narrow layouts.
