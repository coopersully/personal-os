# Mobile Workspace Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the small-screen sidebar trigger with an accessible six-control workspace dock and contextual action sheet.

**Architecture:** A shell-owned dock reads the typed workspace navigation manifest and derives selection from the route owner. A modal action sheet exposes the active workspace's pages and existing app-frame actions, while the desktop sidebar remains untouched.

**Tech Stack:** React 19, React Router, TypeScript, shadcn Sheet/Sidebar primitives, Vitest, Testing Library, CSS media queries.

## Global Constraints

- The workspace set and order are exactly Today, Calendar, Tasks, Mail, Finances from `workspaceDefinitions`.
- A route's `NavigationOwner`, not its leaf path, selects the mobile workspace control.
- The Actions control always opens a modal contextual sheet; it never performs a direct action.
- Account utilities are sheet links, not workspaces; desktop layout is unchanged.
- At 900 px and below, render no sidebar drawer or floating favicon trigger.

---

### Task 1: Define contextual mobile sheet content

**Files:**
- Create: `apps/web/src/navigation/mobile-workspace-dock.ts`
- Create: `apps/web/src/navigation/mobile-workspace-dock.test.ts`

**Interfaces:**
- Consumes: `WorkspaceId` from `navigation/manifest.ts`.
- Produces: `mobileWorkspacePages(workspace: WorkspaceId)` and typed page/action identifiers for the shell dock.

- [ ] **Step 1: Write the failing test**

```ts
expect(mobileWorkspacePages("today").map((item) => item.label)).toEqual([
  "Today", "Goals", "Motives", "Activity",
]);
expect(mobileWorkspacePages("tasks").map((item) => item.label)).toContain("Reminders");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/src/navigation/mobile-workspace-dock.test.ts`

Expected: FAIL because the mobile dock module does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export type MobileWorkspacePage = { label: string; path: string };
export function mobileWorkspacePages(workspace: WorkspaceId): MobileWorkspacePage[] {
  return workspace === "today" ? todayPages : workspace === "tasks" ? taskPages : [];
}
```

Define all five workspace page groups in the module, including the existing Finance section routes.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/web/src/navigation/mobile-workspace-dock.test.ts`

Expected: PASS.

### Revision: stable navigator and account utility

- Keep the dock a fixed-width, fixed-viewport control: use `left: 50vw` so
  scroll locking does not shift its physical position.
- Remove duplicate creation actions from the sheet; top app-frame actions own
  creation everywhere.
- Render pages as compact, icon-led shadcn `Item` rows to mirror the desktop
  sidebar's information hierarchy.
- Replace the expanded account section and standalone log-out button with a
  first-name account trigger whose dropdown contains Setup, Settings, and Log out.

### Task 6: Make the mobile dock legible and normalize the action sheet

**Files:**
- Modify: `apps/web/src/components/mobile-workspace-dock.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/app.test.tsx`

**Interfaces:**
- Consumes: the existing typed workspace definitions, `WorkspaceIcon`, shadcn
  `Sheet`, `ItemGroup`, `Item`, and `Button` primitives.
- Produces: a current-workspace trigger that opens the five-workspace chooser,
  plus semantically separated navigation and action content in the sheet.

- [ ] **Step 1: Write the failing test**

```tsx
expect(screen.getByRole("button", { name: "Switch workspace" })).toHaveTextContent("Today at a Glance");
expect(screen.queryByRole("link", { name: "Calendar" })).not.toBeInTheDocument();
await browser.click(screen.getByRole("button", { name: "Workspace actions" }));
expect(screen.getByRole("button", { name: "New task" })).toHaveAttribute("data-variant", "default");
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm vitest run apps/web/src/app.test.tsx --testNamePattern="mobile workspace dock"`

Expected: FAIL because the dock still has five direct links and the sheet shares custom row styling with Buttons.

- [ ] **Step 3: Implement the mobile flow**

Use a labelled Button and DropdownMenu for the workspace trigger. Render page
and account destinations through `ItemGroup`/`Item` links; render the primary
action separately as a default Button and secondary actions as ghost Buttons.
Remove the shared link-and-button foreground and sizing CSS override.

- [ ] **Step 4: Run focused verification**

Run: `pnpm vitest run apps/web/src/app.test.tsx --testNamePattern="mobile workspace dock|organizes and opens the full navigation" && pnpm --filter @personal-os/web typecheck`

Expected: PASS.

### Task 7: Stabilize dock geometry and workspace orientation

**Files:**
- Modify: `apps/web/src/navigation/manifest.ts`
- Modify: `apps/web/src/components/mobile-workspace-dock.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/app.test.tsx`

- [ ] Add stable, purpose-oriented workspace descriptions to the shared
  manifest and render them as the second line of every mobile workspace menu
  item.
- [ ] Make the dock a fixed-width two-column grid: a full-width ghost workspace
  trigger and a fixed 48 px Actions bubble. Remove trigger selection styling
  that adds another surface or border state.
- [ ] Verify the focused mobile dock test, typecheck, and production build.

### Task 2: Compose the mobile dock and action sheet

**Files:**
- Create: `apps/web/src/components/mobile-workspace-dock.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app.test.tsx`

