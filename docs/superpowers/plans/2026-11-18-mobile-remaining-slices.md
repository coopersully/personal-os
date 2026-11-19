# iPhone Completion: Remaining Slices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the iPhone parity epic (COO-229, COO-254, COO-228, COO-241, COO-238) and land the approved audit exception (COO-265) on one branch.

**Architecture:** Each slice adds screens under `apps/mobile/src/features/{finances,mail,settings}` that call existing `packages/api-client` methods. Two small API additions (transaction `date`, Mail unsnooze) go through domain schema → API route/service → api-client → MCP. Finance work and Mail work touch disjoint files and run as two lanes; documentation is one final task.

**Tech Stack:** TypeScript, Expo / expo-router, TanStack Query, sonner-native, Hono API, zod, Drizzle, Vitest (jsdom for mobile screens), pnpm.

**Spec:** `docs/superpowers/specs/2026-11-18-mobile-remaining-slices-design.md`

## Global Constraints

- User-facing product name is `nohmi`, lowercase; no former product names anywhere.
- One Sonner toast per action (loading → confirmed outcome); no inline result text, banner or card. Every screen test file asserts toast delivery and calls the file's `expectNoInlineResult()`-style check.
- Unknown outcome (network error, 408, 5xx) = "not confirmed", never retried blindly; 4xx other than 408 = confirmed rejection. Use `confirmedRejection` (`features/finances/mutations.ts`) and `mailWriteRejected` (`features/mail/logic.ts`).
- Reuse existing building blocks; no new native dependency; no database migration.
- Icons only through the registries (`apps/web/src/components/icons.ts`, mobile `components/icons`).
- Do not edit `docs/design/mobile-frontend.md`, `docs/product/implementation-log.md` or `apps/mobile/README.md` except in Task 11.
- Lane ownership: Tasks 2–7 (Finance lane) never touch `apps/mobile/src/features/mail/**`, `packages/api-client/src/features/mail*.ts`, `apps/api/src/routes/mail*.ts`, `apps/api/src/mail-service.ts`; Tasks 8–10 (Mail lane) never touch `apps/mobile/src/features/finances/**` or Finance API files. In `apps/mobile/src/features/settings/workspaces.tsx` the Finance lane edits only `preferenceGroups` (around lines 119–155) and the Mail lane only `MailRules`/`MailRuleSettingsScreen`/`MailRuleDetails` (around lines 726–800). In `apps/mobile/src/app/_layout.tsx` each lane only appends its own `Stack.Screen` lines.
- Verification per task: the task's own test files with `pnpm exec vitest run <files>`, plus `pnpm --filter <touched package> typecheck` (or the package's equivalent script) and `pnpm lint`. Do not run `pnpm verify`.
- Commit after each task; message is a plain sentence and ends with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. Never push, never open a PR.

## Review Focus

1. A bulk Mail action where some threads fail: failed threads must stay selected and Undo must cover only confirmed changes (Task 8 test).
2. A date change sent for a provider-synced transaction, or with a stale `expectedTransactionUpdatedAt`: 400 and 409 respectively, nothing written (Task 2 tests).
3. Saved spending preferences that the iPhone cannot draw (`financeSpendingView: "bubbles"`, `financeSpendingPeriod: "custom"` with no dates): fall back to List and to This week (Task 4 test).
4. A rule turned on after its preview is stale (version or fingerprint drift → 409): say it changed, require a new preview, rule stays off (Task 10 test).
5. Onboarding write fails with unknown outcome: writes lock until Reload setup review; Finish setup never enabled from local state alone (Task 6 test).

---

### Task 1: Audit exception (COO-265)

**Files:**
- Modify: wherever the repo keeps pnpm settings for the pinned pnpm version (`package.json` `pnpm` block or `pnpm-workspace.yaml`)
- Modify: `docs/engineering/code-standards.md` or the nearest existing exceptions section in `docs/engineering/`

