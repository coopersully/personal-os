# Workspace ownership design

## Status

Approved design direction. This document establishes an `established` shell
contract for application navigation. Its implementation must be staged because
the current app shell derives sidebar identity from individual route families.

## User outcome

A person can tell which area of ilo they are in, move among the five areas
without the navigation changing underneath them, and reach account management
without mistaking it for a workspace.

## Definitions

### Workspace

A workspace is a stable top-level product area with a distinct immediate job,
one default route, one sidebar, and a permanent position in the workspace
switcher. ilo has exactly five workspaces:

| Workspace | Default route | Immediate job | Sidebar owns |
| --- | --- | --- | --- |
| Today | `/today` | Understand and shape the person's whole life across connected domains. | Today, Goals, Motives, and Activity. |
| Calendar | `/calendar` | Understand and arrange time. | Calendar views, calendars, and calendar-specific controls. |
| Tasks | `/tasks` | Capture and organize commitments. | Task views and Reminders. |
| Mail | `/mail` | Read, triage, and compose mail. | Mail views, accounts, and mail-specific controls. |
| Finances | `/finances` | Understand and act on financial material. | Finance sections and finance-specific controls. |

Today is a neutral, personal pseudo-workspace: it is not a sixth provider or
colored domain, but it is a first-class workspace for navigation and shell
ownership. Its identity stays neutral.

### Account utility

The account utility is a full-page administration surface, not a workspace. It
owns personal and system configuration: profile, appearance, connected
services, sessions/security, setup, invitations, agent access, and automations.
It is entered from the account menu, not the workspace switcher. Its local
navigation is labelled as account administration and must not use a
`WorkspaceIcon`, workspace selection state, or a workspace sidebar identity.

The account utility retains a return target for the workspace route from which
it was opened. If no safe in-app history exists, it returns to `/today`.

## Navigation ownership contract

Every authenticated route declares one explicit navigation owner:

```ts
type WorkspaceId = "today" | "calendar" | "tasks" | "mail" | "finances";

type NavigationOwner =
  | { kind: "workspace"; workspace: WorkspaceId }
  | { kind: "account-utility" };
```

The integration-owned route manifest resolves `NavigationOwner` before the
shell renders. A route can change the selected row or local state inside its
owner, but cannot select a different sidebar. Route-name conditionals such as
`sidebarMode` are forbidden as a navigation-ownership mechanism.

| Route family | Navigation owner | Required shell behavior |
| --- | --- | --- |
| `/today`, `/goals`, `/motives`, `/activity` | Today | Render the Today sidebar; the current child destination is selected. |
| `/calendar` and calendar child routes | Calendar | Render the Calendar sidebar. |
| `/tasks`, `/reminders` | Tasks | Render the Tasks sidebar; Reminders is a related Tasks destination. |
| `/mail` and mail child routes | Mail | Render the Mail sidebar. |
| `/finances` and finance child routes | Finances | Render the Finances sidebar. |
| `/settings`, `/setup`, and account/security/connection administration routes | Account utility | Render the account-utility frame and its local navigation; do not render or select a workspace sidebar. |

The workspace switcher contains only the five workspace defaults in the stated
order. It can preview only those five workspace surfaces. Account utility and
workspace children never appear as switcher entries.

## Shell and interaction rules

- A workspace's sidebar is stable while visiting any child route. Selection,
  badges, and contextual groups may change; the sidebar's identity does not.
- Today is the owner for person-identified and cross-workspace orientation
  material. Goals, Motives, and Activity are Today children, not global
  destinations.
- Tasks is the owner for both task and reminder work. A compatibility route may
  keep `/reminders` initially, but it must resolve to the Tasks owner.
- The account menu opens the account utility as a full page. It provides an
  accessible `Back to <workspace>` control and restores the recorded route.
- On narrow layouts, the fixed workspace dock names the active workspace and
  opens the five-destination workspace menu. Its separate Actions bubble opens
  the active workspace's page/account sheet; account administration never
  becomes a workspace.
- A workspace's generic Add menu, top-frame controls, prefetch keys, and route
  preview continue to be owned by its workspace. Account utility does not
  participate in workspace prefetch or previews.

## Ownership and documentation changes

Integration owns the workspace registry, navigation-owner manifest, shell
composition, workspace switcher, responsive navigation, and account-utility
entry/return wiring. Feature owners export their route metadata and their one
workspace-local sidebar composition; they do not edit the global workspace map.

The following durable sources must be updated together with implementation:

- `docs/design/foundations.md`: describe Today as a neutral fifth workspace and
  distinguish it from the four colored product identities.
- `docs/design/system.md`: establish the explicit navigation-owner contract,
  five-sidebar invariant, account-utility frame, and narrow-layout behavior.
- `docs/design/pages/workspace-switching.md`: restrict switcher and preview
  behavior to the five workspace defaults.
- `docs/design/pages/today.md`, `commitments.md`, and `activity.md`: assign
  Today and Tasks child destinations precisely.
- `docs/engineering/feature-ownership.md` and the frontend skill: make the
  route manifest and shell registry Integration-owned; require feature exports
  to name their navigation owner.
- The shell QA runbook and focused tests: cover sidebar persistence across
  child routes, account-utility entry/return, and narrow navigation.

## Migration and verification

1. Introduce the typed workspace registry and route-owner manifest while
   retaining existing URLs.
2. Migrate Today, Tasks, Calendar, Mail, and Finances one owner at a time;
   delete route-derived sidebar modes once every child route is manifest-owned.
3. Extract the account utility into a full-page frame with an explicit return
   target. Preserve settings URLs and deep links.
4. Update durable standards and QA contracts in the same change series.

Focused tests must prove that `/today` → `/goals` and `/today` → `/motives`
retain the Today sidebar, `/tasks` → `/reminders` retains the Tasks sidebar,
and account utility does not enter the workspace switcher or change its five
entries. Playwright coverage must prove desktop and 390 × 844 navigation,
return-target restoration, Escape/overlay behavior, keyboard focus, no
horizontal overflow, and deep-link behavior for every route family.
