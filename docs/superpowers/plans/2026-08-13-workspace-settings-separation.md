# Workspace Settings Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate agent authority from domain setup by making Workspace access access-only and adding domain-owned Mail, Finances, Calendar, and Tasks pages to Settings.

**Architecture:** Keep account-level routing and navigation in `app.tsx`, while the assistant integration surface composes domain-owned readiness and setup adapters. Reuse one workspace Settings shell for status, setup, diagnostics, and operational links; extract Finance profile/guidance into one reusable domain component so the old operational route can redirect without duplicating mutations.

**Tech Stack:** React 19, React Router, TanStack Query, Vitest, Testing Library, TypeScript, existing shadcn/reicon UI primitives.

## Global Constraints

- Workspace access reports only observed agent authority and capability boundaries.
- Configuration approvals happen in Settings; transaction, message, event, and task-item reviews remain in their operational workspace.
- Completed workspaces never keep showing **Let the agent set up Ilo**.
- Failed or unavailable queries never become zero, ready, or not-allowed claims.
- Existing domain APIs and mutations remain authoritative; Settings does not duplicate persistence logic.
- The layout must work at 320 px with visible text labels and no horizontal overflow.
- Only `@/components/icons` may supply interface icons.

---

### Task 1: Separate Workspace access from workspace setup

**Files:**
- Modify: `apps/web/src/features/settings/agent-access.tsx`
- Modify: `apps/web/src/features/settings/agent-access.test.tsx`

**Interfaces:**
- Consumes: `setupDomainOptions`, `domainCapability(...)`, and `connectedHostAuthorities(...)` already defined by the agent-access feature.
- Produces: `WorkspaceAccessSettings` as an access-only surface and `WorkspaceSettings({ domain }: { domain: SetupDomain })` as the domain Settings shell.

- [ ] **Step 1: Write failing access-only and workspace-shell tests**

Add a Settings destination branch for the four workspace sections and assertions equivalent to:

```tsx
expect(screen.getByRole("heading", { name: "Workspace access" })).toBeVisible();
expect(screen.getByText("Mail").closest('[data-workspace-access-row="mail"]')).toHaveTextContent(
  "Can read and prepare changes",
);
expect(screen.queryByText("Mail readiness")).not.toBeInTheDocument();
expect(screen.queryByText("Let the agent set up Ilo")).not.toBeInTheDocument();

renderSettings("/settings?section=finances");
expect(await screen.findByRole("heading", { name: "Finances settings" })).toBeVisible();
expect(screen.getByText("Action required")).toBeVisible();
expect(screen.getByText("Finances readiness")).toBeVisible();
```

- [ ] **Step 2: Run the focused test and confirm the old combined surface fails**

Run: `pnpm exec vitest run apps/web/src/features/settings/agent-access.test.tsx`

Expected: FAIL because workspace-specific destinations and access-only rows do not exist.

- [ ] **Step 3: Introduce explicit view ownership**

Change the component boundary to:

```tsx
export function WorkspaceAccessSettings() {
  return <AgentAccessSettings view="access" />;
}

export function WorkspaceSettings({ domain }: { domain: SetupDomain }) {
  return <AgentAccessSettings domain={domain} view="settings" />;
}

function AgentAccessSettings({
  domain,
  view,
}: {
  domain?: SetupDomain;
  view: "access" | "connections" | "settings";
}) {
  // Existing queries are enabled only for the view that consumes them.
}
```

The access view renders four rows with observed host read/write authority, plain-language capability boundaries, and a Connected agents link. It must not enable setup, readiness, attention, material, or setup-plan queries.

- [ ] **Step 4: Add the workspace Settings status and conditional setup shell**

Render a domain heading, an action summary derived from query state and the current setup step, the existing `DomainReadinessPanel`, and an operational-review link. Render setup protocol UI only when `setupPlan.data?.status !== "complete"`:

