# nohmi Setup Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dense setup wizard with a centered, mobile-first nohmi setup experience that uses whole-card workspace selection, responsive provider connection surfaces, explicit skip confirmation, and a concise final destination choice.

**Architecture:** Keep the existing `SetupPage` step state, React Query mutations, OAuth, Apple, and Plaid integrations intact. Extract setup-only presentation into focused components under `apps/web/src/features/setup/`, use the existing shared `ResponsiveDialog` for desktop Dialog/mobile Drawer behavior, and keep the canonical public name in `apps/web/src/brand.ts`.

**Tech Stack:** React 19, TypeScript, React Router, TanStack Query, shadcn-derived UI primitives, Radix/Base UI, vaul Drawer, Testing Library, Vitest, CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-09-01-nohmi-setup-experience-design.md`

## Global Constraints

- The public product name is always `nohmi`; never render `Nomi`, `Nohmi`, or product-name `Ilo` in current user-facing copy.
- Preserve compatibility identifiers including `personal-os`, `ilo://`, `ui://ilo`, `$ilo-setup`, migrations, headers, persisted keys, API property names, and historical documentation.
- Preserve the current setup step sequence, setup persistence payloads, Google OAuth behavior, Apple credential flow, Plaid Link flow, workspace identifiers, and service mappings.
- Reuse `apps/web/src/components/responsive-dialog.tsx`; do not add another modal abstraction or dependency.
- Use icons only through `@/components/icons` and provider artwork only through `BrandMark` in `@/components/brand-marks`.
- Setup remains flat: no decorative shadows, glass, blur, or gradients. The bottom canvas-to-transparent navigation fade is the only functional gradient exception.
- Support a 320-pixel viewport, safe-area insets, keyboard focus, increased text size, and reduced motion.
- Preserve user-owned dirty-worktree changes. Stage and commit only the exact files named by each task.

## File map

- `apps/web/src/brand.ts`: canonical public name and promise.
- `apps/web/src/components/brand-marks.tsx`: public nohmi mark plus third-party provider marks.
- `apps/web/src/features/setup/setup-frame.tsx`: setup viewport, progress header, centered body, and arrow navigation.
- `apps/web/src/features/setup/workspace-setup-grid.tsx`: whole-card semantic workspace selection.
- `apps/web/src/features/setup/connection-list.tsx`: provider/institution list and add trigger.
- `apps/web/src/features/setup/provider-connection-step.tsx`: shared provider page and continue-without-account confirmation.
- `apps/web/src/features/setup/page.tsx`: setup orchestration and provider-specific form bodies.
- `apps/web/src/styles.css`: setup geometry, states, edge fade, and responsive behavior.
- `apps/web/src/app.test.tsx`: full setup routing, persistence, provider, and completion coverage.

---

### Task 1: Enforce the lowercase nohmi public identity

