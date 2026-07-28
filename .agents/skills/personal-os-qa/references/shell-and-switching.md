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

- Today alone keeps the date title in the top frame. Other workspaces keep their
  route-global controls there without repeating a large title.
- Contextual sidebars do not repeat the workspace label below the switcher.
- Internal links do not show external-link glyphs.
- Active navigation uses the filled form of the same icon used in outline form
  when inactive.
- Sidebar, top frame, and body remain flat surfaces without divider borders.
- Browser console has no new errors or repeated third-party-script warnings.

## Narrow pass

1. Set the viewport to 390 × 844.
2. Confirm the app frame exposes **Open Navigation** and the primary bottom nav.
3. Open navigation, then the workspace switcher.
4. Confirm the menu fits within the drawer, summaries remain readable, the
   active row is clear, and the body behind it is inert/dimmed.
5. Confirm `document.documentElement.scrollWidth` does not exceed
   `clientWidth`.
6. Dismiss both layers using their named controls or Escape.
7. Reset the viewport override.

## Regression sentinels

- A closed menu must never leave a delayed preview mounted.
- Only the currently previewed route mounts; five hidden page trees must not.
- Preview content must be real cached route content, not a separate skeleton.
- Hover and keyboard focus must expose equivalent preview behavior.