- [ ] **Step 1:** Run `pnpm audit --prod`; confirm it fails only on GHSA-fc5q-39xc-vjpf. If any other advisory appears, stop and report it.
- [ ] **Step 2:** Add `auditConfig.ignoreGhsas: ["GHSA-fc5q-39xc-vjpf"]` in the location the pinned pnpm reads. Do not change `.github/workflows/ci.yml`.
- [ ] **Step 3:** Run `pnpm audit --prod`; expected exit 0. Run `pnpm install --frozen-lockfile`; expected success.
- [ ] **Step 4:** Document the exception: advisory id, package and range, no fixed release exists, approved by Cooper on 2026-11-17, owner Cooper, exit condition "remove when a fixed picomatch release ships", tracking COO-265.
- [ ] **Step 5:** `pnpm lint`; commit "Allow a tracked audit exception for the unpatched picomatch advisory".

### Task 2: Transaction date — domain, API, client, MCP (COO-254)

**Files:**
- Modify: `packages/domain/src/finance.ts` (`updateFinanceTransactionInputSchema`, ~1415)
- Modify: `apps/api/src/finance-service.ts` (`updateTransaction`, ~10320–10568)
- Modify: `apps/mcp/src/tools/finances.ts` (~1262, description), regenerate `docs/engineering/workspace-agent-tools.md` with `pnpm exec tsx scripts/workspace-agent-dictionary.ts`
- Test: `packages/domain` schema test next to existing finance schema tests; `apps/api/src/finance-service.integration.test.ts`; `apps/mcp/src/tools/finances.workflows.test.ts`

**Interfaces:**
- Produces: `UpdateFinanceTransactionInput` now has `date?: string` (ISO `YYYY-MM-DD`). `api.updateFinanceTransaction(id, { date, expectedTransactionUpdatedAt })` resolves as today; rejects 400 for a non-manual account, 409 for a stale or missing-then-mismatched revision.

- [ ] **Step 1: Failing domain tests:** `{date:"2026-11-02"}` alone parses; `{}` still fails with "Provide a category, note or date."; `{date:"11/02/2026"}` fails.
- [ ] **Step 2:** Add `date: z.iso.date().optional()`; change the refine and its message to "Provide a category, note or date."; add a second refine: `date !== undefined` requires `expectedTransactionUpdatedAt` ("A date change needs the transaction's current revision.").
- [ ] **Step 3: Failing service integration tests** (follow the manual-ledger block ~3187): (a) manual transaction, `date` changed → `transactionDate` updated, audit event `finance.transaction_updated` records old and new date; (b) transaction on a `provider: "plaid"` account → `AppError` validation (400), message "Dates on synced transactions can't be changed.", row unchanged; (c) stale `expectedTransactionUpdatedAt` on the human path (no `financeReviewedExecution`) → conflict (409), row unchanged.
- [ ] **Step 4:** Implement in `updateTransaction`: when `input.date !== undefined`, load the account provider (precedent: `apps/api/src/finance/ledger-service.ts:317`), reject non-manual, enforce the revision check regardless of `financeReviewedExecution`, write `transactionDate`. Do not pass `date` into the generic `.set({...input})` spread under the wrong column name.
- [ ] **Step 5:** MCP: description becomes "category, note, or the date of a manually entered transaction"; add a workflow test that `date` is forwarded; regenerate the dictionary doc.
- [ ] **Step 6:** Run the three test files, domain/api/mcp typecheck, `pnpm lint`; commit "Let a manual transaction's date be corrected through the API and MCP".

### Task 3: Transaction date — web and iPhone (COO-254)

**Files:**
- Modify: `apps/web/src/features/finances/transaction-interactions.tsx` (add `TransactionDateEditor`), mount it in the detail dialog in `apps/web/src/features/finances/page.tsx` (~3123)
- Modify: `apps/mobile/src/features/finances/transaction-editor.tsx` (`TransactionForm`), `apps/mobile/src/features/finances/details.tsx` (pass `manualAccount`)
- Test: `apps/web/src/features/finances/transaction-interactions.test.tsx`, `apps/mobile/src/features/finances/transactions.test.tsx`