**Files:**
- Modify: `apps/web/src/brand.ts`
- Modify: `apps/web/src/brand.test.ts`
- Modify: `apps/web/src/components/brand-marks.tsx`
- Modify: `apps/web/src/components/brand-mark.test.tsx`
- Modify: `apps/web/src/components/brand-marks.test.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/index.html`
- Modify: `apps/web/src/components/icons.ts`
- Modify: `apps/web/src/components/logo-mark.tsx`
- Modify: `apps/web/src/features/activity/page.tsx`
- Modify: `apps/web/src/features/agent-access/readiness.ts`
- Modify: `apps/web/src/features/agent-access/readiness.test.ts`
- Modify: `apps/web/src/features/calendar/agent-access.ts`
- Modify: `apps/web/src/features/calendar/stewardship-page.tsx`
- Modify: `apps/web/src/features/calendar/stewardship-page.test.tsx`
- Modify: `apps/web/src/features/connections/authorization-outcome.tsx`
- Modify: `apps/web/src/features/connections/health.tsx`
- Modify: `apps/web/src/features/connections/health.test.tsx`
- Modify: `apps/web/src/features/finances/agent-access.ts`
- Modify: `apps/web/src/features/mail/agent-access.ts`
- Modify: `apps/web/src/features/mail/mail.tsx`
- Modify: `apps/web/src/features/reminders/agent-access.ts`
- Modify: `apps/web/src/features/reviews/page.test.tsx`
- Modify: `apps/web/src/features/settings/agent-access.tsx`
- Modify: `apps/web/src/features/settings/agent-access.test.tsx`
- Modify: `apps/web/src/features/tasks/agent-access.ts`
- Modify: `apps/api/src/agent-access-work-items.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.integration.test.ts`
- Modify: `apps/api/src/assistant-service.ts`
- Modify: `apps/api/src/calendar-proposal.ts`
- Modify: `apps/api/src/calendar-provider-effects.ts`
- Modify: `apps/api/src/calendar-service.integration.test.ts`
- Modify: `apps/api/src/connector-service.ts`
- Modify: `apps/api/src/connector-service.integration.test.ts`
- Modify: `apps/api/src/connector-sync-health.ts`
- Modify: `apps/api/src/connector-sync-health.test.ts`
- Modify: `apps/api/src/email-delivery.test.ts`
- Modify: `apps/api/src/finance-action-service.integration.test.ts`
- Modify: `apps/api/src/finance-period-review-service.ts`
- Modify: `apps/api/src/finance-provider-item-service.integration.test.ts`
- Modify: `apps/api/src/finance-provider-item-sync-service.ts`
- Modify: `apps/api/src/finance-service.ts`
- Modify: `apps/api/src/finance-service.integration.test.ts`
- Modify: `apps/api/src/mail-service.ts`
- Modify: `apps/api/src/openapi.ts`
- Modify: `apps/api/src/pinterest-service.ts`
- Modify: `apps/api/src/pinterest-service.test.ts`
- Modify: `apps/api/src/qa-fixtures.ts`
- Modify: `apps/api/src/reminder-service.ts`
- Modify: `apps/api/src/routes/assistant.test.ts`
- Modify: `apps/api/src/weather-service.ts`
- Modify: `apps/api/src/x-bookmarks-service.ts`
- Modify: `apps/api/src/x-bookmarks-service.integration.test.ts`
- Modify: `packages/connectors/src/failures.ts`
- Modify: `packages/connectors/src/icloud.ts`
- Modify: `packages/connectors/src/icloud.test.ts`
- Modify: `packages/domain/src/finance.ts`
- Modify: `docs/design/system.md`
- Modify: `docs/design/pages/setup.md`

**Interfaces:**
- Produces: `BRAND_NAME: "nohmi"` and `NohmiBrandMark(props: { auth?: boolean; compact?: boolean }): JSX.Element`.
- Preserves: `BrandMark`, `brandTitle`, `hasBrandMark`, `BRAND_PROMISE`, and compatibility identifiers containing lowercase `ilo`.

- [ ] **Step 1: Make the public identity tests fail on the current casing**

Update `apps/web/src/brand.test.ts` and `apps/web/src/components/brand-mark.test.tsx` to require the exact lowercase identity:

```tsx
describe("nohmi brand", () => {
  it("keeps the public identity stable", () => {
    expect(BRAND_NAME).toBe("nohmi");
    expect(BRAND_PRONUNCIATION).toBe("know me");
    expect(BRAND_PROMISE).toBe("know what matters.");
  });
});

it("renders the lowercase wordmark", () => {
  render(<NohmiBrandMark />);
  expect(screen.getByText("nohmi")).toHaveClass("brand-wordmark");
});
```

- [ ] **Step 2: Run the focused identity tests and verify the old casing fails**

Run:

```bash
pnpm vitest run apps/web/src/brand.test.ts apps/web/src/components/brand-mark.test.tsx apps/web/src/components/brand-marks.test.tsx
```

Expected: FAIL because `BRAND_NAME` is `Nomi` and `NohmiBrandMark` is not exported.

- [ ] **Step 3: Correct the canonical name and mark API**

Change the constant and exported component, then update all imports:

```tsx
export const BRAND_NAME = "nohmi";

export function NohmiBrandMark({
  auth = false,
  compact = false,
}: {
  auth?: boolean;
  compact?: boolean;
}) {
  // Keep the existing mark and orbit implementation; only the public symbol name changes.
}
```

Update the document title to `<title>nohmi</title>`. Replace current user-facing product copy that says `Nomi` with `nohmi` in web, API response copy, connector failure copy, fixtures intended for display, and matching tests. Preserve strings such as `$ilo-setup`, `get_ilo_setup`, `ilo://`, internal type/function names, and historical docs whose subject is explicitly the former system.

Update the design system contract to say the name is `nohmi`, always lowercase. Update setup documentation to match the approved spec rather than the superseded wordmark/footer layout.

- [ ] **Step 4: Verify public-source casing and focused tests**

Run:

```bash
pnpm vitest run apps/web/src/brand.test.ts apps/web/src/components/brand-mark.test.tsx apps/web/src/components/brand-marks.test.tsx apps/web/src/app.test.tsx
rg -n '\b(Nomi|Nohmi)\b' apps/web/src apps/web/index.html apps/api/src packages docs/design/system.md docs/design/pages/setup.md
```

