# nohmi — Assumptions and Load-Bearing Choices Audit

- Date: 2026-07-18
- Method: **exactly five** independent passes. Each pass starts from a different failure mode, cites current primary documentation or research, and can overturn an earlier conclusion.
- Decision: **refine before broadening implementation.** The product vision is feasible, but only when the choices below become non-negotiable architectural contracts rather than aspirational prose.
- Companion documents: [Master Product & Experience Design](./master-design.md) and [Complete Implementation Plan](./master-plan.md).

## Executive decision register

| Critical choice | Assumption tested | Verdict | Load-bearing decision |
| --- | --- | --- | --- |
| Unified nohmi | One generic “material” table can make mail, events, tasks, journals, and transactions unified. | Reject. | Keep native, domain-specific records as their source of truth; create a typed link/annotation graph and a shared activity/search projection above them. |
| Provider synchronization | Local copies can be treated as a convenient cache. | Refine. | Local provider projections are disposable and revisioned; user-authored links, policies, approvals, local material, and audit evidence are not. |
| Agent authorization | MCP scopes, descriptions, and UI confirmations make an agent safe enough. | Reject. | The API policy engine enforces scope, source selection, action tier, origin/egress checks, rate limits, idempotency, and approval state. Tool annotations are never authority. |
| Automation host | A Codex or Claude subscription can own schedules and durable routine state. | Reject. | nohmi owns trigger evaluation, queue, state machine, cancellation, retries, and emergency stop. A model host is a bounded, revocable runner adapter. |
| Gmail automation | Mail read, archive, triage, rules, and sending are a single ordinary connector integration. | Refine. | Incremental, separately disclosed scopes and provider-compliance gates are required. Read, manage, send, settings/filters, and permanent deletion are distinct capabilities. |
| Finance data | Transactions are a stable ledger once shown. | Reject. | Transactions are a cursor-driven change stream: added, modified, removed, pending, posted, and reconciliation-linked. Pending data is explicitly provisional. |
| “Free” product posture | Subscription agent hosts and Plaid remove meaningful operating cost. | Reject. | The core works manually/local-first; paid connectors and model hosts are optional, visible dependencies with graceful degraded modes. |
| Overlay and widgets | One responsive web surface can deliver widgets and urgent notification behavior everywhere. | Reject. | Web/PWA, Tauri, Apple WidgetKit, and Windows widget surfaces are adapters with a shared privacy-filtered API. Widgets are glanceable/deep-link surfaces; notifications carry urgency. |
| ADHD-aware planning | More scheduling intelligence necessarily improves daily execution. | Refine. | Planning is optional, conservative, explainable, reversible, and non-clinical. It offers choices and protects time; it never grades, diagnoses, or silently reschedules commitments. |
| “A coverage percentage means fully tested” | Line/branch coverage alone can prove a personal-data product safe. | Reject. | The repository enforces a 95% statements/functions/lines and 94% branch floor, but release confidence additionally needs contract, provider-simulator, migration, accessibility, visual, offline, recovery, and threat-model evidence. |

## Pass 1 of 5 — Data ownership and synchronization

**Challenge.** Does “one nohmi” mean one data model, and can a reset safely replace everything stored locally?