**Interfaces:**
- Consumes: Task 2's `date` on `updateFinanceTransaction`.
- Produces: `TransactionDateEditor({ transaction, manual }: { transaction: FinanceTransaction; manual: boolean })` (web); `TransactionForm` accepts `manualAccount: boolean`.

- [ ] **Step 1: Failing mobile tests:** manual transaction shows a "Date" field; changing it and Save sends `{ date: "2026-11-02", expectedTransactionUpdatedAt: <snapshot.updatedAt> }` only; synced transaction has no editable Date field; 409 → error toast "This transaction changed elsewhere…" (existing copy) and no navigation; 400 → error toast with the server reason; `expectNoInlineResult()`.
- [ ] **Step 2:** Implement with `DateField` (`features/tasks/date-field`, `dateOnly`), following how notes/category track `edited` and use `appliedTransaction`.
- [ ] **Step 3: Failing web tests:** manual → date input, Save sends `{date, expectedTransactionUpdatedAt}`, success and failure through Sonner, no inline result copy; synced → no input.
- [ ] **Step 4:** Implement `TransactionDateEditor` mirroring `TransactionContextEditor` (line 65) and mount it.
- [ ] **Step 5:** Run both test files, web and mobile typecheck, `pnpm lint`; commit "Correct a manual transaction's date on web and iPhone".

### Task 4: Spending periods and saved preferences (COO-229)

**Files:**
- Create: `apps/mobile/src/features/finances/spending-scope.ts`, `spending-scope.test.ts`
- Modify: `apps/mobile/src/features/finances/data.ts` (`useSpending`), `presentation.ts` (`periodScope` callers), `spending.tsx`, `apps/mobile/src/features/settings/workspaces.tsx` (`preferenceGroups` only)
- Test: `apps/mobile/src/features/finances/screens.test.tsx`, `apps/mobile/src/features/settings/workspaces-mounted.test.tsx`

**Interfaces:**
- Produces:
  - `type SpendingPeriodKind = "today" | "week" | "month" | "custom"`
  - `spendingRange(kind: SpendingPeriodKind, timezone: string, weekStartsOn: 0|1|2|3|4|5|6, now?: Date, custom?: { from: string; through: string }): { from: string; through: string }`
  - `spendingQuery(prefs: Partial<FinancesWorkspacePreferences>, range: { from: string; through: string }, timezone: string): FinanceSpendingQuery`
  - `spendingHint(prefs): string` e.g. "Your share · pending included · refunds subtracted"
  - `useFinancePreferences(): { finances: FinancesWorkspacePreferences; weekStartsOn: number; ready: boolean }` in `data.ts`
  - `useSpending(range, prefs)` replaces `useSpending(period)`; returns the same shape as today.

- [ ] **Step 1: Failing unit tests** in `spending-scope.test.ts`: today = one day in the planning zone; week honours `weekStartsOn` 0 and 1; month = first to last day; custom passes through, and custom without dates falls back to week; `spendingQuery` maps `financeSpendingBasis`, `financeSpendingIncludePending`, `financeSpendingSubtractRefunds`, `financeSpendingIncludeUncategorized`; missing prefs use `getDefaultWorkspacePreferences("finances")`; hint text for `full_outflow` + pending excluded + refunds not subtracted is "Full outflow · pending excluded · refunds not subtracted".
- [ ] **Step 2:** Implement `spending-scope.ts` (use domain `localDateAt`/`addLocalDays`; port only what is needed from `apps/web/src/features/finances/spending-period.ts`).
- [ ] **Step 3: Failing screen tests:** period `Segments` offers Today / This week / This month / Custom; starting period comes from `financeSpendingPeriod`; Custom shows From and Through `DateField`s and refuses through < from with one toast; the request carries the saved basis and toggles; the hint shows the applied values; `financeSpendingPeriod: "custom"` saved with no route dates starts on This week; group drill-down reference uses the same query.
- [ ] **Step 4:** Implement in `data.ts` and `spending.tsx`. Route params: `period=today|week|month|custom`, `from`, `through`. Preferences are read with `api.getWorkspaceSettings("finances")` and `("calendar")` through `useFinanceRead`.
- [ ] **Step 5:** Settings copy: "Spending defaults on other devices" → "Spending defaults"; "Transaction defaults on other devices" stays; "Finance layout on other devices" → "Finance layout" with help "Spending view applies on iPhone; bubbles shows as a list. Grouping and transaction layout apply on web and desktop." Update the mounted tests that query by these titles.
- [ ] **Step 6:** Run test files, mobile typecheck, `pnpm lint`; commit "Apply saved spending preferences and add today and custom periods on iPhone".