Expected: tests PASS. Remaining search results are limited to explicit compatibility/history explanations or test data unrelated to the product, such as an employer named `Nomi Labs`; every current rendered product label is lowercase `nohmi`.

- [ ] **Step 5: Commit only the identity slice**

```bash
git add apps/web/src/brand.ts apps/web/src/brand.test.ts apps/web/src/components/brand-marks.tsx apps/web/src/components/brand-mark.test.tsx apps/web/src/components/brand-marks.test.tsx apps/web/src/app.tsx apps/web/src/app.test.tsx apps/web/index.html apps/web/src/features apps/api/src packages docs/design/system.md docs/design/pages/setup.md
git commit -m "fix: enforce lowercase nohmi identity"
```

### Task 2: Build the compact setup frame and floating navigation

**Files:**
- Create: `apps/web/src/features/setup/setup-frame.tsx`
- Create: `apps/web/src/features/setup/setup-frame.test.tsx`
- Modify: `apps/web/src/features/setup/page.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/app.test.tsx`

**Interfaces:**
- Produces:

```tsx
type SetupFrameProps = {
  back?: () => void;
  children: React.ReactNode;
  continueDisabled?: boolean;
  currentStep: number;
  exit: () => void;
  forward?: () => void;
  pending?: boolean;
  totalSteps: number;
};

export function SetupFrame(props: SetupFrameProps): React.ReactElement;
```

- Consumes: `Button`, `ArrowLeftIcon`, and `ArrowRightIcon` from the existing shadcn/icon registries.
- Produces DOM hooks: `.setup-shell`, `.setup-header`, `.setup-progress__track`, `.setup-stage`, `.setup-navigation`, and `.setup-navigation__fade`.

- [ ] **Step 1: Write focused failing frame tests**

Create `setup-frame.test.tsx` with exact behavior:

```tsx
it("renders progress and exit in one header with accessible arrow controls", async () => {
  const back = vi.fn();
  const forward = vi.fn();
  render(
    <SetupFrame back={back} currentStep={2} exit={vi.fn()} forward={forward} totalSteps={6}>
      <h1>Choose workspaces</h1>
    </SetupFrame>,
  );

  expect(screen.getByRole("progressbar", { name: "Setup progress" })).toHaveAttribute(
    "aria-valuenow",
    "2",
  );
  expect(screen.queryByText(/Step 2 of 6|33%/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(back).toHaveBeenCalledOnce();
  expect(forward).toHaveBeenCalledOnce();
});

it("omits navigation controls whose callbacks are absent", () => {
  render(
    <SetupFrame currentStep={1} exit={vi.fn()} totalSteps={6}>
      <h1>Ready</h1>
    </SetupFrame>,
  );
  expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the frame test and verify the component is missing**

Run: `pnpm vitest run apps/web/src/features/setup/setup-frame.test.tsx`

Expected: FAIL because `setup-frame.tsx` does not exist.

- [ ] **Step 3: Implement `SetupFrame` and `SetupNavigation`**

Implement the frame with this composition:

```tsx
export function SetupFrame({
  back,
  children,
  continueDisabled = false,
  currentStep,
  exit,
  forward,
  pending = false,
  totalSteps,
}: SetupFrameProps) {
  return (
    <main className="setup-shell">
      <header className="setup-header">
        <div
          aria-label="Setup progress"
          aria-valuemax={totalSteps}
          aria-valuemin={1}
          aria-valuenow={currentStep}
          className="setup-progress__track"
          role="progressbar"
        >
          <span style={{ transform: `scaleX(${currentStep / totalSteps})` }} />
        </div>
        <Button disabled={pending} onClick={exit} variant="ghost">Exit Setup</Button>
      </header>
      <section className="setup-stage">{children}</section>
      {back || forward ? (
        <nav aria-label="Setup navigation" className="setup-navigation">
          <span aria-hidden="true" className="setup-navigation__fade" />
          {back ? <Button aria-label="Back" disabled={pending} onClick={back} size="icon"><ArrowLeftIcon /></Button> : <span />}
          {forward ? <Button aria-label="Continue" disabled={pending || continueDisabled} onClick={forward} size="icon"><ArrowRightIcon /></Button> : null}
        </nav>
      ) : null}
    </main>
  );
}
```

Use actual `Button` variants already available in `ui/button.tsx`; keep visible focus and 44-pixel targets. Position the navigation above safe-area insets and reserve bottom scroll padding. The fade is a pointer-events-none canvas fade underneath the buttons, not a panel.

- [ ] **Step 4: Migrate `SetupPage` to the frame**

Remove `setup-wordmark`, standalone percentage/step copy, and `SetupFooter`. Pass frame callbacks from `SetupPage` according to the current step:

```tsx
<SetupFrame
  back={currentStep === "welcome" ? undefined : stepBack}
  continueDisabled={currentStep === "workspaces" && selectedWorkspaces.length === 0}
  currentStep={stepIndex + 1}
  exit={exitSetup}
  forward={currentStep === "ready" ? undefined : stepForward}
  pending={save.isPending || checkVerification.isPending}
  totalSteps={steps.length}
