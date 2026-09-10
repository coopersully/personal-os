# Flat Surface Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make flat, contrast-led grouping the shared frontend visual standard and remove redundant shell and Today dividers.

**Architecture:** The visual contract belongs in the design foundations and system documents. The shared app-bar and Today queue are reference consumers in the stylesheet, so their redundant structural borders are removed rather than replaced with a page-only treatment.

**Tech Stack:** Markdown design contracts, React application stylesheet, Playwright local QA.

## Global Constraints

- No shadows or gradients for ordinary surface or interaction decoration.
- Use semantic background contrast and spacing before structural borders.
- Preserve borders that communicate control, row, modal/sheet, or semantic-state boundaries.
- Keep all focus, hover, selection, error, desktop, narrow, light, and dark states perceptible.

---

### Task 1: Establish the flat-surface contract

**Files:**
- Modify: `docs/design/foundations.md`
- Modify: `docs/design/system.md`
- Modify: `docs/design/pages/today.md`
- Create: `docs/superpowers/specs/2026-08-12-flat-surface-language-design.md`

**Interfaces:**
- Consumes: the canvas → surface → surface-raised material ladder.
- Produces: a shared invariant used by page specifications and CSS composition.

- [ ] **Step 1: Record the visible cost and invariant**

Add the flat-surface outcome, permitted border purposes, and accessibility
state rule to the foundation and system contracts. Replace the app-bar’s
documented quiet bottom border with contrast-led separation.

- [ ] **Step 2: Align Today’s page contract**

Change the desktop queue description from an independent visual boundary to a
secondary rail distinguished by hierarchy and spacing.

- [ ] **Step 3: Review contract consistency**

Run: `rg -n "modest elevation|quiet bottom border|independent visual boundary" docs/design`

Expected: remaining wording does not prescribe decorative elevation or either
removed reference divider.

- [ ] **Step 4: Commit**

```bash
git add docs/design
git commit -m "docs: establish flat surface language"
```

### Task 2: Remove redundant reference dividers

**Files:**
- Modify: `apps/web/src/styles.css:1152-1164`
- Modify: `apps/web/src/styles.css:1795-1799`

**Interfaces:**
- Consumes: the flat-surface design contract from Task 1.
- Produces: a shared app bar and Today rail that rely on semantic surfaces and spacing.

- [ ] **Step 1: Remove the app-bar structural border**

Delete `border-bottom: 1px solid var(--line)` from `.workspace-app-bar`; retain
its opaque semantic background, sticky position, height, and slot geometry.

- [ ] **Step 2: Remove the Today queue structural border**

Delete `border-left: 1px solid var(--line)` from `.today-queue`; retain its
minimum height and left padding so its secondary-rail hierarchy remains stable.

- [ ] **Step 3: Verify the reference routes**

Run: `pnpm lint && pnpm typecheck`

Expected: PASS.

Inspect `http://localhost:8084/today` at desktop and narrow widths in both
themes. Confirm app-bar orientation, queue hierarchy, controls, and focus
states remain clear without the two dividers.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles.css
git commit -m "style: flatten workspace chrome"
```
