---
name: personal-os-qa
description: Run evidence-backed Personal OS product QA using the local runtime, committed automated tests, and the in-app browser. Use when testing a branch or PR, smoke-testing the app, reviewing responsive UX, validating an existing local flow, or writing a regression report.
---

# Personal OS product QA

Use the checked-in local runtime, committed tests, and visible browser behavior.
Treat QA as a contract check, not a screenshot tour.

## Start safely

1. Read `AGENTS.md`, the relevant design or product specification, and the
   nearest implementation/testing skill.
2. Run:

   ```bash
   pnpm env:status
   ```

3. If the runtime is unhealthy, use the checked-in `pnpm env:*` actions. Do not
   invent another server process.

## Keep test data public-safe

- Never sign into a real account, connect a real provider, send mail, move
  money, or submit external data during routine QA.
- Use only a disposable local account created for the pass or an existing
  committed test fixture. Do not place credentials, personal content, provider
  payloads, or local paths in a report.
- If the scenario requires a populated application, recovery, or provider-specific state that the
  repository does not create deterministically, add that coverage to automated
  tests before claiming the state was accepted. Do not invent a manual fixture.

## Use the in-app browser

Apply the `control-in-app-browser` skill and claim the existing localhost tab
when available. Prefer semantic locators and fresh DOM snapshots. Use a
screenshot when hierarchy, clipping, motion, or density needs visual evidence.

For each affected surface:

1. Record route, disposable test state, viewport, and starting state.
2. Verify the primary user job and visible product state, not only that a
   heading renders.
3. Exercise the shortest representative interaction.
4. Check loading, populated, empty, and recovery states when applicable.
5. Check keyboard-accessible names, focus, and dismissal behavior.
6. Check document horizontal overflow and the browser console.
7. Inspect the normal viewport and a 390 × 844 narrow viewport for responsive
   changes. Reset the viewport override when finished.
8. Leave the in-app browser on a useful, stable local page.

## Combine browser QA with automation

- Run the narrowest affected unit, integration, or component tests first.
- Run `pnpm test:e2e` for a complete end-to-end regression pass. Use the
  repository's Playwright projects rather than an ad hoc browser server.
- Browser QA complements test evidence: it checks hierarchy, responsive
  behavior, keyboard interaction, focus, and honest visible states that a
  passing test alone does not prove.

## Report evidence

Lead with defects, ordered by user impact:

- **P0**: destructive, security, privacy, or app-wide outage.
- **P1**: core journey cannot complete or data is materially misleading.
- **P2**: important state, recovery, accessibility, or responsive behavior is
  broken but a workaround exists.
- **P3**: polish, copy, density, or visual consistency defect.

For every defect include the route, test state, viewport, reproduction, expected
contract, and observed result. Separate verified passes from areas not tested.
Do not describe a route as passing if only its static shell loaded. State when
an intended provider or recovery scenario lacks deterministic test coverage.

If QA led to code changes, run the narrowest focused test while iterating and
finish with `pnpm verify`. Validate changes to this skill with the skill
creator's `quick_validate.py`.