**Interfaces:**
- Consumes: `workspaceDefinitions`, `workspaceForLocation`, `mobileWorkspacePages`, current pathname, and shell action callbacks.
- Produces: `MobileWorkspaceDock` with `onAction(actionId)` and `onNavigate()` callbacks.

- [ ] **Step 1: Write the failing test**

```tsx
expect(screen.getByRole("navigation", { name: "Workspace dock" })).toBeInTheDocument();
expect(screen.queryByRole("button", { name: "Open Navigation" })).not.toBeInTheDocument();
await browser.click(screen.getByRole("button", { name: "Workspace actions" }));
expect(screen.getByRole("dialog", { name: "Today actions" })).toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/src/app.test.tsx --testNamePattern="mobile workspace dock"`

Expected: FAIL because the dock and dialog do not exist.

- [ ] **Step 3: Write minimal implementation**

```tsx
<nav aria-label="Workspace dock">
  {workspaceDefinitions.map((workspace) => <NavLink to={workspace.path} />)}
  <Button aria-label="Workspace actions" onClick={() => setOpen(true)} />
</nav>
```

Use the existing modal Sheet primitive for the action sheet. Render page links and action rows from the active workspace. Wire actions to existing editor setters and existing Mail/Finance callbacks; close the sheet first.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/web/src/app.test.tsx --testNamePattern="mobile workspace dock"`

Expected: PASS.

### Task 3: Replace the mobile drawer layout and document the rule

**Files:**
- Modify: `apps/web/src/styles.css`
- Modify: `docs/design/system.md`
- Modify: `docs/design/pages/workspace-switching.md`
- Modify: `.agents/skills/personal-os-qa/references/shell-and-switching.md`

**Interfaces:**
- Consumes: `.workspace-dock`, `.workspace-dock__actions`, and `.workspace-dock-sheet` class names from Task 2.
- Produces: safe-area-aware mobile dock layout and QA contract.

- [ ] **Step 1: Write the failing test**

```tsx
window.innerWidth = 1280;
renderApp("/today");
expect(screen.queryByRole("navigation", { name: "Workspace dock" })).not.toBeInTheDocument();
expect(screen.getByRole("complementary", { name: "Today Sidebar" })).toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/src/app.test.tsx --testNamePattern="desktop keeps the workspace sidebar"`

Expected: FAIL until the dock is conditionally responsive in the test environment.

- [ ] **Step 3: Write minimal implementation**

```css
@media (max-width: 900px) {
  .workspace-dock { display: flex; }
  .sidebar, .sidebar-trigger--floating { display: none; }
  .workspace { padding-bottom: calc(76px + env(safe-area-inset-bottom)); }
}
```

Keep the dock fixed, centred, and above `env(safe-area-inset-bottom)`. Update design and QA documentation with its selection, sheet, and breakpoint contract.

- [ ] **Step 4: Run focused verification**

Run: `pnpm vitest run apps/web/src/navigation/mobile-workspace-dock.test.ts apps/web/src/app.test.tsx --testNamePattern="mobile workspace dock|desktop keeps the workspace sidebar"`

Expected: PASS.

### Task 4: Verify responsive and production behaviour

**Files:**
- Modify only if verification reveals a defect in Task 2 or Task 3.

- [ ] **Step 1: Run static checks**

Run: `pnpm lint --filter @personal-os/web && pnpm --filter @personal-os/web typecheck && pnpm --filter @personal-os/web build`

Expected: all commands exit successfully.

- [ ] **Step 2: Run browser QA**

At 390x844, verify the six-control dock, direct Tasks navigation, the Tasks action sheet, Escape dismissal, and no floating favicon trigger. At 1280x800, verify the sidebar and switcher remain and the dock is absent.

- [ ] **Step 3: Commit**

Do not commit in this detached, pre-existing dirty worktree. Report the exact verification evidence and preserve all uncommitted work.

### Task 5: Refine dock hierarchy and icon geometry

**Files:**
- Modify: `apps/web/src/components/mobile-workspace-dock.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/app.test.tsx`

**Interfaces:**
- Consumes: `WorkspaceDefinition` and the existing `WorkspaceIcon` geometry.
- Produces: a framed `Home` Today control and an Actions bubble that is a sibling of, rather than part of, the workspace pill.

- [ ] **Step 1: Write the failing test**

```tsx
expect(screen.getByRole("link", { name: "Today at a Glance" })).toHaveClass("workspace-dock__workspace--today");
expect(screen.getByRole("button", { name: "Workspace actions" })).toHaveClass("workspace-dock__actions--bubble");
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm vitest run apps/web/src/app.test.tsx --testNamePattern="mobile workspace dock"`

Expected: FAIL because the new identity and action-bubble classes do not exist.

- [ ] **Step 3: Implement the visual composition**

Render `Home` inside a neutral `.workspace-dock__identity-frame` for Today,
give every dock icon the same 16 px glyph size, and move the action button out
of `.workspace-dock__workspaces` so CSS can position it as a separate bubble.

- [ ] **Step 4: Run focused verification**

Run: `pnpm vitest run apps/web/src/app.test.tsx --testNamePattern="mobile workspace dock" && pnpm --filter @personal-os/web typecheck`

Expected: PASS.