### Task 5: Trends and rhythm views, activity evidence, Assistant unread (COO-229)

**Files:**
- Create: `apps/mobile/src/features/finances/spending-trends.tsx`, `spending-rhythm.tsx`, `spending-views.test.tsx`, `activity-evidence.tsx`, `activity-evidence.test.tsx`, `apps/mobile/src/app/finance-activity.tsx`, `apps/mobile/src/features/finances/conversation-unread.ts`
- Modify: `spending.tsx` (view `Segments`), `assistant.tsx` (`Activity` rows `onPress`; mark rendered), `apps/mobile/src/components/workspace-tabs.ios.tsx` (badge), `apps/mobile/src/app/_layout.tsx` (register `finance-activity`)

**Interfaces:**
- Consumes: Task 4's `spendingRange`, `spendingQuery`, `useSpending`, `useFinancePreferences`.
- Produces: `SpendingTrends({ current, previous, onSelect })`, `SpendingRhythm({ dashboard, weekStartsOn })`, `FinanceActivityEvidenceScreen()`, `useFinanceConversationUnread(): { count: number; label: string | null; latestAgentSequence: string | null }` (`label` is `"99+"` above 99, `null` at 0), `WorkspaceTabs` accepts badges through a `badges?: Record<string, string | null>` prop or an internal hook keyed by page name.

- [ ] **Step 1: Failing view tests:** view `Segments` List / Trends / Rhythm; start from `financeSpendingView` (`bubbles` → List); Trends requests the previous equal-length period and labels each bar's accessibility text with date, amount and difference; Rhythm groups by weekday for week/month/custom and by hour for Today (port the binning from `apps/web/src/features/finances/spending-rhythm-bins.ts` as pure functions with their own tests); a previous-period read failure shows the current period alone and one error toast.
- [ ] **Step 2:** Implement both views with plain `View` bars in the style of `spending-chart.tsx`.
- [ ] **Step 3: Failing evidence tests:** Activity row press pushes `/finance-activity?id=<entry.id>`; the screen lists the entry's summary and audit events from `api.getFinanceActivityEvidence(id, {cursor})`, pages with "Show more", and renders record links: transaction → `/finance-transaction?id`, chat message → `/finance-chat-reference`, review case → `/finance-reviews`; an unknown record type renders as plain text, not a link.
- [ ] **Step 4:** Implement the screen and route.
- [ ] **Step 5: Failing unread tests:** hook polls `api.getFinanceConversationUnread()` every 30 s, parses decimal strings with `BigInt`, stops on 401/403; the Finance tabs render the badge on `assistant` only; opening the Conversation segment calls `api.markFinanceConversationRendered(latestAgentSequence)` once per new sequence and then refetches; a failed mark is silent (background) and retried on next focus.
- [ ] **Step 6:** Implement; use `NativeTabs.Trigger.Badge` in `workspace-tabs.ios.tsx`.
- [ ] **Step 7:** Run test files, mobile typecheck, `pnpm lint`; commit "Add spending trends and rhythm, activity evidence and the Assistant unread badge on iPhone".

