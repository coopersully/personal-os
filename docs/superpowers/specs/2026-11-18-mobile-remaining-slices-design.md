# iPhone completion: remaining slices (design)

Date: 2026-11-18. Epic: COO-10. Issues: COO-229, COO-254, COO-228, COO-241, COO-238, COO-265.
Source of scope: the Linear issues above and Cooper's instruction on 2026-11-18 to finish all
remaining work in one pull request, built quickly, with refinement afterwards.

## Goal

Bring the iPhone app (`apps/mobile`) to the end of the planned parity work: the last two Finance
slices, the manual transaction date change, the last two Mail slices, and the approved CI audit
exception. One branch, one pull request.

## Rules that apply to everything

- The product name in any user-facing text is `nohmi`, lowercase. No former product names.
- Action feedback (pending, success, failure) is one Sonner toast per action (`sonner-native` on
  mobile). No inline result text, banner or card. Tests assert the toast and the absence of inline
  result copy. Pull-to-refresh uses the standard spinner and one error toast only.
- A write whose outcome is unknown (network error, 408, 5xx) is reported as not confirmed and is
  never retried blindly. A 4xx other than 408 is a confirmed rejection.
- Icons come only from `@/components/icons` on web and the mobile icon registry; add a glyph by
  adding a registry entry.
- Reuse existing mobile building blocks (`FinanceScreen`, `Card`, `Copy`, `Section`, `Segments`,
  `FinanceRow`, `ReadState`, `Action`/`Actions`, `FormSave`, `DateField`, `RowActions`,
  `EntityPicker`). No new native dependency.
- No change to database schema. API changes are limited to the two named below.
- Each slice records itself in `docs/design/mobile-frontend.md` (one `###` section) in the final
  documentation task, not in the slice task.

## COO-265: audit exception

`pnpm audit --prod` ignores exactly GHSA-fc5q-39xc-vjpf (picomatch <= 4.0.7, no fixed release)
through pnpm's `auditConfig.ignoreGhsas`. Nothing else about the audit step changes. The exception
is documented with advisory, reason, approval (Cooper, 2026-11-17), owner (Cooper), exit condition
(remove when a fixed picomatch ships) and tracking issue COO-265.

## COO-254: change a manual transaction's date

- `updateFinanceTransactionInputSchema` gains optional `date` (`z.iso.date()`); the refine accepts
  category, notes or date.
- The service writes `transactionDate` only when the transaction's account has
  `provider === "manual"`. Otherwise it rejects with a validation error (400) whose message says
  dates on synced transactions cannot be changed. Provider-synced dates stay read-only (decided).
- A request that changes `date` must carry `expectedTransactionUpdatedAt`, and a mismatch is a 409
  on every path (human and reviewed).
- MCP `update_finance_transaction` accepts `date`; its description and the generated tool
  dictionary are updated.
- Web: the transaction detail dialog offers a date field for manual transactions.
- iPhone: the transaction editor shows a Date row (`DateField`, `dateOnly`) for manual
  transactions; synced transactions keep the read-only row.

## COO-229: spending views and saved preferences

- Periods: Today, This week, This month, Custom (from/through date pickers). Week start follows the
  Calendar workspace preference `weekStartsOn`.
- Saved Finance preferences are applied to every spending request: `financeSpendingBasis`,
  `financeSpendingIncludePending`, `financeSpendingIncludeUncategorized`,
  `financeSpendingSubtractRefunds`, and `financeSpendingPeriod` as the starting period. The summary
  hint states the applied basis and toggles instead of fixed text.
- Views: List (today's group list), Trends (daily bars compared with the previous equal period),
  Rhythm (spend by weekday, or by hour for Today). Bubbles is not built on iPhone (decided).
  `financeSpendingView` picks the starting view; `bubbles` falls back to List.
- Settings: the two groups titled "… on other devices" for spending and transaction defaults lose
  that suffix where the iPhone now applies them; the layout group's help text is corrected to say
  which layout choices the iPhone applies.
- Activity rows in the Assistant tab open an evidence screen (`/finance-activity`) showing the
  entry, its audit events, and links to the transaction, review or chat reference it names.
- The Assistant tab shows an unread badge from `getFinanceConversationUnread()` (polled every
  30 s, "99+" above 99). Showing the Conversation segment marks it rendered through the latest
  agent sequence.

## COO-228: Finance setup and automations

- `/finance-setup`: the onboarding review (answer each question as answered / none / unknown,
  confirm display preferences, choose automation now or later), Save review, Finish setup (enabled
  only when saved and the server says it can complete), Reload after a failed write, blocker copy
  from the domain readiness function, "Prepare budget", and a maintenance card that starts or
  resumes a run and shows its stage, headline and next action.
- Overview shows a "Finish Finance setup" row while onboarding is incomplete. There is no
  redirect gate on iPhone.
- `/finance-automations`: schedules with health (next expected, last observed, overdue), rename,
  cancel setup (`setup_pending` only), remove registration (`active`/`paused` only), create a
  registration (label, connection with `finances:maintain`, host kind, time zone) and bind a host
  automation id. Fire tokens, host prompts and run recovery stay on web (decided); the screen says
  so in one line of plain copy.
- Only server-confirmed state is shown as done. A schedule is never shown active because a write
  was sent.

## COO-241: snooze and bulk triage

- API addition: `DELETE /v1/mail/threads/:id/snooze` removes a snooze (idempotent, 204), with
  `unsnoozeMailThread(id)` in the api-client.
- Snooze from the row and reader menus opens a sheet: Later today (+3 h), Tomorrow 8:00, Next week
  (Monday 8:00), or a chosen date and time (`DateField`), all in the planning time zone. A time in
  the past is refused before sending.
- Mailboxes gains a "Snoozed" destination listing snoozed threads with their wake time and an
  Unsnooze action.
- Long-press starts selection (cap 100). The bar offers Archive, Mark read, Mark unread, Snooze,
  Select all, Cancel. Bulk actions run one thread at a time through the existing single-thread
  calls. Threads that were not confirmed stay selected; the toast says how many were done and how
  many were not confirmed; Undo covers only confirmed archives and snoozes. Read and unread offer
  no Undo.

## COO-238: attention, questions and rules

- The inbox shows a "Needs you" section above the list: open Mail attention items (first 100,
  not expired, not run summaries); a row tied to a thread opens that thread.
- The reader shows a "What nohmi found" section from `getMailThreadStewardship`: the disposition
  and its reason, open obligations, and open questions. A question shows its reason, evidence and
  options; choosing an option and Send answer calls `answerMailQuestion` with the question's
  version. A 409 says it changed elsewhere and reloads.
- Settings → Mail rules: the rule screen additionally shows conditions and actions; rules can be
  created (name, condition, action) and are always created disabled; "Preview" shows matched and
  scanned counts and candidates; "Turn on" is available only after a preview and sends that
  preview's fingerprint, candidate ids and rule version; Disable stays as it is.

## Out of scope

Follow-up issues COO-256 to COO-264, device and production verification, TestFlight, web bubbles
view on iPhone, fire tokens and host prompts on iPhone, bulk delete of Mail.