>
  <SetupStepContent />
</SetupFrame>
```

Keep provider-specific forward interception for Task 6; in this task, forward continues exactly as the old footer did. The verification forward action remains `check()` rather than blind progress.

- [ ] **Step 5: Run frame and setup integration tests**

Run:

```bash
pnpm vitest run apps/web/src/features/setup/setup-frame.test.tsx apps/web/src/app.test.tsx
pnpm --filter @personal-os/web typecheck
```

Expected: PASS. App tests now query arrow buttons by accessible names rather than visible `Continue`, `Skip Google`, or `Review setup` labels.

- [ ] **Step 6: Commit the setup frame**

```bash
git add apps/web/src/features/setup/setup-frame.tsx apps/web/src/features/setup/setup-frame.test.tsx apps/web/src/features/setup/page.tsx apps/web/src/styles.css apps/web/src/app.test.tsx
git commit -m "feat: add mobile-first setup frame"
```

### Task 3: Replace setup checkboxes with a workspace bento grid

**Files:**
- Create: `apps/web/src/features/setup/workspace-setup-grid.tsx`
- Create: `apps/web/src/features/setup/workspace-setup-grid.test.tsx`
- Modify: `apps/web/src/features/setup/page.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/app.test.tsx`

**Interfaces:**
- Produces:

```tsx
export type WorkspaceSetupOption<Value extends string> = {
  description: string;
  label: string;
  value: Value;
};

type WorkspaceSetupGridProps<Value extends AccountSetupWorkspace> = {
  disabled?: boolean;
  onValuesChange: (values: Value[]) => void;
  options: ReadonlyArray<WorkspaceSetupOption<Value>>;
  values: Value[];
};

export function WorkspaceSetupGrid<Value extends AccountSetupWorkspace>(
  props: WorkspaceSetupGridProps<Value>,
): React.ReactElement;
```

- Consumes: `Checkbox`, `FieldSet`, `FieldLegend`, `FieldLabel`, `WorkspaceIcon`, and `workspaceIdentities`.
- Produces: native checkbox semantics with visually hidden checkbox controls and full-card labels.

- [ ] **Step 1: Write failing whole-card selection tests**

```tsx
it("toggles a workspace from the whole card while hiding checkbox chrome", async () => {
  const onValuesChange = vi.fn();
  render(
    <WorkspaceSetupGrid
      onValuesChange={onValuesChange}
      options={[{ description: "Plan the day", label: "Calendar", value: "calendar" }]}
      values={[]}
    />,
  );

  const checkbox = screen.getByRole("checkbox", { name: "Calendar" });
  expect(checkbox).toHaveClass("sr-only");
  await userEvent.click(screen.getByText("Plan the day"));
  expect(onValuesChange).toHaveBeenCalledWith(["calendar"]);
});
```

Add a second test asserting checked order follows `options`, disabled cards do not toggle, and `data-workspace="calendar"` plus `data-checked="true"` are present for CSS.

- [ ] **Step 2: Run the workspace-grid test and verify it fails**

Run: `pnpm vitest run apps/web/src/features/setup/workspace-setup-grid.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the semantic bento grid**

Render a fieldset whose labels contain a visually hidden `Checkbox` and workspace identity:

```tsx
<FieldLabel
  className="workspace-setup-card"
  data-checked={checked}
  data-workspace={option.value}
  htmlFor={optionId}
>
  <Checkbox
    aria-label={option.label}
    checked={checked}
    className="sr-only"
    id={optionId}
    onCheckedChange={(value) => toggle(option.value, value === true)}
  />
  <WorkspaceIcon size="lg" workspace={option.value} />
  <span className="workspace-setup-card__copy">
    <strong>{option.label}</strong>
    <span>{option.description}</span>
  </span>
</FieldLabel>
```

Style a two-column mobile grid and four balanced cards at wider breakpoints. Use existing workspace CSS variables/identity data; do not hard-code a new global brand color. Selection changes background and icon fill without changing border width, padding, or size.

- [ ] **Step 4: Replace `CheckboxCardGroup` only on the workspace step**