### Task 6: Finance setup screen (COO-228)

**Files:**
- Create: `apps/mobile/src/features/finances/setup.tsx`, `setup-review.tsx`, `setup-maintenance.tsx`, `setup.test.tsx`, `apps/mobile/src/app/finance-setup.tsx`
- Modify: `apps/mobile/src/features/finances/overview.tsx` (setup row), `apps/mobile/src/app/_layout.tsx`

**Interfaces:**
- Produces: `FinanceSetupScreen()`; `useFinanceOnboarding()` (query key `["finances", owner, "onboarding"]`) returning the `FinanceOnboardingSnapshot` read state.

- [ ] **Step 1: Failing tests:** each question can be set to Answered (with its value) / None / Not sure; Save review sends `saveFinanceOnboardingAnswers({expectedRevision, idempotencyKey, automationChoice, displayPreferencesReviewed, answers})` with one idempotency key per attempt, reused on retry of the same draft; blockers render the domain copy for each code from `deriveFinanceOnboardingReadiness`; Finish setup is disabled while the draft is dirty or `canComplete` is false, and sends `completeFinanceOnboarding`; unknown-outcome failure locks both writes and shows "Reload setup review"; 409 says the review changed elsewhere and reloads; Prepare budget sends `setupFinances({operation:"prepare_budget"})`; maintenance card sends `{operation:"start"}` or `{operation:"resume", runId}` and shows stage label, headline and `nextAction.reason`; Overview shows "Finish Finance setup" only when `completedAt` is null; all results via toast; `expectNoInlineResult()`.
- [ ] **Step 2:** Implement, porting behaviour (not markup) from `apps/web/src/features/finances/onboarding-review.tsx`, `setup-page.tsx`, `setup-maintenance.tsx`. Generate keys with `randomUUID` from `expo-crypto`.
- [ ] **Step 3:** Run tests, mobile typecheck, `pnpm lint`; commit "Complete Finance setup and start maintenance on iPhone".

### Task 7: Finance automations screen (COO-228)

**Files:**
- Create: `apps/mobile/src/features/finances/automations.tsx`, `automation-registration.tsx`, `automations.test.tsx`, `apps/mobile/src/app/finance-automations.tsx`, `apps/mobile/src/app/finance-automation-new.tsx`
- Modify: `apps/mobile/src/features/finances/setup.tsx` (link when choice is "now"), `assistant.tsx` or `overview.tsx` (one navigation row "Automations"), `apps/mobile/src/app/_layout.tsx`

**Interfaces:**
- Consumes: Task 6's `FinanceSetupScreen`.
- Produces: `FinanceAutomationsScreen()`, `FinanceAutomationRegistrationScreen()`.

- [ ] **Step 1: Failing tests:** lists `listAutomationHostSchedules()` with state, next expected, last observed and an "Overdue" value when health says so; Rename sends `updateAutomationHostSchedule(id, {expectedVersion, label})`; "Cancel setup" appears only for `setup_pending` and sends `{expectedVersion, expectedState:"setup_pending"}` after a confirm; "Remove registration" appears only for `active`/`paused` and sends that state after a destructive confirm; create form requires label, a connection that has `finances:maintain`, host kind and time zone and sends `createAutomationHostSchedule`; a `setup_pending` schedule offers "Enter host automation ID" which sends `bindAutomationHostSchedule(id, …)`; 409 on any write says it changed elsewhere and refetches; state shown always comes from the refetched list, never from the request; one line of copy says fire tokens, prompts and run recovery are managed on the web; `expectNoInlineResult()`.
- [ ] **Step 2:** Implement, porting behaviour from `apps/web/src/features/finances/automations-page.tsx` and `automation-registration.tsx`. Invalidate `["finances", owner]` after writes.
- [ ] **Step 3:** Run tests, mobile typecheck, `pnpm lint`; commit "View and manage Finance automations on iPhone".

