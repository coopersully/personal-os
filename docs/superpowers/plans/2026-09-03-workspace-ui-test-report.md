# Shared Tasks workspace app-test adaptation

Scope: `apps/web/src/app.test.tsx` only, plus this report. Existing unrelated edits were preserved. No production code, live fixtures, commits, or external state were changed by this worker.

## Contract coverage retained and updated

- Always-visible Inbox, Today, Upcoming, All, History, Trash, Lists, and nested Projects; no More views or disclosure toggles. Projects remain visible after changing views and reloading.
- Mobile Tasks action sheet reaches reminder rows through All and the shared Type filter.
- Legacy reminder/scheduled/completed/cancelled and lifecycle URLs become canonical shared workspace queries. Scheduled preserves chronology with the reserved-time sort. Global views retain List/Project filters; canonical project ownership and unavailable-container recovery remain covered.
- Workspace assertions use `listTaskWorkspace` and its canonical `view`, `kind`, `status`, scope, and 50-item page size. The fixture adapter reuses old fixture data but does not translate request fields to legacy queries. Archive List/Project tests continue asserting `listTasks` behavior.
- Shared search, date preset/range removal, Advanced reserved bounds, and Clear preserve the intended scope/search behavior.
- Dense rows retain accessible priority and timing. Task Trash requires confirmation, cancellation performs no write, and recovery from Trash uses the current revision. Reminder Trash uses its timestamp guard and leaves failed rows actionable.
- Existing Task/List/Project editors, move previews, lifecycle actions, direct inspector URLs, and cross-workspace Calendar/Activity/Settings workflows remain exercised.
- Project navigation failure must leave Inbox rows visible and completable. Named dependency retry and failed-next-page retry preserve loaded material.

## Verification

Focused adaptation runs:

1. Navigation, date filters, task Trash, deep links, pagination, and canonical URLs: 11 passed; the initial dependency test captured the temporary auth-loading main element. Changed it to wait for the current named dependency error.
2. Reminder behavior, long cross-workspace flows, mobile, archive, and lifecycle coverage: 10 passed; two dependency assertions still targeted body alerts while production was updated to keep nonblocking errors in the sidebar. Updated their scopes without relaxing queue usability assertions.
3. `pnpm exec vitest run apps/web/src/app.test.tsx -t 'mobile workspace dock|workspace actionable|retries named Tasks|keeps loaded Tasks' --reporter=json --outputFile=/tmp/nohmi-workspace-ui-focused-3.json`: **4 passed, 0 failed**.

`pnpm exec biome check apps/web/src/app.test.tsx` and `git diff --check -- apps/web/src/app.test.tsx`: passed.

Full app-suite first run: `pnpm exec vitest run apps/web/src/app.test.tsx --reporter=json --outputFile=/tmp/nohmi-workspace-ui-app-final.json`: **178 passed, 2 failed**. One Tasks placement assertion expected organization to precede timing in a dense metadata line; it now checks the same List name and estimate on the row's primary action. `pnpm exec vitest run apps/web/src/app.test.tsx -t 'describes Task placement' --reporter=json --outputFile=/tmp/nohmi-workspace-placement-final.json`: **1 passed, 0 failed**.

The other failure was outside the shared Tasks workspace: `plans budgets and inspects their contributing activity` could not find `Planned: view contributing transactions`. Its finance UI was being changed concurrently; no finance assertion was removed or relaxed.

Full app-suite recheck: `pnpm exec vitest run apps/web/src/app.test.tsx --reporter=json --outputFile=/tmp/nohmi-workspace-ui-app-recheck.json`: **178 passed, 2 failed**. Tasks placement now passed. This process had loaded the tests before the primary agent's last Scheduled ordering change; its only Tasks failure expected the pre-change URL without `sort=reserved`. That URL and API assertion were updated, and `pnpm exec vitest run apps/web/src/app.test.tsx -t 'keeps Tasks views useful' --reporter=json --outputFile=/tmp/nohmi-workspace-scheduled-final.json` passed **1/1** afterward. The finance budget-navigation failure above remained. No third full run was claimed; the primary agent owns final integrated verification.

Remaining identified failure requiring work outside this task: finance budget navigation only. All identified Tasks failures were corrected and verified by focused runs, and no Tasks production issue remains open from this worker's checks.

`pnpm --filter @personal-os/web typecheck` failed outside this worker's scope, with no errors in `app.test.tsx` or Tasks files:

- `features/finances/navigation.test.tsx:31–32`: unsupported `exact` role-query option.
- `features/finances/plan-page.tsx:250`: nonexistent `listFinanceCategories` client method.
- `features/finances/position-pages.test.tsx:7,9`: missing accounts/wealth page imports.
- `features/finances/review-page.tsx:145`: required EmptyState icon absent.
- `features/finances/transaction-query.ts:8`: `search` absent from the referenced schema shape.

These finance files were being changed concurrently and were left untouched. Repository-wide `pnpm verify` remains the primary agent's integration step.

## Production issues communicated

The shared projection was initially blocked on Project metadata even for independently readable scopes. The primary agent corrected this while the regression test was strengthened to require an actionable Inbox row. The primary agent also restored named next-page retry behavior and unavailable-container canonicalization. This worker made no production fixes.
