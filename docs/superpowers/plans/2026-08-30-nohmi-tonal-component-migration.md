# nohmi Tonal Component Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make nohmi's shared UI and representative product surfaces use opaque tonal backgrounds instead of decorative visible borders while preserving focus, validation, data-grid, and increased-contrast boundaries.

**Architecture:** The semantic neutral ladder in `styles.css` remains the source of material separation. Shared shadcn primitives consume that ladder so feature code inherits the brand treatment; a focused contract test prevents resting borders from returning to the primitive layer. Feature CSS is then audited only where it bypasses primitives, retaining calendar/table/data rules and accessibility signals.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, shadcn/ui with Radix primitives, Vitest, Testing Library, Biome, Vite.

**Spec:** `docs/superpowers/specs/2026-08-28-nohmi-brand-system-design.md`

## Global Constraints

- Product surfaces use no decorative borders, shadows, gradients, blur, glass, or translucent material.
- Background tone is the default separator; visible borders communicate focus, invalid state, increased contrast, or functional data structure.
- Components preserve stable border geometry where focus or validation changes border color.
- shadcn anatomy, `data-slot` attributes, Radix behavior, and public variant APIs remain compatible.
- Reicon remains the only interface icon library and is imported through `@/components/icons`.
- Light and dark themes consume the same semantic roles; feature code does not add raw colors or independent theme overrides.
- Today and Settings are calm reference surfaces; Calendar, Mail, Tasks, and Finances are dense stress tests.

---

### Task 1: Establish the tonal primitive contract

**Files:**
- Create: `apps/web/src/components/ui/flat-material-contract.test.ts`
- Modify: `docs/design/system.md`
- Modify: `.agents/skills/personal-os-frontend/SKILL.md`

**Interfaces:**
- Consumes: the border exception model in the approved brand specification.
- Produces: a source-level contract covering the resting classes of shared primitives and a durable frontend rule used by later tasks.

- [ ] **Step 1: Write the failing primitive contract test**

Create a Vitest test that reads these files with `readFileSync`: `button.tsx`, `card.tsx`, `input.tsx`, `input-group.tsx`, `item.tsx`, `native-select.tsx`, `textarea.tsx`, `toggle.tsx`, `tabs.tsx`, `badge.tsx`, `dialog.tsx`, `popover.tsx`, `dropdown-menu.tsx`, `context-menu.tsx`, `sheet.tsx`, and `sidebar.tsx`.

For each source, strip substrings beginning with `focus-visible:`, `aria-invalid:`, `data-[invalid`, `forced-colors:`, and `border-transparent`, then assert that the remainder does not match:

```ts
/\b(?:border|border-[trblxy])-(?:border|input|sidebar-border)\b/
```

Also assert that `card.tsx`, `input.tsx`, `item.tsx`, and `dialog.tsx` each contain a semantic resting fill matching `/\bbg-(?:card|muted|input|popover|secondary)(?:\/\d+)?\b/`.

- [ ] **Step 2: Run the contract test and confirm the current primitives fail**

Run:

```bash
pnpm exec vitest run apps/web/src/components/ui/flat-material-contract.test.ts
```

Expected: failures identify visible resting borders in Button, Card, Input, Item, and overlay primitives.

- [ ] **Step 3: Record the established system rule**

Add a `Tonal separation` subsection to `docs/design/system.md` that states:

```md
Ordinary surfaces and controls separate through opaque semantic tone, not a
visible resting border. Shared primitives may reserve transparent border
geometry so focus, invalid, increased-contrast, or functional data boundaries
can become visible without layout shift. A legacy `outline` variant names an
interaction hierarchy, not a requirement to draw an outline.
```

Add the same ownership rule to `.agents/skills/personal-os-frontend/SKILL.md` under deterministic design-system application.

- [ ] **Step 4: Commit the contract and documentation**

```bash
git add apps/web/src/components/ui/flat-material-contract.test.ts docs/design/system.md .agents/skills/personal-os-frontend/SKILL.md
git commit -m "test: define tonal primitive contract"
```

### Task 2: Convert shared controls to filled tonal states

**Files:**
- Modify: `apps/web/src/components/ui/button.tsx`
- Modify: `apps/web/src/components/ui/input.tsx`
- Modify: `apps/web/src/components/ui/textarea.tsx`
- Modify: `apps/web/src/components/ui/native-select.tsx`
- Modify: `apps/web/src/components/ui/input-group.tsx`
- Modify: `apps/web/src/components/ui/toggle.tsx`
- Modify: `apps/web/src/components/ui/tabs.tsx`
- Modify: `apps/web/src/components/ui/badge.tsx`
- Modify: `apps/web/src/components/ui/checkbox.tsx`
- Modify: `apps/web/src/components/ui/radio-group.tsx`
- Modify: `apps/web/src/components/ui/switch.tsx`
- Test: `apps/web/src/components/ui/flat-material-contract.test.ts`
- Test: `apps/web/src/components/password-input.test.tsx`

**Interfaces:**
- Consumes: existing component props and variants without API changes.
- Produces: borderless resting controls with stable transparent border geometry and visible focus/invalid states.

