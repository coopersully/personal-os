# Workspace Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Today, Calendar, Tasks, Mail, and Finances as ilo's only workspaces, with stable sidebars and a full-page Account utility.

**Architecture:** An Integration-owned route manifest resolves every authenticated route to a workspace or `account-utility`. The shell selects a single sidebar from that manifest. Feature modules export their local sidebar composition; they never select the global sidebar.

**Tech Stack:** React 19, React Router 7, TypeScript, Testing Library/Vitest, Playwright, shadcn Sidebar.

## Global Constraints

- The only workspace IDs are `today`, `calendar`, `tasks`, `mail`, and `finances`.
- Today is neutral, is excluded from `AccountSetupWorkspace`, and owns Goals, Motives, and Activity.
- Tasks owns both `/tasks` and `/reminders`.
- The switcher and previews contain exactly the five workspace defaults.
- Settings, setup, security, connections, invitations, agent access, and automations are `account-utility` routes.
- Account utility validates `returnTo` as a workspace-owned internal route and otherwise returns to `/today`.
- Integration owns the manifest, app shell, switcher, responsive navigation, and utility entry wiring.

---

### Task 1: Add an explicit navigation-owner manifest

**Files:** Create `apps/web/src/navigation/manifest.ts` and `apps/web/src/navigation/manifest.test.ts`; modify `apps/web/src/components/workspace-identity.tsx`, `apps/web/src/components/workspace-identity.test.tsx`, and `apps/web/src/app.tsx`.

**Interfaces:** Produce `WorkspaceId`, `workspaceDefinitions`, `NavigationOwner`, `navigationOwnerForLocation(pathname)`, and `workspaceForLocation(pathname)`.

- [ ] **Step 1: Write the failing test**

```ts
expect(navigationOwnerForLocation("/goals")).toEqual({ kind: "workspace", workspace: "today" });
expect(navigationOwnerForLocation("/reminders")).toEqual({ kind: "workspace", workspace: "tasks" });
expect(navigationOwnerForLocation("/settings")).toEqual({ kind: "account-utility" });
```

- [ ] **Step 2: Verify RED** — run `pnpm vitest run apps/web/src/navigation/manifest.test.ts`; expect failure because the manifest does not exist.
- [ ] **Step 3: Implement the manifest**

```ts
export type NavigationOwner =
  | { kind: "workspace"; workspace: WorkspaceId }
  | { kind: "account-utility" };
```

Use most-specific child-route matching and retain the current four colored `WorkspaceIcon` identities separately from neutral Today.
- [ ] **Step 4: Verify GREEN** — run `pnpm vitest run apps/web/src/navigation/manifest.test.ts apps/web/src/components/workspace-identity.test.tsx`; expect all five IDs in switcher order and no Today setup selection.
- [ ] **Step 5: Commit** — stage the manifest, identity, and shell wiring; commit `refactor: define workspace navigation ownership`.

### Task 2: Compose one stable sidebar per workspace

**Files:** Create `apps/web/src/navigation/workspace-sidebar.tsx` and `apps/web/src/navigation/workspace-sidebar.test.tsx`; modify `apps/web/src/features/tasks/page.tsx`, `apps/web/src/features/reminders/page.tsx`, and `apps/web/src/app.tsx`.

**Interfaces:** Produce `WorkspaceSidebar({ owner, pathname, search, user, onNavigate })` and render accessible names Today Sidebar, Calendar Sidebar, Tasks Sidebar, Mail Sidebar, and Finances Sidebar.

- [ ] **Step 1: Write the failing test**

```tsx
setup("/today");
await user.click(screen.getByRole("link", { name: "Goals" }));
expect(screen.getByRole("complementary", { name: "Today Sidebar" })).toBeInTheDocument();
```

Add the matching `/tasks` → `/reminders` assertion for `Tasks Sidebar`.
- [ ] **Step 2: Verify RED** — run `pnpm vitest run apps/web/src/app.test.tsx --testNamePattern="keeps workspace sidebars stable"`; expect failure because current `sidebarMode` changes identity.
- [ ] **Step 3: Implement stable composition** — make Today contain Today, Goals, Motives, Activity; make Tasks contain task views and Reminders; select composition only from `WorkspaceId`; remove child-route sidebar branches.
- [ ] **Step 4: Verify GREEN** — run `pnpm vitest run apps/web/src/navigation/workspace-sidebar.test.tsx apps/web/src/app.test.tsx --testNamePattern="keeps workspace sidebars stable"`; expect stable owner and selected row.
- [ ] **Step 5: Commit** — stage changed shell, task/reminder, and navigation files; commit `refactor: keep workspace sidebars stable across child routes`.

### Task 3: Make the switcher and previews manifest-driven

**Files:** Modify `apps/web/src/app.tsx`, `apps/web/src/app.test.tsx`, and `docs/design/pages/workspace-switching.md`.

**Interfaces:** Consume ordered `workspaceDefinitions`; replace `workspaceShortcuts`, `workspaceForPath`, and route-direction lookup.

