# Workspace switching

## Immediate user job

Move between Today, Calendar, Tasks, Mail, and Finances without losing
orientation or waiting to understand the destination.

## Surface grammar

| Visible group | Block | Purpose |
| --- | --- | --- |
| Workspace trigger | Orientation | Names the active workspace and opens the ordered switcher. |
| Ordered workspace menu | Choice | Keeps every destination in a stable position with one sliding selection surface. |
| Destination preview | Detail | Renders the hovered or keyboard-focused destination's actual route component with cached data while preserving the sidebar. |
| Destination surface | Primary material | Uses the same component, query keys, and pending state before and after navigation. |

The sidebar remains stable throughout the interaction. The preview replaces
only the workspace surface, is inert until selection, and uses a quiet inner
glow to distinguish this ephemeral state from committed navigation.

## Interaction contract

1. Opening the menu starts the bounded default-route queries for all five
   workspaces in parallel. Each query uses the same key and function as its
   destination, including the supporting overview queries required to compose
   the complete default page.
2. Every menu item shows one compact live summary. While its entry query is
   pending, the summary says that it is loading rather than inventing a count.
3. Hovering or focusing a different item moves one shared highlight to that
   item and mounts the exact destination route component over the current
   workspace.
4. The preview reads the warmed production cache. If a request is unresolved,
   it uses that route's own loading state—never a second approximation of the
   page. It runs behind a read-only navigation boundary, so route initialization
   may derive local search state but cannot replace or push the committed URL.
5. Moving down the ordered menu brings the preview up from below. Moving up
   brings it down from above.
6. Selecting the item navigates immediately. Cached entry data renders without
   a blocking state; otherwise the destination retains the same structural
   skeleton until data arrives.
7. The preview is inert and marked as hidden from assistive technology until
   selection. Dismissing the menu restores the current workspace without
   changing route or query state.
8. Preview visibility is strictly bound to the menu's open state. A deferred
   hover or focus transition that settles after dismissal cannot keep or
   restore an ephemeral destination over the committed route.

Prefetch is an optimization, not a dependency. Navigation, keyboard operation,
and error handling must work when prefetch is slow, rejected, or unavailable.

## Performance standard

- Selection and page movement use the shared 140 ms and 220 ms motion tokens.
- Menu movement and page movement animate `transform` and `opacity`; they do
  not animate layout dimensions.
- Opening the menu issues at most one deduplicated request per default-route
  query key.
- Destination entry data receives a short intent-freshness window so navigation
  can use it immediately. The destination's normal query then refreshes stale
  material in the background when revisited.
- Only the currently previewed route is mounted. The app does not keep five
  hidden page trees alive; menu-open intent warms their data caches instead.
- The inner glow animates only pseudo-element opacity. It does not animate
  layout, blur radius, or shadow geometry.

## Accessibility and responsive behavior

- The trigger exposes menu state, the current destination uses
  `aria-current="page"`, and every item remains a normal menu item and link.
- The route preview is inert and `aria-hidden`; keyboard focus stays within the
  menu until selection.
- Arrow-key focus produces the same preview and prefetch behavior as pointer
  hover.
- Preview motion is supplementary; labels, current state, loading state, and
  destination content remain explicit without it.
- Reduced-motion mode collapses animation duration to effectively immediate.
- At 900 px and below, the preview uses the available content viewport behind
  the open mobile sidebar; dense multi-column skeletons reduce to one column.

## Acceptance checks

- Hover and keyboard focus can preview all five workspaces without navigation.
- The sliding highlight follows the focused item without changing menu geometry
  and is the visible focus treatment; no duplicate ring is drawn.
- Closing with Escape removes the preview and leaves the route unchanged.
- Closing during a pending preview transition cannot leave destination content
  mounted over the current route.
- Selecting a lower then higher item produces matching down/up page direction.
- Opening the menu warms the five destination default-route datasets with their
  production query keys.
- The hovered surface contains the destination's production route component,
  not a preview-only reconstruction.
- Loaded route data remains available after navigation.
- A slow destination shows its own production loading state before and after
  selection.
- Desktop, 320 px layout, high contrast, and reduced motion remain usable.
