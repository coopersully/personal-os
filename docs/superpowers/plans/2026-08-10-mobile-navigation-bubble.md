# Mobile Navigation Bubble Implementation Plan

> **Status: Superseded.** The approved implementation is recorded in
> [`2026-08-10-mobile-workspace-dock.md`](2026-08-10-mobile-workspace-dock.md);
> this historical plan is not an implementation instruction.

**Goal:** Replace duplicate narrow-screen navigation with one favicon floating action that opens the existing sidebar.

**Architecture:** Keep `App` as the shell owner. Replace the top-left mobile trigger and bottom navigation markup with one labelled drawer trigger, then change only responsive shell CSS so desktop behavior and existing sidebar semantics stay intact. Record the reusable responsive contract in the design system and Today page specification.

**Tech Stack:** React 19, React Router, Testing Library/Vitest, CSS, existing public favicon asset.

## Global Constraints

- Breakpoint is `max-width: 900px`.
- Narrow navigation has one labelled entry point with the favicon; it opens `#app-sidebar`.
- Existing top-right page actions remain in place.
- Do not introduce a navigation-specific primitive or dependency.
- Preserve keyboard, Escape, overlay, focus, safe-area, reduced-motion, and desktop behavior.

---

### Task 1: Lock the narrow navigation contract with tests

**Files:**
- Modify: `apps/web/src/app.test.tsx`

**Interfaces:**
- Consumes: `App` and its public button/aside semantics.
- Produces: regression coverage for the `Open Navigation` button and removal of `More` navigation.

- [ ] **Step 1: Write the failing test**

```tsx
const navigation = screen.getByRole("button", { name: "Open Navigation" });
expect(navigation).toHaveAttribute("aria-controls", "app-sidebar");
expect(navigation.querySelector('img[src="/favicon-32.png"]')).toBeInTheDocument();
expect(screen.queryByRole("button", { name: "More" })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/src/app.test.tsx`

Expected: FAIL because `Open Navigation` renders the Menu SVG and `More` is still rendered.

- [ ] **Step 3: Write minimal implementation**

Replace the mobile leading trigger and bottom navigation with one floating button using the existing favicon asset and retaining the sidebar state handlers.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/web/src/app.test.tsx`

Expected: PASS.

### Task 2: Apply responsive shell styling

**Files:**
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: the new `.sidebar-trigger--floating` class and existing responsive breakpoint.
- Produces: an inset-safe bottom-right trigger and narrow layouts without app-bar/bottom-nav reservations.

- [ ] **Step 1: Write the failing test**

Extend the test from Task 1 so the favicon trigger remains the only navigation trigger after opening and dismissing the sidebar.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/src/app.test.tsx`

Expected: FAIL until the production markup and responsive class are aligned.

- [ ] **Step 3: Write minimal implementation**

At `max-width: 900px`, make top navigation transparent and actions-only, position the trigger bottom-right above safe-area inset, remove the old mobile-nav styles, and recalculate calendar/preview bounds without the bottom bar.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/web/src/app.test.tsx`

Expected: PASS.

### Task 3: Record and verify the shared rule

**Files:**
- Modify: `docs/design/system.md`
- Modify: `docs/design/pages/today.md`

**Interfaces:**
- Consumes: the accepted trial invariant from `docs/superpowers/specs/2026-08-10-mobile-navigation-bubble-design.md`.
- Produces: consistent app-frame and Today navigation guidance.

- [ ] **Step 1: Update the narrow navigation contract**

State that narrow layouts use the bottom-right favicon bubble for the existing drawer rather than a hamburger or destination bar, while page actions remain in place.

- [ ] **Step 2: Run focused checks**

Run: `pnpm lint && pnpm typecheck && pnpm vitest run apps/web/src/app.test.tsx`

Expected: PASS.

- [ ] **Step 3: Run live responsive QA**

At 390 × 844, inspect `/today`, open and close the sidebar via the bubble, use Escape and overlay dismissal, verify top-right actions remain accessible, and confirm no horizontal overflow.

- [ ] **Step 4: Run complete verification**

Run: `pnpm verify`

Expected: PASS.
