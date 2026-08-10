# Workspace app-bar standardization design

## Outcome

People move between Today, Calendar, Tasks, Mail, and Finances without having to
relearn where page-wide context and the primary action live. The app frame stays
visually and spatially stable while each workspace contributes its own useful
content.

## Diagnosis

- **Visible symptom:** each workspace has a different top-bar composition;
  narrow layouts hide most bars, while Calendar introduces a taller, special
  layout.
- **Conditions:** workspace changes, narrow layouts, Calendar view changes,
  and page-specific search or action controls.
- **User cost:** orientation and creation controls change position and shape at
  the point a person needs them most. The moving frame makes the application
  feel like separate products.
- **Responsible layer:** shared app-shell composition and its responsive
  contract. This is neither a Calendar-grid problem nor a feature-page styling
  concern.

## Established invariant

The five workspaces use one `WorkspaceAppBar`. It owns geometry, surface,
responsive behavior, and named slots. A workspace may vary only the **content**
of a slot; it may not add a separate top-bar layout, hide the shared frame, or
change its height.

This is an established cross-product rule, owned by the Integration app shell
(`apps/web/src/components/workspace-app-bar.tsx`, `apps/web/src/app.tsx`, and
`apps/web/src/styles.css`). It applies to normal, narrow, empty, loading,
workspace-switch, dialog, and sheet states. Account setup and Settings are
full-page account utilities, not workspace surfaces, and are outside this
contract.

## Slot contract

| Slot | Ownership | Purpose | Narrow behavior |
| --- | --- | --- | --- |
| `identity` | Workspace route | Compact orientation: workspace/page title, or Calendar date range. | Always visible and truncated before it can move actions. |
| `context` | Workspace route | Search, filters, freshness, or a mutually exclusive view control. | Remains in the same one-row region; individual controls use their compact shadcn treatment rather than creating a second row. |
| `actions` | App-shell route resolver | The workspace's primary action plus a rare platform utility when present. | The primary action remains reachable; descriptive labels may compact only through the shared action treatment. |

The bar is a 52 px sticky frame with the semantic application surface,
consistent 8 px internal gaps, and a quiet bottom border. It never changes
height or position as route state, a modal, a drawer, or a workspace action
changes. It uses the same three-column grid (`identity | context | actions`) on
desktop and narrow screens. The context slot is allowed to use the available
inline space; it does not create a workspace-specific overlay or second frame.

## Content rules

- Today supplies its date identity, conditions context, and the shared Add menu.
- Calendar supplies its selected date/range identity, a standard Today action
  and shadcn `ToggleGroup` view control in context, and New event as its primary
  action. Its date range is compacted at narrow width; its frame is not taller.
- Tasks, Reminders, and Activity supply the current page identity and their
  `WorkspaceSearch` context.
- Mail supplies Mail identity, search/unread context, Sync as a contextual
  utility, and Compose as its primary action.
- Finances supplies the current page identity and Add transaction primary
  action. An unused context slot remains empty; it does not cause a new layout.
- Related actions form shadcn groups only when they share one purpose.
  Mutually-exclusive views use `ToggleGroup`; independent actions remain
  separate buttons with one size family.

## Evidence and precedents

The rule follows the product shell pattern in [Carbon's UI Shell
header](https://carbondesignsystem.com/components/UI-shell-header/usage/),
which establishes a persistent product frame and predictable global regions.
It follows [Fluent's toolbar guidance](https://fluent2.microsoft.design/components/web/react/core/toolbar/usage)
to group related tools, preserve an intentional horizontal layout, and avoid
wrapping controls into an accidental second toolbar. The choice between the
Calendar view control and independent actions follows shadcn's guidance:
[ToggleGroup for state choices](https://ui.shadcn.com/docs/components/radix/toggle-group)
and [ButtonGroup for related actions](https://ui.shadcn.com/docs/components/radix/button-group).

## Acceptance

- Every route owned by Today, Calendar, Tasks, Mail, or Finances renders one
  `WorkspaceAppBar` with the same named slots and no workspace modifier class.
- The app bar remains 52 px high with the same opaque background, border,
  padding, and sticky position at desktop and 390 px narrow widths.
- Calendar presents selected date/range, Today, and the view control within the
  shared row; no Calendar-only second row or 80 px header remains.
- The bar contains no per-workspace mobile visibility overrides. Controls that
  are not applicable are omitted, rather than changing the bar's structure.
- A focused UI test proves the shared contract across all workspace routes;
  live QA confirms no horizontal overflow, semantic labels, and stable frame
  geometry on desktop and mobile.