- [ ] **Step 1: Write the failing test**

```tsx
const menu = screen.getByRole("menu", { name: "Switch workspace" });
expect(within(menu).getAllByRole("menuitem")).toHaveLength(5);
expect(within(menu).queryByRole("menuitem", { name: "Settings" })).not.toBeInTheDocument();
```

- [ ] **Step 2: Verify RED** — run `pnpm vitest run apps/web/src/app.test.tsx --testNamePattern="organizes and opens the full navigation"`; expect failure until the legacy shortcut array is removed.
- [ ] **Step 3: Implement** — derive menu order, current workspace, page direction, and preview warming from the manifest. Keep `warmWorkspacePreview` exhaustive only for the five default routes; never preview an account-utility route.
- [ ] **Step 4: Verify GREEN** — run `pnpm vitest run apps/web/src/app.test.tsx --testNamePattern="(organizes and opens the full navigation|warms workspace caches|moves workspace pages)"`; expect five production route previews.
- [ ] **Step 5: Commit** — stage shell, tests, and workspace-switching specification; commit `refactor: drive workspace switching from ownership manifest`.

### Task 4: Extract a full-page Account utility

**Files:** Create `apps/web/src/features/account-utility/frame.tsx` and `apps/web/src/features/account-utility/frame.test.tsx`; modify `apps/web/src/app.tsx`, `apps/web/src/features/settings/manifest.ts`, and `apps/web/src/styles.css`.

**Interfaces:** Produce `AccountUtilityFrame({ children, returnTo, user })`, labelled `Account utility`, with local settings navigation and `Back to <workspace>`.

- [ ] **Step 1: Write the failing test**

```tsx
setup("/mail");
await user.click(screen.getByRole("menuitem", { name: "Settings" }));
expect(screen.getByRole("main", { name: "Account utility" })).toBeInTheDocument();
expect(screen.queryByRole("button", { name: "Switch workspace" })).not.toBeInTheDocument();
expect(screen.getByRole("link", { name: "Back to Mail" })).toHaveAttribute("href", "/mail");
```

- [ ] **Step 2: Verify RED** — run `pnpm vitest run apps/web/src/features/account-utility/frame.test.tsx`; expect failure because Settings uses the application sidebar.
- [ ] **Step 3: Implement** — have account-menu links append `returnTo` only from workspace-owned routes. Validate it through `navigationOwnerForLocation`; use `/today` for missing/invalid values. Move `settingsNavigation` and `SettingsSidebarNavigation` into the frame. Route `/settings` through it; test `/setup` before moving its onboarding layout through the same frame.
- [ ] **Step 4: Verify GREEN** — run `pnpm vitest run apps/web/src/features/account-utility/frame.test.tsx apps/web/src/app.test.tsx --testNamePattern="(account utility|settings return)"`; expect working deep links, no switcher, and restored valid return path.
- [ ] **Step 5: Commit** — stage account-utility, settings manifest, shell, and styles; commit `feat: add full-page account utility`.

### Task 5: Align standards and acceptance coverage

**Files:** Modify `docs/design/foundations.md`, `docs/design/system.md`, `docs/design/pages/today.md`, `docs/design/pages/commitments.md`, `docs/design/pages/activity.md`, `docs/engineering/feature-ownership.md`, `.agents/skills/personal-os-frontend/SKILL.md`, `.agents/skills/personal-os-qa/references/shell-and-switching.md`, and `e2e/product.spec.ts`.

**Interfaces:** Document and test the exact manifest contract from the approved workspace ownership design.

- [ ] **Step 1: Write the failing Playwright assertions**

```ts
await page.goto("/today");
await page.getByRole("link", { name: "Goals" }).click();
await expect(page.getByRole("complementary", { name: "Today Sidebar" })).toBeVisible();
```

Add the `/tasks` → `/reminders` `Tasks Sidebar` case and Account utility return case.
- [ ] **Step 2: Verify RED** — run `pnpm playwright test e2e/product.spec.ts --project=desktop --project=mobile`; expect current sidebar replacement to fail.
- [ ] **Step 3: Update durable contracts** — copy the exact terms from `docs/superpowers/specs/2026-08-10-workspace-ownership-design.md`: five workspace limit, neutral Today, account-utility boundary, Integration-owned manifest, and required feature owner metadata.
- [ ] **Step 4: Verify GREEN** — run the same desktop/mobile Playwright command; expect stable sidebars, utility returns, keyboard navigation, and no horizontal overflow at 390 × 844. Then run `pnpm verify`; expect PASS.
- [ ] **Step 5: Commit** — stage all standards and acceptance files; commit `docs: define workspace and account utility ownership`.

## Plan self-review

- Tasks 1–3 cover explicit ownership, five stable sidebars, and five-only previews.
- Task 4 covers full-page administration, deep links, and safe return targets.
- Task 5 covers each durable source named in the approved spec and desktop/mobile regression evidence.
- The plan uses `WorkspaceId`, `NavigationOwner`, and `navigationOwnerForLocation` consistently; account utility never enters `workspaceDefinitions`.