Keep `CheckboxCardGroup` for provider service choices. Replace the workspaces instance with `WorkspaceSetupGrid`, preserving `selectedWorkspaces`, `setSelectedWorkspaces`, the zero-selection forward disable, and workspace option order.

- [ ] **Step 5: Run component and setup tests**

Run:

```bash
pnpm vitest run apps/web/src/features/setup/workspace-setup-grid.test.tsx apps/web/src/components/checkbox-card-group.test.tsx apps/web/src/app.test.tsx
pnpm --filter @personal-os/web typecheck
```

Expected: PASS; `Calendar`, `Tasks`, `Mail`, and `Finances` remain discoverable as checkboxes while no checkbox glyph is visible.

- [ ] **Step 6: Commit the workspace selector**

```bash
git add apps/web/src/features/setup/workspace-setup-grid.tsx apps/web/src/features/setup/workspace-setup-grid.test.tsx apps/web/src/features/setup/page.tsx apps/web/src/styles.css apps/web/src/app.test.tsx
git commit -m "feat: add setup workspace bento selector"
```

### Task 4: Build the shared connected-account list

**Files:**
- Create: `apps/web/src/features/setup/connection-list.tsx`
- Create: `apps/web/src/features/setup/connection-list.test.tsx`
- Modify: `apps/web/src/features/setup/page.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Produces:

```tsx
export type SetupConnection = {
  description?: string;
  id: string;
  label: string;
};

type ConnectionListProps = {
  addLabel: string;
  connections: SetupConnection[];
  emptyText: string;
  mark: "apple" | "google" | "plaid";
  onAdd: () => void;
};