**Evidence.** Google Calendar’s incremental sync requires a persisted token, returns deleted entries during change sync, and can return `410 Gone`, requiring the client to wipe its synchronized event store and re-sync. It also requires preserving the same query shape across incremental pages. [Google Calendar synchronization](https://developers.google.com/workspace/calendar/api/guides/sync) Gmail and Plaid likewise expose incremental histories/change streams rather than immutable snapshots; Plaid’s `/transactions/sync` returns `added`, `modified`, and `removed` updates from a cursor. [Plaid Transactions](https://plaid.com/docs/transactions/)

**What fails in practice.** A generic “material” row cannot safely represent a Calendar recurrence exception, an email thread, a local task, a journal privacy tier, and a pending bank transaction without either losing provider semantics or slowly re-inventing every domain as nullable columns. A database-wide reset would also erase the very relationships—the task created from an email, an approval decision, a busy mirror rule—that make the overlay valuable.

**Decision.** Unification happens through a typed graph, not premature universal storage. Every native record has a stable internal ID, provider/source ID where relevant, source revision, projection status, and links to other records. A provider full sync may replace that provider’s normalized projection and cursor only. It may never clear user-authored links, tags, notes, projects, rules, approvals, journal data, or audit evidence.

**Plan changes required.** Add an explicit `material_links`/source-reference contract and connector-reconciliation contract before message-to-task, busy-mirroring, or agent-generated material ships. Test a forced provider reset preserving local overlay data.

## Pass 2 of 5 — Security boundaries and agent authority

**Challenge.** Are user-visible scopes and confirmation dialogs an adequate boundary when an agent can read hostile third-party content and then mutate external systems?

**Evidence.** MCP’s authorization specification requires OAuth Resource Indicators, binding credentials to the intended resource/audience. [MCP authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) The MCP tools specification treats annotations as hints, not a security policy. [MCP tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) OpenAI’s prompt-injection guidance recommends limiting data/tool access and requiring confirmation for consequential actions because indirect instructions in external content remain a real threat. [Prompt injection guidance](https://openai.com/safety/prompt-injections/)

**What fails in practice.** “The agent only has `mail:manage`” is insufficient if a malicious email can persuade it to send a calendar invitation, export content, choose a recipient, or widen the task. A pretty approval card is insufficient if an API or MCP caller can bypass it. Client-provided scope, policy, or tool-risk claims are also forgeable.

**Decision.** The API/domain service is the single policy decision point. It evaluates token audience and expiry; material/action/source constraints; policy tier; connector capability; content origin; destination/egress; concurrency; idempotency; and the approval object. Untrusted content may provide evidence for a proposed action, but cannot choose an external destination, authorize itself, expand scope, or cross into a new sensitive domain. Approval must show the exact mutation, recipients/destinations, source evidence, and reversibility.

**Plan changes required.** Build policy evaluation and source-to-sink controls before writable mail, RSVP, finance rules, or autonomous routines. Require adversarial fixture tests: a hostile mail body must not cause send, scope escalation, rule creation, or cross-domain disclosure.

## Pass 3 of 5 — Automation reliability, human control, and daily planning

**Challenge.** Can scheduled Claude/Codex jobs safely be the product’s automation backbone, and can a planning system help without becoming coercive?

**Evidence.** Codex explicitly supports focused inbox and verified-operation workflows, which validates it as a capable optional worker—not as the owner of another product’s state. [Codex automation use cases](https://developers.openai.com/codex/use-cases?category=automation&category=data) Research finds time-perception differences associated with ADHD and evidence of planning/prospective-memory challenges, supporting an accommodation-oriented planner rather than a diagnostic one. [2024 time-perception meta-analysis](https://pubmed.ncbi.nlm.nih.gov/38145491/) [Adult prospective-memory study](https://pmc.ncbi.nlm.nih.gov/articles/PMC3590133/)

**What fails in practice.** External model hosts can be paused, change permissions, lose credentials, duplicate a retry, or return an ambiguous result. A daily planner that auto-fills every open minute makes a brittle schedule and can turn normal incompletion into a shame signal. “Run every morning” without a durable run identity, input snapshot, timeout, and cancellation model produces duplicate or invisible actions.

**Decision.** nohmi owns a durable routine definition, trigger evaluator, queue, worker lease, idempotency key, structured run state, limits, approval queue, retry policy, cancellation, dead letter, and audit log. Runner adapters receive only a bounded job plus a scoped short-lived credential and return a structured proposal/result. Today uses Now, Next, Remaining, and Done; capacity is a conservative suggestion based on explicit work hours, hard events, buffers, and user estimates. It offers defer/split/reduce/schedule choices and never silently moves hard events or presents health/productivity judgments.

**Plan changes required.** Make dry-run, replay, cancellation, duplicate-delivery, runner-unavailable, and approval-expiry acceptance tests prerequisite to enabling any recurring routine. Add a low-stimulation Today usability study before making capacity recommendations a default.

## Pass 4 of 5 — Provider capability, compliance, and financial truth

**Challenge.** Are the desired connector actions technically and operationally viable as one release stream?

**Evidence.** Gmail distinguishes `gmail.modify`, `gmail.send`, and `gmail.settings.basic`; Gmail data scopes are restricted, and server storage/transmission of restricted-scope data requires a security assessment. [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) Google also limits Gmail-data use to defined, user-benefiting use cases and imposes stringent security requirements. [Google Workspace User Data Policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy) Gmail supports batch label modification, so scalable archive/label workflows are technically plausible. [Gmail batch modify](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/batchModify) Plaid says pending records commonly become a new posted record one to five business days later and can be removed or altered; the two records may not even appear in the same sync page. [Plaid transaction states](https://plaid.com/docs/transactions/transactions-data/) Its launch checklist also requires reconnect/error and pagination-restart handling. [Plaid launch checklist](https://plaid.com/docs/launch-checklist/)

**What fails in practice.** The roadmap would be unsafe if it treats “archive,” “trash,” “delete,” “unsubscribe,” “send,” and “create a mail filter” as the same level of permission. Likewise, a finance categorization engine that learns from pending purchases can create duplicate rules, distort a budget, and present false certainty.

**Decision.** Connector capability is data, not hard-coded UI. Gmail uses incremental consent and distinct product operation classes; because Google's `gmail.modify` grant itself permits compose/send, nohmi must separately deny sending unless its own `mail:send` policy and approval requirements are satisfied. Ordinary cleanup may move to Trash, while permanent deletion is a separate explicit capability and policy. A provider-compliance/security review is a gate before public Gmail mutation. Finance uses `/transactions/sync` cursor application as the canonical reconciliation path, preserves pending→posted linkage where supplied, and never learns durable rules or makes settled-budget/safe-to-spend statements from pending data. Manual, CSV, and OFX sources remain parity paths, not import afterthoughts.

**Plan changes required.** Split connector epics into a sandbox/private-user release path and a public-production/compliance path. Add a formal capability matrix, provider webhooks/signature validation, re-authentication state, and transaction-change fixtures before promising broad automation.

## Pass 5 of 5 — Device reality, privacy, cost, and proof of quality

**Challenge.** Can the overlay, widgets, mobile experience, and “free with subscriptions” promise remain reliable and private across platforms?

**Evidence.** WidgetKit renders a timeline outside the main app process and uses a dynamic reload budget; push updates supplement rather than replace timeline behavior. [Apple WidgetKit updates](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date?changes=_1%2C_1) Apple also distinguishes timeline widgets from Live Activities. [WidgetKit](https://developer.apple.com/documentation/widgetkit?changes=latest_minor) Plaid data arrives asynchronously—initial data can be incomplete and update frequency depends on the institution—so data freshness must be shown rather than implied. [Plaid Transactions](https://plaid.com/docs/transactions/) WCAG 2.2 adds requirements relevant to this interaction-heavy product, including focus visibility, target size, accessible authentication, and alternatives to dragging. [What’s new in WCAG 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/)

**What fails in practice.** A widget is not a real-time notification channel and cannot be a full sensitive-data client. A desktop sprite that insists on attention can harm rather than help. “Use your existing model subscription” does not cover connector operating costs, provider compliance, native-platform work, offline conflicts, or an unavailable model host. High code coverage does not prove an OAuth revocation, duplicate webhook, offline conflict, drag alternative, or accessibility regression works.

**Decision.** The privacy-filtered API is the sole boundary for PWA, Tauri, WidgetKit, Windows widgets, and notification adapters. Widgets show only user-selected, privacy-safe summaries and deep links; notifications handle urgency and are deduplicated/quiet-hour aware. The overlay always respects reduced motion, focus mode, and device privacy. Product copy calls paid integrations optional and shows source freshness/availability. The coverage floor is retained as a code gate and supplemented by risk-based evidence rather than substituted for it.

**Plan changes required.** Build platform adapters after the API/privacy contract, with native-device acceptance tests. Add offline/conflict, notification privacy, reduced-motion, keyboard-only drag alternative, visual-regression, connector-simulator, and security/recovery suites to the release gate. Never make a widget or pet the only route to a critical action.

## Result after five passes

The direction should be **ironed out and refined, not narrowed**. The key correction is sequencing: make native material contracts, policy/approval enforcement, reconciliation, and routine orchestration real before adding broad autonomous behavior or native shell surfaces. That preserves the comprehensive ambition while avoiding the two most expensive failure modes: a product that appears unified but corrupts provider/user-owned state, and an agent system that appears safe but can be bypassed by content or retries.

The master plan and design now incorporate these as mandatory implementation and release gates. Any future feature proposal must identify: its native source of truth; link/ownership model; least privilege and policy tier; provider capability and repair behavior; idempotency/reversal behavior; privacy surface; degraded/manual path; and the evidence required to enable it by default.