```tsx
const settingsStatus = selectedDomainError
  ? { label: "Unavailable", description: `${selectedLabel} settings could not be loaded.` }
  : setupPlan.data?.status === "complete"
    ? { label: "No settings action needed", description: `${selectedLabel} setup is complete.` }
    : currentStep?.owner === "person"
      ? { label: "Action required", description: setupPlan.data?.nextAction ?? currentStep.title }
      : { label: "Setup in progress", description: setupPlan.data?.nextAction ?? currentStep?.title };
```

Use `/reviews?workspace=${selectedDomain}` for a bounded operational summary and retain existing domain-owned readiness actions.

- [ ] **Step 5: Run the focused tests**

Run: `pnpm exec vitest run apps/web/src/features/settings/agent-access.test.tsx`

Expected: PASS for access-only content, person/agent ownership, completed setup suppression, readiness disclosure, Mail rule review, and unavailable states.

- [ ] **Step 6: Commit the independently testable separation**

```bash
git add apps/web/src/features/settings/agent-access.tsx apps/web/src/features/settings/agent-access.test.tsx
git commit -m "feat: separate workspace access from setup"
```

### Task 2: Move Finance guidance and profile into Settings

**Files:**
- Create: `apps/web/src/features/finances/settings.tsx`
- Create: `apps/web/src/features/finances/settings.test.tsx`
- Modify: `apps/web/src/features/finances/page.tsx`
- Modify: `apps/web/src/features/finances/navigation.tsx`

**Interfaces:**
- Consumes: `api.getFinanceGuidedSetup`, `api.getDomainProfile("finances")`, `api.upsertDomainProfile`, `api.getFinanceProfile`, and `api.updateFinanceProfile`.
- Produces: `FinanceSettings` with the single authoritative guidance activation and financial-profile form.

- [ ] **Step 1: Write failing Finance Settings tests**

Cover draft, active-plus-draft, saving, success invalidation, and errors:

```tsx
renderFinanceSettings();
expect(await screen.findByText("Draft activation")).toBeVisible();
await user.click(screen.getByRole("button", { name: "Activate guidance" }));
expect(mocks.upsertDomainProfile).toHaveBeenCalledWith(
  expect.objectContaining({ domain: "finances", expectedVersion: 1, status: "active" }),
);
expect(screen.getByText("monthly_review: true")).toBeVisible();
expect(screen.queryByText(/scheduled/i)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run: `pnpm exec vitest run apps/web/src/features/finances/settings.test.tsx`

Expected: FAIL because `FinanceSettings` does not exist.

- [ ] **Step 3: Extract the Finance-owned component and hooks**

Move the existing `FinanceAgentGuidancePanel`, `FinanceGuidanceDetails`, `FinancialProfilePanel`, profile form state, and their four queries/mutations into `settings.tsx`. Export:

```tsx
export function FinanceSettings() {
  // Finance-owned loading, activation, profile editing, invalidation, and feedback.
}
```

On activation success invalidate `domain-profile/finances`, `finance-guided-setup`, `finances/guided-setup`, `ilo-setup-plan/finances`, and `assistant-setup-status`. Label `monthly_review` and related preferences as guidance, never as a persisted schedule.

- [ ] **Step 4: Remove the duplicate operational profile surface**

Remove `profile` from `FinanceSection` and Finance sidebar navigation. Delete the profile-only rendering and now-unused profile hooks from `FinancesPage`; preserve `getFinanceProfile` where overview or cash-flow still consumes it.

- [ ] **Step 5: Run Finance tests**

Run: `pnpm exec vitest run apps/web/src/features/finances/settings.test.tsx apps/web/src/app.test.tsx`

Expected: PASS for Finance Settings activation and existing Finance operational sections.

- [ ] **Step 6: Commit Finance ownership**

```bash
git add apps/web/src/features/finances/settings.tsx apps/web/src/features/finances/settings.test.tsx apps/web/src/features/finances/page.tsx apps/web/src/features/finances/navigation.tsx
git commit -m "feat: move finance configuration into settings"
```

### Task 3: Wire workspace navigation, Calendar sources, and compatibility routes

**Files:**
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `WorkspaceSettings`, `FinanceSettings`, and the existing Calendar selection editor.
- Produces: Settings section IDs `mail`, `finances`, `calendar`, and `tasks`; redirects from `calendars` and `/finances/profile`.

- [ ] **Step 1: Write failing navigation and redirect tests**

Add assertions for the exact groups and routes:

```tsx
expect(within(settingsNavigation).getByRole("link", { name: "Mail" })).toHaveAttribute(
  "href",
  "/settings?section=mail",
);
expect(within(settingsNavigation).queryByRole("link", { name: "Calendars" })).toBeNull();

