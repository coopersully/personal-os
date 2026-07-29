# ilo — Implementation Log

This log records delivered vertical slices against the master plan. It does not imply that an epic is complete until all of its listed completion criteria are met.

## 2026-07-29 — Reproducible agent handoff and core-domain readiness

- Pinned the official `ilo-setup` v0.1.0 source to one Git commit and added a
  checked release manifest plus version/revision/source contract for
  configurable self-hosted releases. The exact former official `main` URL
  migrates idempotently; custom mutable sources still fail validation.
- Made Agent Access readiness follow the selected Mail, Finance, Calendar, or
  Reminder domain through domain-owned adapters using existing APIs for
  material, profile, workflow, and bounded open attention state.
- Kept Mail first-class with rule review and durable-work detail while making
  Calendar preview-only, Reminder notification limits, and Finance signed-in
  review boundaries explicit.
- Separated successful empty state from loading and unavailable reads, disabled
  missing/unsupported guide domains, and derived agent authority from active
  connected-host scopes rather than the signed-in browser session.
- Reframed the recommended sequence as a host-agnostic copy handoff for Claude,
  Codex, and other compatible MCP hosts; Ilo does not claim one-click host
  installation.

## 2026-07-29 — Durable and recoverable Mail retention rules

- Added a durable work ledger keyed by account, provider thread, accepted rule revision, and action
  fingerprint. It records source/profile revisions, due and retry time, claim lease, attempt count,
  provider-effect certainty, terminal state, and only redacted failure details.
- Activation enqueues matching observed conversations and synchronization enqueues future matches.
  Gmail's bounded newest-thread page remains positive evidence only: previously observed older
  conversations are retained and stay eligible.
- Scheduled execution claims at most six conversations with two workers, revalidates the active
  rule, profile, retention preference, source, condition, and label destination, and coalesces
  compatible actions into one provider call. One-day recoverable Trash uses Gmail's dedicated
  Trash operation; no permanent-delete capability exists.
- Stale claims, timeouts, credential-persistence failures, and provider-success/local-commit
  failures enter exact thread reconciliation before any replay. Rate limits back off; rejected or
  exhausted work fails closed and creates visible account attention.
- Mail setup and Agent access now expose pending, in-progress, reconciliation, failed, oldest-due,
  and last-completed automation state without credentials or message bodies.

## 2026-07-28 — Finance agent-guided setup and safe review workflows

- Added a Finance-owned guided context that combines owned account sources, ledger and review
  readiness, cash-flow context, human-only boundaries, and trustworthy suggested workflows with
  the shared durable Finance profile.
- Added a short Finance interview reference with explicit preference units, user terminology,
  source meanings, review cadence, thresholds, and safety constraints.
- Made categorization preview read-scoped and revision-guarded. Each accepted decision now commits
  its ledger change, evidence, review resolution, optional human merchant rule, and audit record
  atomically; below-threshold reviews are audited, proposal pages are cursor-paginated, and
  four-worker batches retain structured per-decision partial-result reporting without exhausting
  the database pool.
- Kept account/provider/import/profile/budget administration, permanent merchant rules, and
  ambiguous transfers behind interactive human review. The MCP surface is now proposal/read-only
  for ledger decisions, while the API retains actor attribution and defensive stale/policy checks.
- Agents can save Finance guidance drafts; only the signed-in Finance profile surface can activate
  one, with an owned source and exact profile version.
- Added Finance-owned readiness and activation presentation without expanding the shared Settings
  handoff.

## 2026-07-28 — Mail guided-setup expansion

- Added a credential-free Mail setup context that preserves account identity, mailbox roles and
  counts, freshness/error state, and Google-versus-iCloud automatic-rule capability.
- Added typed inbox-style, important-email, and safe noise-retention preferences. Noise defaults to
  review-only; recoverable Trash may use a user-chosen delay as short as one day.
- Preserved previously observed threads when provider sync returns a capped recent page. Archive and
  recoverable Trash rules remain preview-only until Mail has a durable due-work queue.
- Added source-derived important-email attention items with same-thread serialization and shared
  profile/attention/audit envelopes.
- Made the rule lifecycle explicit: proposed previews disclose their dated 200-thread window and
  truncation state, saved rules re-preview before signed-in Settings activation, fingerprint drift
  conflicts, and active matching behavior must be paused before editing.
- Audited Mail MCP annotations and descriptions, preserved structured results, and added
  per-conversation partial-failure reporting for bulk provider writes.

## 2026-07-29 — Shared attention ownership and concurrency

- Restricted generic attention creation to unlinked notes; Mail, Calendar, Reminder, and Finance
  material references now come only from domain-owned paths that validate ownership and derive
  source identity server-side.
- Added Finance transaction attention and source-linked categorization proposals without expanding
  the agent's categorization authority.
- Added integer attention versions and expected-version status updates so stale agents cannot
  overwrite newer refresh, resolution, or reopening state.
- Made delayed Mail run-summary create, refresh, and resolution emit redacted connector audits in
  the same transaction as the attention mutation.

## 2026-07-28 — Calendar agent-guided setup and evidence proposals

- Added a dedicated Calendar setup interview for source meanings, default writable destination,
  hard/flexible commitments, time zone, busy-block privacy, buffers, and automatic-creation
  evidence.
- Added a Calendar-owned strong-evidence candidate and preview contract with payload fingerprints,
  possible exact-match hints, profile-alignment checks, provider-effect disclosure, and explicit
  unverified-source status.
- Calendar MCP discovery now exposes source capability and sync state, clarifies external provider
  effects for every mutation, and routes ticket, booking, registration, and explicit-acceptance
  evidence through proposal-first tools.