### Task 8: Mail snooze, snoozed view and bulk triage (COO-241)

**Files:**
- Modify: `apps/api/src/routes/mail.ts` (~223), `apps/api/src/mail-service.ts`, `packages/api-client/src/features/mail.ts`, `packages/api-client/src/client.test.ts`
- Create: `apps/mobile/src/features/mail/snooze.ts`, `snooze-sheet.tsx`, `selection.tsx`, `snooze.test.ts`, `bulk.test.tsx`
- Modify: `apps/mobile/src/features/mail/logic.ts` (`MailScope` adds `{kind:"snoozed"}`), `data.ts`, `triage.ts`, `thread-list.tsx`, `thread-row.tsx`, `reader.tsx`, `mailboxes.tsx`
- Test: API route/service test beside existing mail tests; `apps/mobile/src/features/mail/mail.test.tsx`

**Interfaces:**
- Produces:
  - API `DELETE /v1/mail/threads/:id/snooze` → 204; client `unsnoozeMailThread(id: string): Promise<void>` (id encoded with `encodeURIComponent`).
  - `snoozePresets(now: Date, timezone: string): { id: "later" | "tomorrow" | "next-week"; label: string; until: string }[]` — Later today = now + 3 h; Tomorrow = next day 08:00; Next week = next Monday 08:00, planning zone, ISO output.
  - `useMailTriage()` additionally returns `snooze(thread, until)`, `unsnooze(thread)`, and `bulk(threads, operation)` where `operation` is `"archive" | "read" | "unread" | { snoozeUntil: string }` and the result is `{ failed: string[] }`.
  - `MailChange` gains `snoozedUntil?: string | null`.

- [ ] **Step 1: Failing API tests:** DELETE removes an existing snooze and the thread returns to the default list; DELETE with no snooze is 204; unknown thread 404; requires the same scope as POST snooze. Client test asserts method and encoded URL.
- [ ] **Step 2:** Implement route, service method and client method.
- [ ] **Step 3: Failing `snooze.test.ts`:** the three presets at a fixed `now` in `America/Chicago` across a DST boundary; a custom time earlier than `now` is refused.
- [ ] **Step 4: Failing screen tests:** row and reader menus offer "Snooze…"; picking a preset sends `snoozeMailThread(id, until)`, the row leaves the inbox through the overlay, toast offers Undo (10 s) that calls `unsnoozeMailThread`; Mailboxes lists "Snoozed" (query `{snoozed:true}`) with each wake time and an Unsnooze action; unknown outcome → "not confirmed" toast and a re-read after `UNCONFIRMED_RECHECK_MS`.
- [ ] **Step 5: Failing `bulk.test.tsx`:** long-press starts selection; cap 100; Select all / Cancel; each action runs threads one at a time; with 3 selected and the second failing: the failed id stays selected, the toast reads "2 archived; 1 not confirmed. Refresh before retrying." as an error toast, Undo calls restore only for the two confirmed; read and unread offer no Undo; selection clears when the scope or search changes; `expectNoInlineResult()`.
- [ ] **Step 6:** Implement following `features/tasks/task-list.tsx` (selection state ~80, toolbar ~439–484, `perform` ~278–322) and the existing triage overlay rules.
- [ ] **Step 7:** Run test files, api/api-client/mobile typecheck, `pnpm lint`; commit "Snooze and bulk-triage Mail on iPhone".

### Task 9: Mail attention, steward findings and questions (COO-238)

**Files:**
- Create: `apps/mobile/src/features/mail/attention.tsx`, `stewardship.tsx`, `stewardship.test.tsx`
- Modify: `apps/mobile/src/features/mail/thread-list.tsx` (inbox header section), `reader.tsx`, `data.ts`; move `mailAttention()` from `features/briefing/today.tsx:51` to `features/mail/logic.ts` and import it back into Today

