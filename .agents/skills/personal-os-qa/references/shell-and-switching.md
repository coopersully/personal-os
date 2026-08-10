# Shell and workspace-switching runbook

## Fixtures and routes

- Populated: `demo+full@ilo.test`
- Empty summaries: `qa+empty@ilo.test`
- Routes: `/today`, `/calendar`, `/tasks`, `/mail`, `/finances`
- Product contract: `docs/design/pages/workspace-switching.md`

## Desktop pass

1. Start on `/today` and confirm the sidebar identifies the active workspace.
2. Open **Switch workspace**.
3. Confirm one ordered menu contains Today, Calendar, Tasks, Mail, and Finances.
4. Confirm every row contains a compact live summary. Populated fixture examples
   include event, task-inbox, unread-mail, and finance-review counts. Empty
   fixture summaries state the empty result rather than inventing data.
5. Hover Calendar, then Finances, then Calendar:
   - the committed URL does not change;
   - exactly one `.workspace-preview` mounts;
   - its `data-workspace` matches the hovered item;
   - it is `inert` and `aria-hidden="true"`;
   - the surface contains the production route data;
   - moving down reports `data-direction="down"` and moving up reports `up`.
6. Press Escape. The preview must unmount and the committed route must remain.
7. Select a workspace and confirm warmed data appears without a preview-only
   reconstruction or a blocking reset.
8. Confirm the sliding highlight changes position without changing row geometry
   or drawing a second per-item focus ring.

## Shell consistency

- Every workspace route renders the same 52 px opaque `WorkspaceAppBar` with
  `identity`, `context`, and `actions` slots in the same order. Its height,
  background, border, and sticky position do not change across routes,
  workspace-state changes, or while a sheet/dialog is open.
- Today keeps its date in `identity`; Calendar keeps its selected date/range in
  `identity`; the other workspaces keep compact route orientation there. Route
  controls occupy `context`, and the primary action occupies `actions`; no
  workspace introduces a second top frame or a mobile-only transparent bar.
- Contextual sidebars do not repeat the workspace label below the switcher.
- Internal links do not show external-link glyphs.
- Active navigation uses the filled form of the same icon used in outline form
  when inactive.
- Sidebar, top frame, and body remain flat surfaces without divider borders.
- Browser console has no new errors or repeated third-party-script warnings.

## Narrow pass

1. Set the viewport to 390 × 844.
2. Visit `/today`, `/calendar`, `/tasks`, `/mail`, and `/finances`. Confirm the
   app bar has identical 52 px geometry, an opaque surface, and no horizontal
   overflow. Confirm Calendar's range, Today action, and view controls remain
   in the shared row rather than a taller Calendar-specific header.
3. Confirm a centred **Workspace dock** names the active workspace and opens an
   ordered Today, Calendar, Tasks, Mail, and Finances menu; its separate
   **Workspace actions** bubble remains fixed beside it. No favicon trigger or
   hamburger is present.
4. Select Tasks from that menu and confirm the dock active state follows the
   workspace owner. Navigate to Reminders and confirm Tasks remains active.
5. Open **Workspace actions**. Confirm its modal sheet lists the active
   workspace pages and actions, then close it with Escape.
6. Confirm `document.documentElement.scrollWidth` does not exceed
   `clientWidth`.
7. Confirm the sheet closes through its named close control or Escape.
8. Reset the viewport override.

## Regression sentinels

- A closed menu must never leave a delayed preview mounted.
- Only the currently previewed route mounts; five hidden page trees must not.
- Preview content must be real cached route content, not a separate skeleton.
- Hover and keyboard focus must expose equivalent preview behavior.