setup("/settings?section=calendars");
expect(await screen.findByLabelText("Current location")).toHaveTextContent(
  "/settings?section=calendar",
);

setup("/finances/profile");
expect(await screen.findByLabelText("Current location")).toHaveTextContent(
  "/settings?section=finances#guidance",
);
```

- [ ] **Step 2: Run route tests and confirm failure**

Run: `pnpm exec vitest run apps/web/src/app.test.tsx`

Expected: FAIL because the new section IDs and redirects are not wired.

- [ ] **Step 3: Update Settings navigation and page composition**

Change the navigation groups to `Sources` with Connections, `Workspaces` with Mail/Finances/Calendar/Tasks, and `Agents` with the two agent pages. Compose each domain page as:

```tsx
{section === "mail" ? <WorkspaceSettings domain="mail" /> : null}
{section === "finances" ? (
  <><WorkspaceSettings domain="finances" /><FinanceSettings /></>
) : null}
{section === "calendar" ? (
  <><WorkspaceSettings domain="calendar" /><CalendarsSettings setEditor={setEditor} /></>
) : null}
{section === "tasks" ? <WorkspaceSettings domain="tasks" /> : null}
```

Use `<Navigate replace>` for `section=calendars` and the `/finances/profile` route. Rename the Calendar source panel heading to **Calendar sources** and retain all existing selection/create/delete behavior.

- [ ] **Step 4: Adjust flat responsive styles**

Add only the selectors needed for access rows and workspace action summary. Keep labels visible and use the existing Settings breakpoints to stack actions below copy at narrow widths.

- [ ] **Step 5: Run focused web validation**

Run: `pnpm exec vitest run apps/web/src/features/settings/agent-access.test.tsx apps/web/src/features/finances/settings.test.tsx apps/web/src/app.test.tsx`

Run: `pnpm --filter @personal-os/web typecheck`

Expected: all commands PASS.

- [ ] **Step 6: Commit navigation and compatibility**

```bash
git add apps/web/src/app.tsx apps/web/src/app.test.tsx apps/web/src/styles.css
git commit -m "feat: add workspace settings navigation"
```

### Task 4: Browser acceptance for workspace Settings

**Files:**
- Modify if failures require it: `apps/web/src/features/settings/agent-access.tsx`
- Modify if failures require it: `apps/web/src/features/finances/settings.tsx`
- Modify if failures require it: `apps/web/src/app.tsx`
- Modify if failures require it: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: the registered local runtime and repository fixture data.
- Produces: desktop/mobile evidence for the implemented Settings hierarchy.

- [ ] **Step 1: Start the registered runtime**

Run: `pnpm env:start`

Expected: attached runtime reports web, API, MCP, and database ready on this worktree's registered ports.

- [ ] **Step 2: Exercise desktop behavior**

Open Settings and verify all four workspace pages, access-only Workspace access, Finance guidance activation visibility, Calendar source controls, operational links, and absence of completed setup prompts.

- [ ] **Step 3: Exercise 320 px behavior and keyboard flow**

Verify the mobile Settings navigation exposes every text label, action summaries stack without overflow, Review checks opens and closes by keyboard, and redirects restore useful focus.

- [ ] **Step 4: Run the web suite after any QA corrections**

Run: `pnpm exec vitest run apps/web/src && pnpm --filter @personal-os/web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit only if QA required corrections**

```bash
git add apps/web/src
git commit -m "fix: refine workspace settings states"
```
