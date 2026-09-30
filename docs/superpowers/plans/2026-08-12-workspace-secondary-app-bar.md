# Workspace Secondary App Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize Calendar and Mail secondary navigation on one slot-based shell primitive available to every page.

**Architecture:** Add a shared composed component in `apps/web/src/components` and shared semantic styles in `styles.css`. Calendar and Mail continue to own their content and state while composing the shared bar and named slots.

**Tech Stack:** React, TypeScript, Testing Library/Vitest, semantic CSS tokens.

## Global Constraints

- Keep the bar flat: no shadows, gradients, or decorative borders.
- Preserve Calendar scroll synchronization and Mail responsive overflow.
- Use the shared primitive for all Calendar and Mail secondary-bar variants.
- Do not add dependencies or change API/domain behavior.

---

### Task 1: Shared secondary app-bar primitive

**Files:**
- Create: `apps/web/src/components/workspace-secondary-app-bar.tsx`
- Create: `apps/web/src/components/workspace-secondary-app-bar.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Produces: `WorkspaceSecondaryAppBar`, `WorkspaceSecondaryAppBarLeading`, `WorkspaceSecondaryAppBarContent`, and `WorkspaceSecondaryAppBarActions`.

- [ ] Write a failing component test that renders all named slots and verifies accessible region semantics and DOM order.
- [ ] Run the focused test and confirm failure because the shared primitive does not exist.
- [ ] Implement the minimal components and shared semantic styles.
- [ ] Run the focused test and confirm it passes.

### Task 2: Calendar migration

**Files:**
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: the shared secondary app-bar exports from Task 1.
- Produces: shared bars labelled `Calendar day navigation`, `Calendar week navigation`, and `Calendar month navigation`.

- [ ] Add failing integration assertions that Calendar views expose the shared secondary-bar data slot.
- [ ] Run the focused Calendar tests and confirm the missing shared contract fails.
- [ ] Migrate day all-day, week header/all-day, and month weekday chrome to the shared component without moving date/event state out of Calendar.
- [ ] Run focused Calendar tests and confirm they pass.

### Task 3: Mail migration

**Files:**
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/features/mail/mail.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: the shared secondary app-bar exports from Task 1.
- Produces: a `Conversation actions` shared secondary bar for selected threads.

- [ ] Add a failing assertion that selected-conversation actions expose the shared secondary-bar data slot.
- [ ] Run the focused Mail tests and confirm the old feature-local bar fails.
- [ ] Replace Mail's wrapper and action container with shared slots; retain its responsive More menu.
- [ ] Run focused Mail tests and confirm they pass.

### Task 4: Durable contract and verification

**Files:**
- Modify: `docs/design/system.md`
- Modify: `docs/design/pages/calendar.md`
- Modify: `docs/design/pages/mail.md`

**Interfaces:**
- Produces: the durable cross-product contract and page-specific usage rules.

- [ ] Update design-system and page contracts to name the secondary bar and its ownership.
- [ ] Run formatting, focused component/app tests, web type checking, and lint.
- [ ] Inspect Calendar and Mail at desktop and narrow widths in the existing environment.
- [ ] Commit and push the verified branch.