- [ ] **Step 1: Update Button variants without renaming them**

Keep `border border-transparent` in the base geometry. Change `outline` from a visible border/background combination to:

```ts
"bg-secondary text-secondary-foreground hover:bg-muted aria-expanded:bg-muted aria-expanded:text-foreground"
```

Keep `focus-visible:border-foreground/50` and invalid/destructive focus colors. Do not add a ring, outline, or shadow.

- [ ] **Step 2: Fill text-entry controls and remove visible resting borders**

For Input, Textarea, NativeSelect, and InputGroup, retain `border border-transparent`, use `bg-input/60` at rest, `hover:bg-input/80` where the element is interactive, and `focus-visible:bg-selection focus-visible:border-foreground/50`. Keep `aria-invalid:border-destructive` and disabled tonal fills. Remove `dark:border-input`, visible `border-input`, and theme-specific resting fills.

- [ ] **Step 3: Flatten selection controls**

Use neutral tonal fills for unchecked/resting checkbox, radio, switch, toggle, tab, and badge surfaces. Selection uses `bg-primary text-primary-foreground` or the component's existing semantic selected state. Preserve focus and invalid borders; remove ordinary `border-input`, `border-border`, and separator lines from tab lists.

- [ ] **Step 4: Run focused control tests**

```bash
pnpm exec vitest run apps/web/src/components/ui/flat-material-contract.test.ts apps/web/src/components/password-input.test.tsx apps/web/src/components/material-state.test.tsx
pnpm --filter @personal-os/web typecheck
```

Expected: all tests and typecheck pass.

- [ ] **Step 5: Commit shared controls**

```bash
git add apps/web/src/components/ui/button.tsx apps/web/src/components/ui/input.tsx apps/web/src/components/ui/textarea.tsx apps/web/src/components/ui/native-select.tsx apps/web/src/components/ui/input-group.tsx apps/web/src/components/ui/toggle.tsx apps/web/src/components/ui/tabs.tsx apps/web/src/components/ui/badge.tsx apps/web/src/components/ui/checkbox.tsx apps/web/src/components/ui/radio-group.tsx apps/web/src/components/ui/switch.tsx apps/web/src/components/ui/flat-material-contract.test.ts
git commit -m "style: flatten shared controls"
```

### Task 3: Convert shared containers and overlays to tonal surfaces

**Files:**
- Modify: `apps/web/src/components/ui/card.tsx`
- Modify: `apps/web/src/components/ui/item.tsx`
- Modify: `apps/web/src/components/ui/alert.tsx`
- Modify: `apps/web/src/components/ui/dialog.tsx`
- Modify: `apps/web/src/components/ui/popover.tsx`
- Modify: `apps/web/src/components/ui/dropdown-menu.tsx`
- Modify: `apps/web/src/components/ui/context-menu.tsx`
- Modify: `apps/web/src/components/ui/sheet.tsx`
- Modify: `apps/web/src/components/ui/sidebar.tsx`
- Test: `apps/web/src/components/ui/flat-material-contract.test.ts`

**Interfaces:**
- Consumes: existing Card, Item, Alert, overlay, menu, and Sidebar exports.
- Produces: opaque tonal grouping with no decorative perimeter or elevation while preserving overlay anatomy and accessible titles.

- [ ] **Step 1: Flatten Card and Item**

Change Card's root from `border border-border bg-card` to `border border-transparent bg-card`. Change CardFooter from `border-t bg-muted/50` to `bg-muted/70`. Keep Card anatomy and radius.

Keep Item's transparent base geometry. Change `outline` to `border-transparent bg-card` and `muted` to `border-transparent bg-muted/70`; hover and focus use the next semantic tone.

- [ ] **Step 2: Flatten alerts and semantic callouts**

Keep Alert borderless. Ensure every variant uses an opaque neutral or status surface and corresponding semantic foreground. Do not add status borders except through increased-contrast styling.

- [ ] **Step 3: Flatten overlays and menus**

For Dialog, Popover, DropdownMenu, ContextMenu, and Sheet content, replace visible perimeter borders with `border border-transparent` or remove the border utility when geometry does not depend on it. Use `bg-popover` for menus/popovers and `bg-card` or `bg-popover` for dialogs/sheets. Remove any `shadow-*` class or CSS shadow. Keep flat scrims, accessible titles, collision handling, and Radix state classes unchanged.

- [ ] **Step 4: Flatten Sidebar chrome**

Remove visible `border-sidebar-border` and edge borders from the shared Sidebar variants while keeping `bg-sidebar`, tonal active/hover rows, resize geometry, mobile Sheet composition, and focus-visible treatment.

- [ ] **Step 5: Run focused container tests and contracts**

```bash
pnpm exec vitest run apps/web/src/components/ui/flat-material-contract.test.ts apps/web/src/components/choice-card-group.test.tsx apps/web/src/components/material-state.test.tsx apps/web/src/app.test.tsx -t "organizes and opens the full navigation|keeps Today sidebar-free|presents the account utility"
pnpm --filter @personal-os/web typecheck
```

