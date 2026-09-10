# Mail Secondary Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate Mail inbox discovery into a URL-backed scope selector while retaining context-specific conversation actions in the reader.

**Architecture:** Extend the existing `MailTopbarControls` in
`apps/web/src/app.tsx`, replacing its independent Unread button with the
installed shadcn `ToggleGroup`. It maps four mutually exclusive scopes to the
existing Mail query contract. Sync and Compose stay in the app-bar action slot.

**Tech Stack:** React, React Router search parameters, TanStack Query, shadcn
`ToggleGroup`, Vitest + Testing Library, local ilo fixture runtime.

## Global Constraints

- Use existing shadcn primitives and reicon glyphs from `@/components/icons`.
- Keep controls flat and semantic; no raw colors, shadows, or gradients.
- Scope is URL-backed and mutually exclusive; scope changes clear `thread`.
- Keep conversation mutations in the reader.
- Preserve accessible names and keyboard operation at 390 px and desktop widths.

### Task 1: Add failing URL-contract tests

**Files:** `apps/web/src/app.test.tsx`

- [x] Add a test that opens Mail with a `thread` parameter, selects Starred,
  expects `?view=starred`, and confirms the labelled `Mail list scope` radio group.
- [x] Add a test that confirms all four scope buttons are present and named.
- [x] Run the scope test; it fails because the `Mail list scope` radio group does not exist.

### Task 2: Implement the scope selector

**Files:** `apps/web/src/app.tsx`, `apps/web/src/styles.css`,
`docs/design/pages/mail.md`

- [x] Derive one scope value from `unread` and `view` search parameters.
- [x] Add a single-select, labelled `ShadcnToggleGroup` for All mail, Unread,
  Starred, and Snoozed.
- [x] Update only scope parameters and `thread`; preserve search text.
- [x] Add compact responsive CSS using existing app-bar spacing and document the
  separation between list scope and conversation actions.
- [x] Run focused tests and Biome; commit the behavior and presentation.

### Task 3: Verify real Mail use cases

**Files:** No source changes expected.

- [x] Run `pnpm fixtures:load` and `pnpm env:status`.
- [x] Inspect the populated Mail route at desktop: scope, search, Sync,
  Compose, selected reader actions, keyboard focus, and horizontal overflow.
- [ ] Inspect the same route at 390 × 844. The current in-app browser binding
  does not expose a viewport override, so this remains a follow-up browser
  acceptance check.
- [x] Run `pnpm verify`; commit the specification and plan; push the PR head.
