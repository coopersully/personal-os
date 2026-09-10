# Mobile workspace dock design

## Status

Implemented on 2026-08-10.

## Immediate user job

Recognize the active workspace on a phone, switch among the five workspaces,
then reach the active workspace's pages without opening a sidebar drawer.

## Decision

Replace the small-screen favicon drawer trigger with a fixed, centred,
pill-shaped workspace dock: an active-workspace trigger and a separate Actions
bubble. The workspace trigger shows its framed identity, label, and chevron,
then opens the five manifest-ordered workspace destinations. The Actions
bubble always opens a contextual sheet; it never creates material or navigates
by itself. This is the recommended model because it preserves readable current
context while keeping workspace movement and page navigation predictable.

Desktop retains the sidebar and workspace switcher unchanged. Account utility
routes remain full-page utilities and do not render the dock.

### Visual and interaction refinement

- The workspace dock is a shadcn-style floating `secondary` pill with one
  mobile-optimised workspace trigger: the
  active workspace's framed icon, label, and chevron. It opens the same ordered
  five-workspace menu used by the desktop sidebar, so a person can read their
  current context before changing it.
- The separate, circular `primary` Actions bubble is offset by 8 px and never
  visually connected to the pill. Its sheet uses icon-led page rows, an account
  trigger, and an isolated destructive logout action. Do not use one selector
  to restyle both links and Buttons: that can override the shadcn semantic
  foreground token.
- Every workspace identity uses a 28 px frame and a 16 px glyph. Today uses a
  neutral framed Home glyph so it has the same footprint as coloured workspace
  icons rather than appearing smaller or visually orphaned.
- Use `ItemGroup`/`Item` for navigation and account rows and shadcn Buttons
  for executable actions. The Sheet retains its title, description, close
  affordance, Escape dismissal, focus management, and safe-area layout.

### Stability revision

- The mobile dock has one fixed viewport width and a fixed bottom-centre
  position at every route, open state, loading state, and action-sheet state.
  Its workspace pill and separate Actions bubble occupy fixed grid columns;
  changing the active label must never change either control's position.
- The pill is a single quiet container surface. The workspace trigger itself
  is ghost-styled: the current label and identity icon communicate selection,
  while keyboard focus remains the only transient treatment. Do not combine a
  selected background, border, outline, underline, and highlight.
- The workspace menu shows the desktop switcher's two-line information shape:
  icon, workspace label, and a stable one-line purpose. Mobile purpose copy is
  static and task-oriented so it does not load, resize, or shift while opening.

## Interaction contract

### Workspace controls

- The workspace trigger opens the five `workspaceDefinitions` in manifest order
  with their existing whole-workspace identities. Each menu destination is an
  accessible link to the workspace default route. The trigger resolves from
  `NavigationOwner`, not only the default URL: Goals, Motives, and Activity
  select Today; Reminders selects Tasks.
- The dock is fixed above the safe-area inset, centred horizontally, and does
  not overlap page material. The main content reserves enough bottom space to
  remain reachable.

### Contextual Actions sheet

- The Actions control is a labelled button that opens a modal bottom sheet.
  It uses a familiar actions glyph, not a hamburger icon and not the favicon.
- The sheet title names the active workspace. It presents its `Pages` group;
  those links mirror the active desktop workspace sidebar. The sheet is a
  navigator: creation actions remain in the page's top app frame, where they
  are consistently available.
- Account is a compact first-name trigger after the page list. Its menu contains
  Setup, Settings, and Log out, so account management remains a distinct utility
  rather than a sixth workspace.
- A page link closes the sheet before navigation.

### Accessibility and responsive behaviour

- Use the existing shadcn Sheet/Drawer primitive, with a visible title,
  accessible close button, focus containment, Escape dismissal, and modal
  semantics. The dock remains outside the sheet but is inert while the modal is
  open through the primitive's modal handling.
- At 900 px and below, suppress the desktop sidebar and its floating favicon
  trigger; render only the dock. At larger widths render neither dock nor
  mobile sheet.
- The app top navigation stays in place. Page-specific action buttons in that
  top bar remain the single touch-oriented creation surface.
- Anchor the dock with `left: 50vw`, rather than layout-relative `50%`, so
  Radix scroll locking cannot alter its physical horizontal position.

## Architecture

- Add a small shell-owned `MobileWorkspaceDock` composition component next to
  the app shell. It consumes `workspaceDefinitions`, `workspaceForLocation`,
  route location, and callbacks for the existing editor and workspace actions.
- Keep workspace-page definitions data-driven in the shell and derive active
  state from `NavigationOwner`. Do not add route maps to individual features.
- Reuse current feature buttons or callbacks where they already encode API,
  state, loading, and disabled behavior. The dock sheet supplies lightweight
  rows rather than new feature-specific action implementations.

## Verification

- Unit-test the page/action manifest for Today and Tasks route ownership.
- Add app-frame tests that assert the dock replaces the favicon trigger below
  900 px, its workspace menu navigates, and the actions sheet exposes
  Today/Tasks pages.
- Check keyboard close and sheet navigation in the browser at 390 px; check
  the desktop sidebar remains at 1280 px.
- Run focused tests, lint, web type-check, and web production build.