Expected: all selected tests and typecheck pass.

- [ ] **Step 6: Commit shared containers**

```bash
git add apps/web/src/components/ui/card.tsx apps/web/src/components/ui/item.tsx apps/web/src/components/ui/alert.tsx apps/web/src/components/ui/dialog.tsx apps/web/src/components/ui/popover.tsx apps/web/src/components/ui/dropdown-menu.tsx apps/web/src/components/ui/context-menu.tsx apps/web/src/components/ui/sheet.tsx apps/web/src/components/ui/sidebar.tsx apps/web/src/components/ui/flat-material-contract.test.ts
git commit -m "style: flatten shared surfaces"
```

### Task 4: Audit product composition and enforce the border policy

**Files:**
- Modify: `apps/web/src/styles.css`
- Modify: `scripts/check-frontend-theme-contract.mjs`
- Test: `apps/web/src/app.test.tsx`

**Interfaces:**
- Consumes: the flattened primitives from Tasks 2 and 3.
- Produces: representative product surfaces without decorative feature-level borders and a deterministic regression check.

- [ ] **Step 1: Classify feature-level CSS borders**

For every visible `border`, `border-top`, `border-right`, `border-bottom`, and `border-left` declaration in `styles.css`, retain only one of these categories:

```text
focus-or-invalid
functional-calendar-grid
functional-table-row
functional-data-mark
increased-contrast
transparent-geometry
```

Replace decorative card, panel, toolbar, queue, app-bar, settings, auth, setup, wallpaper-control, and overlay borders with distinct opaque `var(--surface)`, `var(--surface-muted)`, or `var(--surface-raised)` backgrounds. Do not remove calendar time-grid rules, data-encoded chart lines, selection markers, spinners, or focus/error boundaries.

- [ ] **Step 2: Add deterministic CSS exception regions**

Extend `scripts/check-frontend-theme-contract.mjs` to inspect `styles.css` outside named comment regions. Allow visible border declarations only inside:

```css
/* theme-contract-allow-start: functional-calendar-grid */
/* theme-contract-allow-end: functional-calendar-grid */
/* theme-contract-allow-start: functional-data-boundary */
/* theme-contract-allow-end: functional-data-boundary */
/* theme-contract-allow-start: accessibility-boundary */
/* theme-contract-allow-end: accessibility-boundary */
```

Reject unclassified declarations matching:

```js
/border(?:-(?:top|right|bottom|left))?\s*:\s*(?!0\b|none\b|\d+px\s+solid\s+transparent)[^;]+;/g
```

- [ ] **Step 3: Run the product and theme contracts**

```bash
node scripts/check-frontend-theme-contract.mjs
node scripts/check-theme-token-contract.mjs
node scripts/check-icon-contract.mjs
pnpm exec biome check apps/web/src/components/ui apps/web/src/styles.css scripts/check-frontend-theme-contract.mjs
pnpm --filter @personal-os/web typecheck
```

Expected: every command exits zero.

- [ ] **Step 4: Run focused product regression tests**

```bash
pnpm exec vitest run apps/web/src/app.test.tsx apps/web/src/features/reviews/page.test.tsx apps/web/src/navigation/manifest.test.ts
```

Expected: all tests pass; existing jsdom navigation warnings may remain non-failing.

- [ ] **Step 5: Verify representative surfaces live**

At desktop width and 320×800, inspect Today, Settings/Profile, Settings/Reviews, Calendar, Mail, Tasks, and Finances in light and dark modes. Confirm:

```text
- no horizontal overflow
- ordinary cards and controls have tonal separation without visible resting borders
- focus and invalid states remain visible
- overlay and menu boundaries remain legible
- calendar time/data rules remain present
- no hue becomes product chrome
```

- [ ] **Step 6: Commit the composition migration**

```bash
git add apps/web/src/styles.css scripts/check-frontend-theme-contract.mjs apps/web/src/app.test.tsx
git commit -m "style: apply nohmi tonal surfaces"
```

### Task 5: Final verification and documentation status

**Files:**
- Modify: `docs/superpowers/specs/2026-08-28-nohmi-brand-system-design.md`
- Modify: `docs/superpowers/plans/2026-08-30-nohmi-tonal-component-migration.md`

**Interfaces:**
- Consumes: the completed primitive and product migration.
- Produces: implementation evidence and an honest status in the durable design record.

- [ ] **Step 1: Run repository verification**

```bash
pnpm verify
```

Expected: lint, type checking, coverage, production builds, and desktop/mobile acceptance tests pass.

- [ ] **Step 2: Record completion evidence**

Change the design specification status to `Implemented` only after `pnpm verify` and live visual QA pass. Mark every completed checkbox in this plan and record any retained functional-border exceptions under Task 4.

- [ ] **Step 3: Commit final evidence**

```bash
git add docs/superpowers/specs/2026-08-28-nohmi-brand-system-design.md docs/superpowers/plans/2026-08-30-nohmi-tonal-component-migration.md
git commit -m "docs: record tonal migration verification"
```
