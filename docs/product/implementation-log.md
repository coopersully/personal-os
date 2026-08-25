# ilo — Implementation Log

This log records delivered vertical slices against the master plan. It does not imply that an epic is complete until all of its listed completion criteria are met.

## 2026-08-25 — Mail no-send boundary

- Removed Gmail send authority, iCloud SMTP delivery, application TCP 587 egress, and every typed
  client, MCP, and web compose/send affordance. Ilo never sends user email.
- Retained an authenticated compatibility window for historical Ilo drafts: owners can list,
  export locally, or permanently delete them, while former mutation endpoints return a permanent
  `410 feature_unavailable` response.
- This contraction establishes the safety boundary for the approved Mail steward design; it does
  not claim that the stewardship ledger, maintenance turn, learning loop, or review artifact have
  shipped.

## 2026-08-23 — Provider-aware event conferencing

- Added unique Google Meet generation for events created on writable Google calendars using the
  provider's conference-data contract, while preserving pasted meeting links for local, iCloud,
  Zoom, Teams, Webex, Jitsi, Whereby, GoTo Meeting, Around, and Riverside workflows.
- Kept generation capability honest: Zoom and Teams generation require future dedicated provider
  connections and are not presented as connected merely because a URL can be attached.

## 2026-08-23 — Calendar stewardship foundations

- Added a server-owned Calendar playbook release and research registry, with a fixed 30-day prior
  and 90-day future assessment horizon and a 15-minute connected-source freshness boundary.
- Added stable, evidence-bound findings for source readiness, unsupported recurrence, direct timed
  busy-event overlap, active-profile buffer shortfall, and tentative holds. Private event prose,
  attendees, locations, raw provider payloads, and credentials do not enter the review envelope.
- Added owner-scoped durable findings, immutable Calendar reviews, input-fingerprint invalidation,
  and multidimensional status that blocks or reports unknown instead of turning partial evidence
  into a healthy zero.
- Added an authenticated Calendar schedule-health page and read-scoped typed API. It can assess and
  advise, but it cannot change events or provider state.
- This is slice 1 of the approved Calendar Ilo target. Durable maintenance runs, `maintain_calendar`,
  MCP wiring, questions, reusable rules, collaboration stewardship, and travel routing are not
  claimed as shipped.

## 2026-08-21 — Finance agent ledger stewardship

- Added one default-off, signed-in-user-controlled Finance setting that lets a
  scoped agent apply confident ledger changes without individual review. The
  same calls otherwise produce review; missing evidence always produces a
  bounded question.
- Added exact apply-or-review operations for profile, income, budgets,
  transactions, categorization, merchant learning, alerts, mixed purchase
  allocations, and internal reimbursement tracking.
- Added durable maintenance candidates, resumable paged preparation, the
  twelve-check ledger challenge, one-turn settlement, same-run verification,
  and immutable period reviews. Migrations `0060`–`0065` hold action reviews,
  allocations/reimbursements, candidates, challenges, and reviews.
- Added `get_finance_status`, `maintain_finances`,
  `get_finance_ledger_challenge`, `submit_finance_ledger_challenge`, and
  `get_finance_period_review` as the complete-workspace MCP flow while retaining
  granular surgical tools.
- Simplified the web workspace around Overview, Review, Transactions, Cash
  flow, Budgets, Subscriptions, Accounts, and Ledger health. Review shows
  questions first and one maintenance approval; cash flow exposes reimbursement
  progress; transactions support exact-cent mixed breakdowns.
- Kept provider connection/import, account administration, ambiguous transfer
  confirmation, review approval/dismissal, and the bypass setting outside MCP
  authority. MCP cannot move money, trade, pay bills, or file taxes.
- Remaining production evidence: final deployment and provider behavior still
  require production-equivalent observation; green local fixtures do not prove
  external provider availability.

## 2026-08-06 — Recoverable connector authorization and durable initial sync

- Replaced raw Google/X callback errors with no-store `303` redirects and owner-only, allowlisted
  authorization outcomes. Settings and Setup now show one plain-language result and one recovery
  action without provider payloads, codes, scopes, or identities.
- Added S256 PKCE for Google, durable thirty-minute authorization attempts, idempotent replay,
  issuer validation, exact granted-capability checks, and fail-closed partial consent that leaves
  existing accounts unchanged.
- Moved Google and iCloud initial synchronization onto coalesced database triggers. The one-minute
  scheduler drains those triggers through the existing fenced sync engine, while successful
  accounts retain the five-minute reconciliation backstop and bounded retry policy.
- Confirmed the production SSM Google client ID matches the authorized OAuth client and the client
  secret remains a secure runtime parameter. Provider push remains an optional latency layer; it is
  not required for correctness and must not be enabled without external watch/identity evidence.

## 2026-08-06 — Notification-driven connector convergence

- Added incremental Gmail history and capability-discovered iCloud CalDAV collection sync, with
  bounded pagination/multiget, explicit deletion evidence, opaque cursor fencing, and controlled
  full-reset fallback when a provider cursor is invalid or unsupported.
