# Workspace switching

## Immediate user job

Move directly between Today, Calendar, Tasks, Mail, and Finances without
mistaking temporary content for a committed destination.

## Surface grammar

| Visible group | Block | Purpose |
| --- | --- | --- |
| Desktop workspace rail | Navigation | Exposes all five workspace icons before contextual navigation; the active link has a selected surface. |
| Narrow workspace trigger | Orientation | Names the active workspace and opens the selector. |
| Workspace menu | Choice | Lists every destination in manifest order using its unframed identity icon and label. |
| Destination surface | Primary material | Appears only after the person selects a workspace and navigation commits. |

On desktop above 900 px, a 64 px rail precedes the contextual sidebar (or the
content on Today and Calendar). The shell fills the viewport: both navigation
columns run from top to bottom, and long content scrolls inside its own pane.
Each 48 px link has an accessible workspace name and a tooltip on hover or keyboard focus. The selected workspace uses a filled glyph and a colored control surface, with
no icon frame or inner border. Inactive workspaces use neutral outline glyphs. Today uses the same icon and target dimensions
as the other workspaces. Settings is a separate neutral link pinned
to the bottom and stays selected throughout account utilities. Route ownership
controls selection, so Reminders continues to highlight Tasks.

The narrow selector is a standard shadcn `DropdownMenu`. It does not preview routes,
mount destination trees, show live summaries, or move a custom hover indicator.
The menu is for choosing a destination, not inspecting one.

Settings is the final, visually separated utility destination in the narrow selector.
It remains neutral and is not treated as a colored workspace identity.
The desktop rail remains available when Settings is active. The
Settings sidebar has no account footer; its Account group contains Account and
Setup. Change password and Log out remain actions inside the Account page rather
than navigation destinations.

Today has no contextual sidebar; Tasks remains the workspace owner for
Reminders. Goals, Motives, Reviews, Activity, and setup remain inside account
utilities rather than becoming workspace destinations.

At 900 px and below, the desktop rail/sidebar is replaced by the bottom
workspace dock. Its active-workspace trigger exposes the same manifest-ordered
destinations; the separate Actions control opens the active workspace's pages
and account utilities. Calendar retains its compact selector in the app bar.

Tasks, Mail, and Finances use the shared shadcn Sidebar, Header, Content, Group,
GroupLabel, and Menu primitives. Their desktop workspace title lives in the sidebar
header; the app bar contains workspace tools. Calendar and Today keep their title
in the app bar, as do narrow layouts without contextual sidebars. All sidebar
sections have labels; feature tools compose the standard actions, badges, and
submenus without custom resting surfaces or per-workspace spacing.

## Interaction contract

Desktop links navigate on activation only. Hover and focus expose their labels
without navigating or prefetching destination data. Normal Tab navigation, Enter,
and browser link actions remain available. The active link has `aria-current="page"`.

For the narrow selector:

1. Opening the selector performs no route data prefetch and does not change the
   visible workspace.
2. Each menu item contains one workspace identity icon and one label. The
   current item also exposes `aria-current="page"`, a filled glyph, and a selected surface.
3. Pointer hover and keyboard focus use the standard menu highlight only. They
   never mount, animate, or navigate a destination.
4. Selecting an item navigates immediately to that workspace's default route.
5. Dismissing the menu with Escape or by moving focus away leaves the current
   route and content unchanged.
6. Destination loading, error, and freshness behavior belongs to the selected
   route after navigation, not to the selector.

## Accessibility and responsive behavior

- The trigger exposes menu state through the shared dropdown primitive.
- Every destination remains a normal linked menu item with keyboard navigation.
- Workspace identity is carried by accessible names, tooltips, and stable glyphs;
  color is never the only cue.
- No hidden or inert destination tree exists behind the menu.
- The desktop rail and mobile dock consume the same workspace manifest order.

## Acceptance checks

- Hovering and focusing every item leaves the current workspace unchanged.
- Opening the selector issues no destination-specific preview requests.
- Selecting each item navigates once and preserves normal route loading states.
- The current destination is announced and visibly selected.
- Escape closes the selector without changing the route.
- Desktop, 320 px layout, high contrast, and reduced motion remain usable.

All desktop contextual sidebars share one collapse control at their trailing edge. Drag inward to collapse to a 48px icon rail and outward to restore the fixed 256px sidebar; arbitrary width expansion is unavailable. Arrow keys, Home/End, and Enter/Space provide keyboard equivalents. The shared preference persists across workspaces. The sidebar, primary app bar, and secondary app bar share the sidebar surface token, without a resting divider at the sidebar edge. The workspace rail uses a slightly lighter semantic surface in each theme.

The desktop workspace rail can also be minimized by dragging its trailing edge inward (or using Home/ArrowLeft on its handle). A compact workspace picker then occupies the leading header slot: contextual sidebars reserve that slot in their header, while Today and Calendar reserve it in the primary app bar. The picker includes Settings and a Show workspace rail action. The minimized preference persists across routes and reloads; mobile navigation is unchanged.

Rail and sidebar width changes, header space reservation, and the compact picker slide use the shared fast motion duration (140ms) and spatial easing. Layout moves with the controls; hidden navigation is inert. Reduced-motion users receive the same final layout immediately.

The compact picker uses the active workspace's filled, unframed icon and colored selection surface. Dropdown destinations use neutral outline icons; only the current workspace receives its palette, filled icon, and selected surface, matching the rail.

Primary and secondary navigation text remains on one line and clips at constrained widths. Mail sync timing is available from the Sync button tooltip on hover or keyboard focus instead of taking permanent header space.

Minimizing the rail from its keyboard handle transfers focus to the compact picker.
Showing the rail returns focus to its active workspace link, never to an inert control.

The contextual sidebar's Shadcn provider is controlled by the same persisted state as its
collapse handle and width. Cmd/Ctrl+B and collapsed-item tooltips therefore follow the
visible sidebar. Mail sync recovery details open in a portaled popover, outside clipped
navigation chrome; the compact Sync/Retry action remains reachable at narrow widths.