export function ConnectionList(props: ConnectionListProps): React.ReactElement;
```

- Consumes: `BrandMark`, `Button`, `Item`, and `PlusIcon` from shared registries.
- Produces: a semantic list, compact account rows, provider-specific mark, quiet empty copy, and plus action.

- [ ] **Step 1: Write failing list tests**

```tsx
it("shows account identity, capabilities, and a provider-specific add action", async () => {
  const onAdd = vi.fn();
  render(
    <ConnectionList
      addLabel="Add another Google account"
      connections={[{ id: "1", label: "person@example.com", description: "Calendar · Mail" }]}
      emptyText="No Google accounts connected"
      mark="google"
      onAdd={onAdd}
    />,
  );
  expect(screen.getByRole("img", { name: "Google" })).toBeInTheDocument();
  expect(screen.getByText("Calendar · Mail")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Add another Google account" }));
  expect(onAdd).toHaveBeenCalledOnce();
});
```

Add an empty-list test that still exposes the plus action and has no nested Card role/surface.

- [ ] **Step 2: Run the list test and verify it fails**

Run: `pnpm vitest run apps/web/src/features/setup/connection-list.test.tsx`

Expected: FAIL because `ConnectionList` does not exist.

- [ ] **Step 3: Implement list and provider mark behavior**

Use `<BrandMark brand="google" />` and `<BrandMark brand="apple" />`. For Plaid, pass `brand="plaid"` through the existing fallback so the component renders the neutral approved monogram rather than hand-drawn artwork. Keep rows flat and compact, separated by surface tone or gap rather than visible borders.

Map connector records in `page.tsx`:

```tsx
const connectorConnections = accounts.map((account) => ({
  description: [account.calendarEnabled ? "Calendar" : null, account.mailEnabled ? "Mail" : null]
    .filter(Boolean)
    .join(" · ") || "Connected",
  id: account.id,
  label: account.email ?? account.label,
}));
```

Map finance records with `label: account.name` and `description: account.institution`.

- [ ] **Step 4: Replace `ConnectedAccounts` and finance row duplication**

Delete the local `ConnectedAccounts` function. Render `ConnectionList` on Google, Apple, and Finances steps, with local `addOpen` state initially `false`; Task 5 will supply the responsive add content.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
pnpm vitest run apps/web/src/features/setup/connection-list.test.tsx apps/web/src/components/brand-marks.test.tsx apps/web/src/app.test.tsx
pnpm --filter @personal-os/web typecheck
```

Expected: PASS; sparse connector data renders `Apple` and `Connected`, and every provider page shows its add action even when empty.

- [ ] **Step 6: Commit the shared list**

```bash
git add apps/web/src/features/setup/connection-list.tsx apps/web/src/features/setup/connection-list.test.tsx apps/web/src/features/setup/page.tsx apps/web/src/styles.css
git commit -m "feat: add setup connection lists"
```

### Task 5: Move Google, Apple, and Plaid add flows into ResponsiveDialog

**Files:**
- Modify: `apps/web/src/features/setup/page.tsx`
- Modify: `apps/web/src/features/setup/connection-list.tsx`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/components/responsive-dialog.test.tsx`

**Interfaces:**
- Consumes: all slots exported from `apps/web/src/components/responsive-dialog.tsx`.
- Preserves: `api.getGoogleAuthorizationUrl`, `api.connectICloud`, `PlaidConnectButton`, query invalidation, and `ConnectionAuthorizationOutcome`.
- Produces: controlled `addOpen: boolean` on each provider step; successful Apple/Plaid completion closes the surface and refreshes provider data.

- [ ] **Step 1: Update setup integration tests to require responsive add surfaces**

Add assertions to `app.test.tsx`:

```tsx
await browser.click(screen.getByRole("button", { name: "Add another Apple account" }));
const appleSurface = screen.getByRole("dialog", { name: "Add another Apple account" });
expect(within(appleSurface).getByLabelText("Apple Account email")).toBeInTheDocument();
expect(screen.queryByLabelText("Apple Account email", { selector: "main input" })).not.toBeInTheDocument();
```

For Google, assert service choices and `Connect Google` exist only after `Add another Google account` is clicked. For finances, assert `PlaidConnectButton` exists inside the `Add a financial institution` surface. Reuse the responsive-dialog unit test’s `matchMedia` control to assert `data-presentation="drawer"` at mobile width and `dialog` at desktop width.

- [ ] **Step 2: Run the provider flow test and verify inline forms fail the new contract**

Run:

```bash
pnpm vitest run apps/web/src/app.test.tsx apps/web/src/components/responsive-dialog.test.tsx
```

Expected: FAIL because Apple, Google, and Plaid controls are still inline.

- [ ] **Step 3: Compose the Google add surface**

Use controlled state and standard slots:

```tsx
<ResponsiveDialog onOpenChange={setAddOpen} open={addOpen}>
  <ResponsiveDialogContent>
    <ResponsiveDialogHeader>
      <ResponsiveDialogTitle>Add another Google account</ResponsiveDialogTitle>
      <ResponsiveDialogDescription>
        Choose what this account contributes to nohmi.
      </ResponsiveDialogDescription>
    </ResponsiveDialogHeader>
    <ResponsiveDialogBody>
      <ServiceChoices {...serviceChoiceProps} />
      {connect.isError ? <ProviderError error={connect.error} provider="Google" /> : null}
    </ResponsiveDialogBody>
    <ResponsiveDialogFooter>
      <ResponsiveDialogActions>
        <ResponsiveDialogClose asChild><Button variant="ghost">Cancel</Button></ResponsiveDialogClose>
        <Button disabled={(!calendar && !mail) || connect.isPending} onClick={() => connect.mutate()}>
          {connect.isPending ? "Opening Google" : "Connect Google"}
        </Button>
      </ResponsiveDialogActions>
    </ResponsiveDialogFooter>
  </ResponsiveDialogContent>
</ResponsiveDialog>
```

Keep OAuth navigation behavior unchanged. A successful callback is still handled by `ConnectionAuthorizationOutcome`, which refetches connectors.

- [ ] **Step 4: Compose the Apple add surface**

Move the existing Apple email, app-specific password, help link, service choices, submit button, pending state, and error alert into the same ResponsiveDialog slot structure. Initialize `addOpen` to `false`, not `accounts.length === 0`. On mutation success:

```tsx
onSuccess: async () => {
  await queryClient.invalidateQueries({ queryKey: ["connectors"] });
  setAddOpen(false);
},
```

Remove the duplicated app-specific-password description if present. Keep autocomplete values `off` and `new-password`.

- [ ] **Step 5: Compose the Plaid add surface**

Place the existing read-only explanation and `PlaidConnectButton` in a ResponsiveDialog titled `Add a financial institution`. Wrap `onConnected` so it awaits the finance refresh and then closes:

```tsx
const connected = async () => {
  await refresh();
  setAddOpen(false);
};
```

Keep the note about manual accounts outside the responsive surface only if it remains relevant and concise.

- [ ] **Step 6: Run provider tests, typecheck, and focused formatting**

Run:

```bash
pnpm vitest run apps/web/src/app.test.tsx apps/web/src/components/responsive-dialog.test.tsx apps/web/src/features/setup/connection-list.test.tsx
pnpm --filter @personal-os/web typecheck
pnpm biome check apps/web/src/features/setup apps/web/src/app.test.tsx apps/web/src/styles.css
```

Expected: PASS. Connection errors remain inside the open surface, Apple success closes and refetches, and Plaid success closes after refresh.

- [ ] **Step 7: Commit the provider surfaces**

```bash
git add apps/web/src/features/setup/page.tsx apps/web/src/features/setup/connection-list.tsx apps/web/src/app.test.tsx apps/web/src/styles.css apps/web/src/components/responsive-dialog.test.tsx
git commit -m "feat: move setup connections into responsive dialogs"
```

### Task 6: Add shared provider-step skip confirmation

**Files:**
- Create: `apps/web/src/features/setup/provider-connection-step.tsx`
- Create: `apps/web/src/features/setup/provider-connection-step.test.tsx`
- Modify: `apps/web/src/features/setup/page.tsx`
- Modify: `apps/web/src/app.test.tsx`

**Interfaces:**
- Produces:

```tsx
type ProviderConnectionStepProps = {
  accountCount: number;
  children: React.ReactNode;
  confirmation: string;
  confirmLabel: string;
  continueSetup: () => void;
  registerContinue: (handler: () => void) => void;
};

export function ProviderConnectionStep(props: ProviderConnectionStepProps): React.ReactElement;
```

- Consumes: `ResponsiveDialog` and its header/body/footer/action/close slots.
- Produces: a continue handler that advances immediately when `accountCount > 0` and otherwise opens a controlled confirmation.

- [ ] **Step 1: Write failing confirmation tests**

```tsx
it("confirms before continuing without a provider account", async () => {
  const continueSetup = vi.fn();
  let advance = () => undefined;
  render(
    <ProviderConnectionStep
      accountCount={0}
      confirmation="You haven’t added a Google account. Continue without one?"
      confirmLabel="Continue without Google"
      continueSetup={continueSetup}
      registerContinue={(handler) => { advance = handler; }}
    >
      <p>No accounts</p>
    </ProviderConnectionStep>,
  );
  act(() => advance());
  expect(screen.getByText("You haven’t added a Google account. Continue without one?")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Continue without Google" }));
  expect(continueSetup).toHaveBeenCalledOnce();
});
```

Add tests that cancel does not advance and that `accountCount={1}` advances immediately without rendering a dialog.

- [ ] **Step 2: Run the provider-step test and verify it fails**

Run: `pnpm vitest run apps/web/src/features/setup/provider-connection-step.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the shared confirmation controller**

Use a stable `useCallback` continue handler and register it in an effect so `SetupFrame` can own the visible forward arrow without duplicating provider dialogs:

```tsx
const requestContinue = useCallback(() => {
  if (accountCount > 0) continueSetup();
  else setConfirmOpen(true);
}, [accountCount, continueSetup]);

useEffect(() => registerContinue(requestContinue), [registerContinue, requestContinue]);
```

Render the supplied `confirmation` as the title and `confirmLabel` as the primary action. Cancel uses `ResponsiveDialogClose`; confirmation closes the surface and calls `continueSetup`. Rely on Dialog/Drawer trigger focus restoration by passing the frame’s forward button ref through the registration contract if the current shared primitive requires an explicit trigger.

- [ ] **Step 4: Wire Google, Apple, and finances forward behavior**

In `SetupPage`, store the active forward callback in a ref or state owned by the current step and pass it to `SetupFrame`. Wrap each provider body with `ProviderConnectionStep`. Exact confirmation/action pairs:

```tsx
const providerCopy = {
  google: ["You haven’t added a Google account. Continue without one?", "Continue without Google"],
  icloud: ["You haven’t added an Apple account. Continue without one?", "Continue without Apple"],
  finances: ["You haven’t added a financial institution. Continue without one?", "Continue without finances"],
} as const;
```

Do not show `Skip Google`, `Skip Apple`, or `Skip finances` as persistent button labels; the visible control remains the arrow named `Continue`.

- [ ] **Step 5: Update end-to-end setup interaction assertions**

In `app.test.tsx`, cover:

```tsx
await browser.click(screen.getByRole("button", { name: "Continue" }));
expect(screen.getByText("You haven’t added an Apple account. Continue without one?")).toBeInTheDocument();
await browser.click(screen.getByRole("button", { name: "Cancel" }));
expect(screen.getByRole("heading", { name: "Connect your Apple accounts" })).toBeInTheDocument();
await browser.click(screen.getByRole("button", { name: "Continue" }));
await browser.click(screen.getByRole("button", { name: "Continue without Apple" }));
expect(await screen.findByRole("heading", { name: "Connect the accounts you track" })).toBeInTheDocument();
```

- [ ] **Step 6: Run confirmation and full setup tests**

Run:

```bash
pnpm vitest run apps/web/src/features/setup/provider-connection-step.test.tsx apps/web/src/app.test.tsx
pnpm --filter @personal-os/web typecheck
```

Expected: PASS; provider steps with accounts advance immediately and empty provider steps require explicit confirmation.

- [ ] **Step 7: Commit skip confirmation**

```bash
git add apps/web/src/features/setup/provider-connection-step.tsx apps/web/src/features/setup/provider-connection-step.test.tsx apps/web/src/features/setup/page.tsx apps/web/src/app.test.tsx
git commit -m "feat: confirm skipped setup connections"
```

### Task 7: Refine the ready step and complete final responsive verification

**Files:**
- Modify: `apps/web/src/features/setup/page.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `docs/design/pages/setup.md`
- Test: `e2e/` setup acceptance spec selected by the repository’s existing setup route coverage; if no setup-focused spec exists, create `e2e/setup.spec.ts` using the existing fixture/auth helpers.

**Interfaces:**
- Consumes: `SetupFrame` with `forward={undefined}` and `back={review}`.
- Produces: body actions named exactly `Today at a Glance` and `Connect an Agent`.
- Preserves: `completeSetup("/today")` and `completeSetup("/settings?section=agent-connections")`.

- [ ] **Step 1: Make the ready-step tests require the final contract**

Update the existing ready tests:

```tsx
expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Today at a Glance" })).toHaveClass("w-full");
expect(screen.getByRole("button", { name: "Connect an Agent" })).toHaveClass("w-full");
expect(screen.queryByRole("button", { name: "Review setup" })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the ready integration test and verify old actions fail**

Run: `pnpm vitest run apps/web/src/app.test.tsx -t "setup"`

Expected: FAIL because the old step renders `Review setup`, `Open Today`, and `Connect an agent` in a footer.

- [ ] **Step 3: Implement the final body actions**

Replace the ready footer with:

```tsx
<div className="setup-ready-actions">
  <Button className="w-full" disabled={pending} onClick={complete} size="lg">
    Today at a Glance
  </Button>
  <Button className="w-full" disabled={pending} onClick={connectAgent} size="lg" variant="secondary">
    Connect an Agent
  </Button>
</div>
```

Pass `review` to the frame as `back`; pass no forward callback. Keep the concise setup summary only if it fits naturally above the actions without forcing ordinary mobile scrolling.

- [ ] **Step 4: Finish responsive CSS and documentation**

Ensure:

```css
.setup-stage {
  align-items: center;
  display: flex;
  min-height: calc(100dvh - var(--setup-header-height));
  padding-block: clamp(1.5rem, 6dvh, 4rem) calc(5rem + env(safe-area-inset-bottom));
}

.setup-step {
  margin-inline: auto;
  max-width: 32rem;
  width: 100%;
}

.setup-navigation__fade {
  background: linear-gradient(to bottom, transparent, var(--canvas) 58%);
}
```

The exact header-height token may be a local custom property. Confirm no component clips at 320 pixels, long copy wraps, responsive surfaces scroll internally, and floating controls do not cover the last field. Update `docs/design/pages/setup.md` to document the final ready action and arrow exceptions.

- [ ] **Step 5: Add or update browser acceptance coverage**

At mobile viewport, assert the setup page has no horizontal overflow and the ready actions are visible/clickable. At desktop viewport, assert provider add content is a Dialog rather than Drawer. Follow the repository’s existing authenticated fixture helper and avoid adding a second fixture path.

- [ ] **Step 6: Run final focused verification once**

Run:

```bash
pnpm vitest run apps/web/src/brand.test.ts apps/web/src/components/brand-mark.test.tsx apps/web/src/components/responsive-dialog.test.tsx apps/web/src/features/setup apps/web/src/app.test.tsx
pnpm --filter @personal-os/web typecheck
pnpm biome check apps/web/src/features/setup apps/web/src/components/brand-marks.tsx apps/web/src/brand.ts apps/web/src/app.tsx apps/web/src/app.test.tsx apps/web/src/styles.css docs/design/system.md docs/design/pages/setup.md
pnpm test:e2e --grep "setup"
```

Expected: all commands PASS. If the local runtime is already serving this checkout, perform one final browser pass at 320-pixel mobile and representative desktop width for Welcome, Workspaces, one provider add surface, one skip confirmation, and Ready. Do not repeatedly rerun the full repository verification suite during visual iteration.

- [ ] **Step 7: Commit the final setup experience**

```bash
git add apps/web/src/features/setup/page.tsx apps/web/src/styles.css apps/web/src/app.test.tsx docs/design/pages/setup.md e2e
git commit -m "feat: finish nohmi setup experience"
```
