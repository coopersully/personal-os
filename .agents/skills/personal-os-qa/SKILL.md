---
name: personal-os-qa
description: Apply ilo's repository fixtures and run evidence-backed product QA in the in-app browser. Use when testing a branch or PR, smoke-testing the local app, reviewing responsive UX, validating onboarding or provider states, checking workspace switching, or writing a regression report for Today, Calendar, Tasks, Mail, Finances, Settings, or account setup.
---

# ilo product QA

Use the real local runtime, repository fixtures, production routes, and visible
browser behavior. Treat QA as a contract check, not a screenshot tour.

## Start safely

1. Read `AGENTS.md`, `docs/engineering/qa-fixtures.md`, and the relevant design
   or product specification.
2. Read the category runbook selected below.
3. Run:

   ```bash
   pnpm fixtures:load
   pnpm env:status
   ```

4. If the runtime is unhealthy, use the checked-in `pnpm env:*` actions. Do not
   invent another server process.
5. Use `demo+full@ilo.test` for populated coverage. Use the `qa+` personas only
   for the state they name.

Fixture writes are disposable, but ordinary local accounts are not. Only mutate
named fixture accounts. Reload fixtures after a pass that changes setup, mail,
tasks, calendars, or finances.

## Use the in-app browser

Apply the `control-in-app-browser` skill and claim the existing localhost tab
when available. Prefer semantic locators and fresh DOM snapshots. Use a
screenshot when hierarchy, clipping, motion, or density needs visual evidence.

For each affected surface:

1. Record route, fixture persona, viewport, and starting state.
2. Verify the primary user job and production data, not only that a heading
   renders.
3. Exercise the shortest representative interaction.
4. Check loading, populated, empty, and recovery states when applicable.
5. Check keyboard-accessible names, focus, and dismissal behavior.
6. Check document horizontal overflow and the browser console.
7. Inspect the normal viewport and a 390 × 844 narrow viewport for responsive
   changes. Reset the viewport override when finished.
8. Leave the in-app browser on a useful, stable fixture page.

Do not connect a real provider, send mail, initiate money movement, or submit
external data during QA unless the user explicitly requests that side effect.

## Select runbooks

- Shell, navigation, workspace previews, motion, and responsive app frame:
  [references/shell-and-switching.md](references/shell-and-switching.md)
- Authentication, guided setup, resume, exit, and recovery:
  [references/setup-and-accounts.md](references/setup-and-accounts.md)
- Today, Calendar, Tasks, Reminders, Goals, and Motives:
  [references/planning.md](references/planning.md)
- Unified inbox, account rails, thread reader, and mailbox states:
  [references/mail.md](references/mail.md)
- Overview, ledger, budgets, cash flow, accounts, and review:
  [references/finances.md](references/finances.md)

Load only the runbooks relevant to the request, except for whole-branch QA,
which starts with shell plus every changed product category.

## Report evidence

Lead with defects, ordered by user impact:

- **P0**: destructive, security, privacy, or app-wide outage.
- **P1**: core journey cannot complete or data is materially misleading.
- **P2**: important state, recovery, accessibility, or responsive behavior is
  broken but a workaround exists.
- **P3**: polish, copy, density, or visual consistency defect.

For every defect include the route, fixture, viewport, reproduction, expected
contract, and observed result. Separate verified passes from areas not tested.
Do not describe a route as passing if only its static shell loaded.

If QA led to code changes, run the narrowest focused test while iterating and
finish with `pnpm verify`. Validate changes to this skill with the skill
creator's `quick_validate.py`.
