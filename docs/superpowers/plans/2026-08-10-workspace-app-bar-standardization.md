# Workspace app-bar standardization implementation plan

> **For the implementing agent:** execute every task in order; verify each
> result before continuing. This plan is authorized by the user request to plan
> and implement the whole app-shell standardization without follow-up.

**Goal:** replace divergent workspace top navigation with one slot-based,
fixed-geometry `WorkspaceAppBar` across Today, Calendar, Tasks, Mail, and
Finances.

**Architecture:** the Integration-owned app shell resolves route-specific slot
content once, while `WorkspaceAppBar` owns the shared semantic structure and
CSS. Features keep their domain controls; they no longer control app-bar
geometry. Calendar's range label moves to `identity`, and its standard actions
stay in `context`.

**Tech stack:** React, TypeScript, React Router, shadcn/radix Button and
ToggleGroup, Tailwind v4 utility composition, repository semantic CSS tokens,
Vitest/Testing Library, browser QA.

**Implementation status (2026-08-10):** Tasks 1–3 are implemented. Focused
workspace app-bar and narrow Calendar tests, static checks, type checking,
production build, fixture loading, and live desktop route QA passed. `pnpm
verify` was run and reached coverage, but the existing dirty worktree has
unrelated `apps/web/src/app.test.tsx` failures in setup, workspace-preview,
finance, toast, reminder, and connector flows; it therefore cannot be used as
a green whole-repository signal for this shell-only change.

---

### Task 1: Establish the app-shell primitive and behavioral proof ✓

**Files:**
- Create: `apps/web/src/components/workspace-app-bar.tsx`
- Modify: `apps/web/src/app.test.tsx`

1. Add a semantic `WorkspaceAppBar` with `identity`, `context`, and `actions`
   props. Mark each named region with stable `data-slot` attributes and include
   a workspace identity in the root contract.
2. Add a public behavior test that mounts representative Today, Calendar,
   Tasks, Mail, and Finances routes and verifies the same labelled app bar and
   named slots are present for each.
3. Run the focused test. It must demonstrate the new contract before route
   migration begins.

### Task 2: Migrate workspace content into the shared slots ✓

**Files:**
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/features/tasks/page.tsx`
- Modify: `apps/web/src/features/reminders/page.tsx`

1. Centralize the `identity`, `context`, and `actions` resolution at the app
   composition root and render `WorkspaceAppBar` once.
2. Keep feature modules responsible only for their domain controls and action
   callbacks; normalize their primary buttons to the shadcn small action size.
3. Move Calendar orientation into `identity`, retain its `ToggleGroup` as the
   exclusive view selector, and compact only the content at narrow width.
4. Remove the legacy `TopNavigation` component and all per-workspace class
   modifiers.
5. Run the focused unit test after migration, then type-check the web app.

### Task 3: Establish the visual contract, document it, and QA it ✓

**Files:**
- Modify: `apps/web/src/styles.css`
- Modify: `docs/design/system.md`
- Modify: `docs/design/pages/calendar.md`
- Create: `docs/superpowers/specs/2026-08-10-workspace-app-bar-design.md`

1. Replace legacy top-navigation selectors with shared app-bar selectors.
   Remove transparent-mobile and Calendar-only height/position overrides.
2. Define the established slot, responsive, and ownership rules in the design
   system and align the Calendar page specification with the one-row bar.
3. Run lint/style validation, focused UI tests, TypeScript, production build,
   and `pnpm verify`.
4. Load fixtures and inspect `/today`, `/calendar`, `/tasks`, `/mail`, and
   `/finances` at desktop and 390 × 844. Confirm stable geometry, no overflow,
   usable controls, accessible names, and a console free of newly introduced
   errors.

### Review checkpoints

- [x] The primitive prevents the original divergence instead of moving it into
  a different per-workspace CSS class.
- [x] Every workspace uses the same structural order and opaque 52 px frame.
- [x] Calendar's controls remain usable without a special mobile layout.
- [x] Focused tests and browser QA prove the contract; whole-repository
  verification was attempted and is separately blocked by existing failures.