- Added durable Gmail and Calendar watch renewal, authenticated/deduplicated public notifications,
  and bounded iCloud IMAP IDLE change signals. Every signal coalesces into the same fenced sync
  engine; five-minute reconciliation remains authoritative.
- Added independent disabled-by-default production gates, exact-path WAF rate boundaries, privacy-
  bounded operational events, and alarms for subscription health, renewal lag, rejected delivery,
  trigger age, and sync freshness.
- Kept Gmail/Calendar push disabled pending non-secret evidence of the external GCP topic IAM,
  subscription OIDC authority/audience, Google publishing/verification, and production-equivalent
  delivery/reconciliation/renewal checks. Repository configuration alone is not marked as proof.

## 2026-08-05 — Actionable connected-account health

- Replaced raw Google/X response handling and blanket iCloud credential errors with a whitelisted,
  provider-neutral failure contract. Only positive authorization evidence asks a person to
  reconnect; unknown/provider transport text is never persisted or returned.
- Added durable failure category, recovery owner, attempt count, last-attempt time, and next-due
  time. Existing external-account errors migrate to safe automatic recovery without copying legacy
  text.
- Scheduled Calendar-only and Mail-enabled accounts every five minutes with bounded concurrency,
  fenced stale-claim recovery, 1/5/15/60-minute backoff, structured redacted observations, and
  CloudWatch failure/configuration alarms.
- Added Ready, Syncing, Retrying automatically, Reconnect required, and ilo-owned service-attention
  states to Connections, plus direct Google/iCloud reconnect actions and Mail/Calendar callouts.
- Made SSM Parameter Store authoritative for both Google OAuth values and made production startup
  fail closed when either is absent.
- Hardened production deployment preflight and recovery so a rollout validates and pins the exact
  task definition whose unique Google secret references were inspected, proves a complete API drain
  before recovery, and cannot launch a stale or ambiguously configured candidate.
- Proved the hardened release on production task definition revision 64: API, MCP, web, secret
  references, execution-role authority, rollback, autoscaling, and iCloud scheduled sync were
  healthy. Existing Google grants were truthfully classified as revoked and reached Google's
  reconnect boundary without exposing raw provider responses.
- Kept Google availability incomplete for general users after live reconnect exposed Google's
  unverified-app warning. Provider publishing, restricted-scope verification, and the Gmail
  security-assessment gate are tracked in [issue #84](https://github.com/coopersully/personal-os/issues/84)
  and remain production release requirements rather than being inferred from valid credentials.
- Closed the infrastructure-evidence gap found during rollout: production deploy and hourly health
  now fail closed unless the exact live connector failure/configuration filters and alarms match
  their redacted patterns, metrics, thresholds, periods, missing-data policy, and notification
  routes. A separate inline policy gives the deployment role only read access to metric-filter
  metadata without coupling its apply to task-definition or edge-resource changes.

## 2026-08-02 — Agent-owned setup protocol

- Added one authenticated, server-owned setup plan with stable semantic steps,
  observed connection evidence, exact domain scope, required tools, approval
  ownership, and honest current/blocked/complete state.
- Exposed the plan through `get_ilo_setup` so a connected agent can inspect Ilo,
  ask only unresolved questions, save a draft, preserve signed-in approval
  boundaries, and re-read the plan after every state change.
- Split agent controls into Connected agents and Workspace access, with the unavoidable connection handoff plus supervised
  agent-owned setup. Skill installation and copied procedural prompts are now
  optional protocol details rather than required user work.
- Published the optional compatibility reference as v0.2.0 on Ilo's immutable
  website path and added narrow migration from the prior v0.1.0 website release
  and recognized official GitHub sources.

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
- Mail setup and Workspace access now expose pending, in-progress, reconciliation, failed, oldest-due,
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

## 2026-07-29 — Mail-to-Calendar intake prerequisite

- Added a durable, idempotent source handoff for provider-projected calendar MIME attachment
  metadata with exact account/message/part identity, cached-source fingerprint, and redacted audit
  provenance.
- All current intake remains `provider_projected_unverified` and `preview_only`; cached prose,
  attachment metadata, caller classification, and setup preferences cannot authorize Calendar
  creation. Mail setup explicitly reports automatic creation disabled.
- Reserved server-owned evidence kinds and durable lifecycle states for a follow-up authenticated
  paired-iTIP verifier and Calendar executor. Per-message provider labels/revision, explicit MIME
  part versus attachment-body identity, and a deliberately non-authoritative OAuth account-address
  hint preserve the Google SENT-reply verification seam; the verifier must fetch Gmail profile
  identity. No event creation, provider write, rule preset activation, or MCP task machinery is
  included.
- Bound iCloud identities to mailbox UIDVALIDITY plus UID, reconcile Gmail message disappearance
  only from explicit complete-thread responses, and fence projection with persisted connector sync
  generations, including inline rule effects and their local/audit projection. Mailbox reset, source
  deletion, capability transitions, and reordered old sync responses therefore demote, serialize,
  or fail closed instead of preserving stale authority.

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
- Added a deployment-aware agent connection handoff to account setup and Settings:
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