**Interfaces:**
- Produces: `useMailAttention()` (key `["mail", owner, "attention"]`, `api.listAttentionItems({domain:"mail", status:"open", limit:100})`), `MailAttention({ onOpen })`, `ThreadStewardship({ threadId })`.

- [ ] **Step 1: Failing tests:** inbox scope shows "Needs you" with the filtered items (expired and run-summary items excluded), hidden when empty and on non-inbox scopes; a row with a thread opens that thread in the reader; the reader shows "What nohmi found" with disposition and reason, open obligations, and each open question with reason, evidence and options; choosing an option and "Send answer" calls `answerMailQuestion(id, {answer, expectedVersion, generalize:false})`; success toast and the question leaves the open list after refetch; 409 → "This question changed elsewhere." and refetch; unknown outcome → not confirmed, option stays chosen; a stewardship read failure leaves the message readable and raises one error toast; `expectNoInlineResult()`.
- [ ] **Step 2:** Implement, porting behaviour from `apps/web/src/features/mail/thread-stewardship.tsx` (`QuestionControl` ~375). Do not add disposition or obligation editing.
- [ ] **Step 3:** Run tests plus `apps/mobile/src/features/briefing` tests, mobile typecheck, `pnpm lint`; commit "Show what needs you in Mail and answer steward questions on iPhone".

### Task 10: Mail rules — inspect, create, preview, turn on (COO-238)

**Files:**
- Create: `apps/mobile/src/features/settings/mail-rule-editor.tsx`, `mail-rule-preview.tsx`, `mail-rules.test.tsx`, `apps/mobile/src/app/settings/mail/rule-new.tsx`
- Modify: `apps/mobile/src/features/settings/workspaces.tsx` (`MailRules`, `MailRuleSettingsScreen`, `MailRuleDetails` only)

**Interfaces:**
- Produces: `MailRuleEditorScreen()`, `MailRulePreview({ rule })`.

- [ ] **Step 1: Failing tests:** rule detail shows its conditions and actions in plain words; "Add rule" opens the editor (name, condition fields and action from `createMailRuleInputSchema`); Save calls `createMailRule` and the rule appears Off; "Preview" calls `previewSavedMailRule(id)` and shows matched count, scanned count, a truncated-window note and the candidate subjects; "Turn on" is absent before a preview and afterwards sends `activateMailRule(id, {fingerprint, candidateIds, expectedVersion})` from that preview; 409 → "This rule or its matches changed. Preview it again." and the preview is cleared, rule stays Off; Disable keeps its current behaviour; settings list updates through `useSettingsListPublisher("mail-rules")`; `expectNoInlineResult()`.
- [ ] **Step 2:** Implement with `useSettingsAction`; read the exact `ActivateMailRuleInput` field names from `packages/domain/src/mail.ts:613` and use them (the names above are descriptive).
- [ ] **Step 3:** Run tests plus `workspaces-mounted.test.tsx` and `workspace-records-mounted.test.tsx`, mobile typecheck, `pnpm lint`; commit "Create, preview and turn on Mail rules on iPhone".

### Task 11: Documentation

**Files:**
- Modify: `docs/design/mobile-frontend.md`, `docs/product/implementation-log.md`, `apps/mobile/README.md` (only if it lists screens)

- [ ] **Step 1:** Add one `###` section per slice under the Finance and Mail mobile sections (spending views and preferences; setup and automations; transaction date; snooze and bulk; attention, questions and rules), describing behaviour as built. Replace line ~963 ("Snooze, bulk selection and deletion are separate work (COO-241)") with what now exists; deletion stays out.
- [ ] **Step 2:** Add one implementation-log entry "2026-11-18 — iPhone completion: remaining slices (local candidate)" listing the six issues, the two API additions, what was verified (tests) and what was not (device, production).
- [ ] **Step 3:** `pnpm lint`; commit "Record the remaining iPhone slices in the mobile design and implementation log".
