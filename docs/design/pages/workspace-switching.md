# Workspace switching

## Immediate user job

Move directly between Today, Calendar, Tasks, Mail, and Finances without
mistaking temporary content for a committed destination.

## Surface grammar

| Visible group | Block | Purpose |
| --- | --- | --- |
| Workspace trigger | Orientation | Names the active workspace and opens the selector. |
| Workspace menu | Choice | Lists every destination in manifest order using its framed identity icon and label. |
| Destination surface | Primary material | Appears only after the person selects a workspace and navigation commits. |

The selector is a standard shadcn `DropdownMenu`. It does not preview routes,
mount destination trees, show live summaries, or move a custom hover indicator.
The menu is for choosing a destination, not inspecting one.

Settings is the final, visually separated utility destination in the selector.
It remains neutral and is not treated as a colored workspace identity.
When Settings is active, this same selector replaces the old back row. The
Settings sidebar has no account footer; its Account group contains Account and
Setup. Change password and Log out remain actions inside the Account page rather
than navigation destinations.

Today has no contextual sidebar; Tasks remains the workspace owner for
Reminders. Goals, Motives, Reviews, Activity, and setup remain inside account
utilities rather than becoming workspace destinations.

At 900 px and below, the desktop selector/sidebar is replaced by the bottom
workspace dock. Its active-workspace trigger exposes the same manifest-ordered
destinations; the separate Actions control opens the active workspace's pages
and account utilities.

## Interaction contract

1. Opening the selector performs no route data prefetch and does not change the
   visible workspace.
2. Each menu item contains one workspace identity icon and one label. The
   current item also exposes `aria-current="page"` and a check glyph.
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
- Workspace identity is carried by both text and the stable framed icon; color
  is never the only cue.
- No hidden or inert destination tree exists behind the menu.
- The desktop menu and mobile dock consume the same workspace manifest order.

## Acceptance checks

- Hovering and focusing every item leaves the current workspace unchanged.
- Opening the selector issues no destination-specific preview requests.
- Selecting each item navigates once and preserves normal route loading states.
- The current destination is announced and visibly checked.
- Escape closes the selector without changing the route.
- Desktop, 320 px layout, high contrast, and reduced motion remain usable.
