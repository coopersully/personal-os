# Workspace layout architecture

Status: shared frame migration merged into `main` in
[PR #223 — Standardize workspace layouts and Finance configuration](https://github.com/coopersully/personal-os/pull/223)
at `99ecac3d` on October 7, 2026. The October 3 branch implementation and original audit
below record the starting point; the implementation contract describes the current frame
boundaries. Later action placements follow the owning page contracts, including
[workspace Reviews](pages/reviews.md). This source checkpoint does not establish deployment.

## Purpose

Four domain products share one predictable application frame. Calendar retains a
spatial model, Tasks a commitment model, Mail a conversation model, and Finances
a financial model. Today is their shared overview; Settings is account administration.
Neither needs to become a fifth domain product to use the same frame.

Cohesion means stable control roles, navigation, spacing, surfaces, focus, and
responsive behavior. It does not require identical content grids or identical
numbers of toolbars. Customization should expose useful choices (collapsed
navigation, pane width, domain views), not an arbitrary dashboard builder.

## Starting-point audit

- `components/workspace-layout.tsx` provides banner, primary navigation, a
  secondary portal target, and children. It is a useful starting point, not yet
  the owner of the complete workspace geometry.
- `components/workspace-app-bar.tsx` has identity/context/actions slots. Their
  meaning is too broad: source filters, creation, search, and date navigation
  require different responsive priorities.
- `WorkspaceAppBarForRoute` and `AuthenticatedApp` in `app.tsx` select domain
  controls and sidebar compositions. Domain-specific queries and route checks
  therefore accumulate in the integration root.
- `WorkspaceSecondaryAppBar` keeps feature ownership through a portal. Its
  inline placement correctly accommodates Calendar's coordinate-aligned header.
  Preserve this distinction; do not portal Calendar's grid labels out of its grid.
- The mobile creation group is still authored inside the app bar and repositioned
  by CSS. Mail and Calendar position their floating surfaces separately. This
  leaves geometry and DOM/focus order with different owners.
- `.content--calendar` and `.content--mail` subtract `--chrome-height` from the
  viewport while mobile app bars have intrinsic height. Sticky offsets also
  assume fixed chrome/banner heights. This is a fragile sizing contract.
- Tasks, Mail, and Finances now reuse their sidebar content in mobile sheets.
  The mobile dock still contains an unused legacy workspace-switcher path and
  fallback destination data. Retire these when extracting the navigation host.
- The navigation manifest centralizes route ownership, but its `WorkspaceId`
  also includes Today. Keep that navigation concept distinct from the four
  domain identities; do not rename persistence or API types for this UI cleanup.

## Proposed hierarchy and ownership

| Layer | Owns | Must not own |
| --- | --- | --- |
| Application shell | Workspace rail/compact switcher, account destination, safe areas, global banners, navigation preference persistence | Domain search, records, provider calls |
| Workspace frame | Header, optional contextual navigation, optional view toolbar, remaining content area, action placement | Domain decisions or arbitrary page layouts |
| Domain workspace composition | Slot contents, source controls, search semantics, views, review entry, available actions | Viewport math or a second global navigation system |
| Page pattern | Spatial canvas, collection, list/detail, or reading surface; pane scrolling and local detail | Global rail or workspace switching |
| Domain material | Events, tasks, messages, transactions and their interactions | Shell geometry |

Use normal React composition and a small typed slot contract. No plugin system,
JSON layout language, generic record renderer, or universal mega-component.
Keep existing primitives and grow the existing frame rather than adding a
parallel hierarchy of near-identical wrappers.

## Frame slots

| Slot | Content | Placement rule |
| --- | --- | --- |
| Identity | Workspace/route title and orientation | Desktop sidebar header where present; otherwise main header; compact switcher leads on mobile |
| Navigation | Workspace views, lists, folders, or sections | Sidebar on wide layouts; same content in the mobile navigation sheet |
| Context | Search, date/view controls, source selector, sync | Header; may occupy a second row without changing meaning |
| View toolbar | Controls for the displayed collection or selection | Immediately above affected material; omitted when empty |
| Attention | Review entry and count | Desktop sidebar footer, or Calendar header; mobile header icon/count with full accessible name |
| Primary actions | Create/compose and closely related entry actions | Explicit frame action region; mobile bottom end except Calendar bottom center |
| Content | The actual page pattern | Consumes remaining space or owns normal document scrolling according to its pattern |

Selection actions belong beside their selection, not in the global create group.
Keep source visibility filters distinct from account configuration. Reviews use
one shared flow host, with domain-owned decision contents, regardless of entry.
An overlay host is a mounting/focus concern, not an invitation to centralize all
domain state in the shell. The existing responsive dialog remains the primitive.

## Content patterns

| Product | Default pattern | Preserved specialization |
| --- | --- | --- |
| Calendar | Spatial canvas | Coupled time/day axes, horizontal alignment, zoom/view state, calendar scrolling; no artificial sidebar |
| Tasks | Collection with detail | Lists/projects/views, selection and ordering; detail adapts to available room |
| Mail | List/detail | Independent message list and reader; narrow mode presents the selected pane with a clear return path |
| Finances | Page surface, with collection/detail where useful | Financial summaries, tables, transaction labeling; do not force all pages into a dashboard |
| Today | Cross-domain page surface | Summaries and typed links into domain products |
| Settings | Reading surface | Settings introduction and bento groups, not workspace chrome duplicated above every section |

A bento grid is a composition inside a page, not the universal application layout.
A calendar day header is part of the calendar, not a generic secondary toolbar
just because it is visually near the top of the screen.

## Responsive and state contract

- Use one shell breakpoint policy for navigation. Use available content width for
  pane adaptation; a desktop window with an expanded sidebar can still have narrow content.
- Layout is intrinsic: banner/header/toolbar rows size themselves; the content row
  gets the remainder with `minmax(0, 1fr)` and `min-width/min-height: 0` boundaries.
  Remove duplicated viewport subtraction and fixed sticky offsets as a unit.
- Declare a scroll owner for each pattern. A document page has one primary scroll
  area; a spatial canvas or list/detail view may have intentional independent panes.
  Avoid accidental body-plus-pane scrolling.
- Collapse labels to icons/counts before hiding actions. Distinct controls move
  to a second row or labelled overflow; do not clip controls into unreachable space.
- Never mount duplicate active search controls or dialogs solely to change their
  placement. Preserve focus, drafts, selection, and URL state across resizing.
- Keep view/filter/selection state in the domain and URL where appropriate.
  Persist only useful layout preferences; preserve desktop preferences while mobile.
- Respect safe areas, keyboard occlusion, large text, reduced motion, and long
  account/list names. Floating controls must not cover the final actionable row.

## Implemented frame contract

- `WorkspaceLayout` owns an intrinsic `workspace-chrome` stack containing the
  banner, primary navigation, and collection toolbar portal. There is one sticky
  stack, with no guessed banner or toolbar offsets.
- `contentMode="panes"` bounds Calendar and Mail to the viewport. Chrome consumes
  its natural height; content receives the remainder and domain panes scroll.
  `contentMode="page"` supports normal page material: desktop content scrolls in
  the shell and mobile pages scroll as documents. Pane content never inherits
  mobile document padding or the bottom navigation reservation.
- `WorkspaceAppBar` accepts identity, context, utility actions, attention, and
  primary actions. Primary actions have a named, permanently mounted responsive
  region; changing placement does not mount a second copy of a control.
- `FloatingActionRegion` owns the common safe-area anchor for Calendar and Mail.
  Domains choose center or end and own their expanded workflows. Search may
  deliberately move Calendar's expanded surface toward the viewport center.
- Calendar orientation/period controls, Mail search composition, and Finance
  creation live in feature `workspace-header.tsx` modules. Tasks already exports
  its controls from its feature. Existing account visibility/sync adapters remain
  in the integration root and are passed as slots; moving those queries is not
  necessary to establish the layout contract.
- The mobile navigation host accepts its title and navigation contents from its
  owner. It no longer contains a second workspace switcher or a stale copy of
  Tasks/Finance destinations. The same domain navigation renders in the sidebar
  and mobile sheet.
- Calendar axes continue to use inline secondary navigation. Collection toolbars
  use the stable portal target. Do not move coordinate-aligned headers outside
  their domain scrolling surface.

Verification must include intrinsic multi-row headers and pane bottom edges,
mobile attention visibility, navigation sheets, and preservation of floating
workflow state/focus. The shared-frame tests exercise portal placement and action
state across chrome updates; domain floating-action tests cover their workflows.

## Mobile header density

The compact workspace switcher is always a 32px square with a centered glyph,
including Calendar and the desktop collapsed-rail entry. Its owner defines both
dimensions; workspace-specific rules must not override either dimension.

Workspace-owned controls use the shared top navigation slots described in the
[design system](system.md), rather than a duplicate toolbar beside each collection.
Route-specific creation actions appear only where that route supports them.

Calendar keeps a collapsed Day/Week/Month selector at every width. At 600px or
less, its view menu also contains a separate Today and Previous/Next command group;
above that breakpoint those period actions remain visible in the app bar. Both
presentations share URL update handlers, source visibility, and review entry points.
The floating date control remains available for date navigation.

Use the domain's control priorities and responsive menus to preserve accessible
hit targets and useful context. Keep mobile review copy compact; do not reduce
control sizes to force all content onto one row.

## Bounded migration

1. Establish frame sizing and scroll ownership first. Remove hardcoded height
   subtraction with targeted Calendar/Mail checks, including multi-row headers
   and the offline banner. Preserve current visual placement.
2. Move workspace composition into domain-owned components. Keep a small static
   route-to-workspace mapping in the root; pass typed dependencies where needed.
3. Give creation actions and attention explicit slots. Replace CSS relocation
   with an intentional responsive host, preserving focus and mounted state.
4. Remove unused dock switcher/fallback paths and consolidate shared frame CSS.
   Extract reusable pane patterns only where two actual consumers justify them.

Each step should stand alone, with no product-data migration or redesign of
workspace content. Acceptance covers rail expanded/collapsed, navigation open/closed,
wide/narrow content, mobile keyboard, large text, long labels, loading/error/empty
states, deep links, overlays, and resize with a selected record or draft.

## Research basis

[Material canonical layouts](https://developer.android.com/develop/adaptive-apps/guides/canonical-layouts)
provide useful distinctions between list/detail and supporting panes. Apply those
content relationships, not Android-specific implementation APIs.
[shadcn Sidebar composition](https://ui.shadcn.com/docs/components/sidebar)
supports assembling navigation from stable primitives. Keep the repository's
installed primitives; this proposal does not require changing their vendor runtime.