- Direct mutations require source and independent block revisions, report completed,
  indeterminate, and pending provider effects through API, MCP, and redacted server observations,
  and direct the caller to synchronize before retrying.
- Calendar-owned attention derives and refreshes event provenance without copying notes. Active
  profiles return to draft when a referenced source disappears or the default loses write access.
- The bounded proposal path does not apply caller-supplied evidence, scan Mail, send invitations,
  create recurrence or buffer events, or rearrange existing commitments. Durable verified intake,
  idempotent apply/repair, and Mail-to-Calendar ingestion remain integration work.

## 2026-07-28 — Agent-guided setup and shared assistant contracts

- Added versioned domain profiles for durable preferences, source meanings, user-defined categories,
  and operating instructions across mail, calendar, reminders, tasks, finances, and goals.
- Added one cross-domain attention-item structure for important information, upcoming commitments,
  follow-ups, and post-run summaries, with source attribution and audit history.
- Established a common rule envelope while leaving conditions, actions, and execution inside each
  domain. Mail is the first executable rule slice, with exact previews, delayed actions, scoped
  accounts, optimistic updates, and explicit activation policy.
- Migrated existing Mail rules through an expand/dual-read transition so older instances and
  existing rows remain safe during rollout; legacy columns can be contracted in a later release.
- Added matching API-client and MCP verbs plus the installable `ilo-setup` skill. Its short adaptive
  interview saves drafts first, previews exact candidates, and requires explicit acceptance before
  automatic behavior becomes active.
- Added a deployment-aware Agent access handoff to account setup and Settings:
  users can copy the remote MCP URL, install the guided-setup skill, choose a
  domain starter prompt, inspect Mail readiness, and manage connected hosts.

- Made remote OAuth the primary host connection with named, plain-language
  consent and the complete supported scope set, including `mail:write`; retained
  purpose-built personal-token presets as an advanced local fallback.

## 2026-07-27 — Immediate, resumable account setup

- New accounts enter a persistent guided setup immediately after registration,
  while established accounts remain uninterrupted.
- Added workspace-driven progressive disclosure for Google, Apple, and Finance
  connections, with a durable Exit setup action available throughout.
- Reused the production iCloud and Plaid connection paths and limited Google
  OAuth scopes to the Calendar and Mail services selected by the person.
- Preserved setup progress and the safe return destination through provider
  OAuth, then rendered the real connected account data on return.
- Documented setup as progressive configuration rather than a product-tour
  carousel in the design system and page contract.

## 2026-07-20 — Finance wealth and budget grounding

- Added a typed wealth summary to the API, client, and MCP: net worth splits cash, investments, debt, and other assets; annual income excludes transfers.
- Added account-kind persistence and a budget setup context that presents monthly income, planned limits, and remaining capacity instead of guessing from transfers.

## 2026-07-21 — Finance intelligence, cash flow, and accountable automation

- Added effective-dated financial profiles, stated-versus-observed income provenance, inferred income streams and recurring obligations, in-app alerts, and conservative cash-flow forecasts.
- Kept categorization, recurring detection, and transfer reconciliation evidence-led: uncertain candidates are visible in the review queue, and repeated user confirmation—not a single agent guess—builds automation confidence.
- Added the shared finance API-client and MCP surfaces for ledger health, transactions, categories, budgets, merchants, review decisions, wealth, cash flow, recurring payments, and alerts. The MCP adapter contains no independent finance policy.
- Added budget pace data and the overview contribution-style graph with complete calendar cells, muted blanks, week/month/year views, and restrained ahead/behind colors.
- Consolidated the branch-only Finance migrations 0016–0020 into `0016_finance_intelligence.sql`, retaining the confidence and transfer-review backfills before the migration chain reaches a shared branch.
- Documented the feature boundaries, ledger invariants, income provenance, forecast ordering, agent limits, and migration rule in [ADR 0003](../architecture/0003-finance-intelligence.md).

## 2026-07-20 — Finance transaction ledger clarity

- Replaced transaction cards with a sortable TanStack table: one transaction per row, localized dates, readable direction and amount labels, and an inline review action.
- Established server-side ledger sorting and opaque cursor pagination across the typed API and web client. The default is newest first, sorting resets the page, and table rows stay single-line until their details are explicitly opened.
- Added unambiguous signed amount treatment: income is green with a plus sign, expenses are red with a minus sign, and transfers remain neutral.
- Added a visible merchant-entity cue: a check means the transaction is linked to a canonical merchant, and a question mark means it still needs an entity match.
- Translated provider category codes to human labels in the ledger; raw values such as `TRANSFER_OUT` no longer reach the user-facing table.
- Corrected confidence storage to basis points, added a migration for the prior percentage-point rows, and kept the typed client contract at a safe 0–1 value. A 9,500-basis-point provider signal now appears as 95%.
- Recorded these ledger behaviors in the experience standards and added API/UI coverage for the conversion and the new table cues.
- Verification includes lint, type checks, focused Finance/API/UI coverage, and desktop/mobile E2E. The repository uses its documented 95% statements/functions/lines and 94% branch coverage floor, supplemented by targeted tests for Finance safety paths.

## 2026-07-18 — Today clarity and completed-work integrity

- Reworked Today around a single glanceable flow: current activity, immediate next event, remaining commitments, then later schedule details.
- Moved completed reminders into a collapsed **Done today** history and kept the open-work count limited to actionable reminders.
- Enforced the same rule in the Daily Brief service: completed reminders cannot appear in `overdue`, `today`, or `anytime` automation output.
- Added API integration coverage for the completion exclusion and UI coverage for expanding completed history/reopening an item.
- Verified with the local runtime and the focused API/web regression suite. Generated shadcn primitives are excluded from product coverage; shared product compositions remain covered by the repository floor and focused behavior tests.
