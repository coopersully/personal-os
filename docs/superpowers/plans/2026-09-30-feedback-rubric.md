# Feedback rubric implementation plan

**Goal:** Apply docs/design/feedback.md throughout the web app, including shared desktop UI.
**Architecture:** Shared classification, mutation feedback, and form validation own semantics. Features provide action names and preserve their local state. Existing query regions own load/retry/stale feedback.
**Tech stack:** React, TanStack Query, shadcn, Sonner, Vitest, Playwright.
**Spec:** docs/design/feedback.md

## Constraints and review focus

- Keep provider writes and public API contracts unchanged; classify existing errors.
- Preserve drafts and optimistic rollback. Never retry uncertain writes automatically.
- One notification owner per operation; form validation and ongoing blockers stay visible.
- Verify failures after menus close, stale data after background failures, server field mapping, simultaneous operations, and successful writes followed by failed refreshes.

## Work

- [x] Shared feedback classification, useFeedbackMutation, MutationFeedback, FeedbackForm, and focused tests. Preserve useMutation inference; add action/form/safeToRetry policy and structured validation mapping.
- [x] Migrate app shell, Settings, Today, Calendar, Tasks, Reminders, Goals, Motives, and auth. Keep root Toaster available to auth; fix location validation timing and related-field rules. Add explicit query retries and preserve stale material.
- [x] Migrate Mail, Finances, and calendar sidebar with focused domain tests. Preserve drafts and distinguish uncertain send/import outcomes.
- [x] Update affected interaction tests, design rules, and frontend skill. Run typecheck, focused tests, full pnpm verify, and independent review; repair material findings.

The approved rubric is the design authority. Execute in this existing worktree without another approval gate. Independent feature files and shared infrastructure are assigned to separate workers; app integration stays with the primary agent.

## Verification

`pnpm verify` passed on 2026-09-30: lint, type checking, 341 tests, required
coverage thresholds, production builds, and all four desktop/mobile acceptance
tests. Screenshots confirmed toast visibility and mobile navigation clearance.
Independent source review findings were resolved. Keyboard focus and dismissal
are tested; manual screen-reader conformance was not audited.
