# MCP integration

The MCP server is an adapter over the authenticated ilo API. It contains no reminder, calendar,
mail, finance, provider, or audit rules of its own.

## Transports

- `apps/mcp/dist/stdio.js` for local MCP hosts. Configure `PERSONAL_OS_API_URL`,
  `PERSONAL_OS_TOKEN`, and optionally `PERSONAL_OS_TIMEZONE` and `APP_BASE_URL`.
- `apps/mcp/dist/http.js` for Streamable HTTP. Send `Authorization: Bearer pos_…`; optionally
  send `X-Personal-OS-Timezone`. `/mcp/readonly` exposes the same server with every mutation
  removed from discovery.

The HTTP server uses the MCP TypeScript v2 per-request factory. Modern July 2026 requests and the
stateless 2025 compatibility path are built from the same server definition. Before constructing
that definition, the adapter validates the audience-bound Ilo token through
`GET /v1/assistant/context`. The returned user identity, scopes, planning time zone, setup
readiness, and Ilo links determine the request's discovery surface. Provider credentials never
enter the MCP process.

`APP_BASE_URL` is required in deployed API and MCP containers. The MCP container uses it for
server/tool icons, structured recovery links, its MCP App CSP, and protected-resource
documentation. Compose and Terraform set the same first-party origin used by the web app.

## Architecture and progressive disclosure

`apps/mcp/src/server.ts` is a composition root only. Feature files own input schemas and API calls;
`tool-catalog.ts` owns the domain, workflow stage, policy, read/write posture, scope requirements,
and visual-entrypoint status of every tool; `tool-surface.ts` enforces that catalog uniformly.
Adding a tool without a catalog record fails while the server is being constructed.

### Workspace Ilo intent surface

For a mature workspace Ilo, prefer a small high-level intent pair:

- `get_<workspace>_status` reports setup readiness, source freshness, maintained-state checks,
  backlog, active or recoverable work, open questions, and the latest review.
- `maintain_<workspace>` starts, resumes, or verifies the domain-owned maintenance turn for `all`,
  a bounded time window, or an exact target.

These names are a product convention, not a claim that every workspace already advertises both
tools. `get_ilo_context` remains the authority for what the current connection can use. Granular
tools remain available for useful surgical inspection, previews, and exact authorized actions.

Maintenance is not batch CRUD and the MCP host does not provide the sequence. The workspace API
owns its expert playbook, rulebook, orchestration, durable run state, question/learning loop,
advisory model, review artifact, idempotency, and completion decision. MCP only validates the
intent, calls the authenticated typed API, and returns the durable state. A host instruction such
as `maintain finances` should therefore work consistently without embedding Finance procedure in a
Claude, Codex, or other client automation.

The maintenance intent never widens scopes or policy. Consequential actions retain the policy,
revision, source evidence, audit, and recovery behavior of their surgical operations. A terminal
result distinguishes maintained, maintained-with-questions, blocked, and failed outcomes and links
to the workspace's review and recovery surfaces. See
[`ADR 0004`](architecture/0004-workspace-ilo-stewardship.md).

Discovery follows these rules:

1. `get_ilo_context` and `get_ilo_setup` remain available after authentication so an agent can
   orient itself and repair setup. The legacy `get_agent_setup_status` alias is omitted from normal
   discovery; a bounded compatibility host can opt in through the server construction option while
   it migrates.
2. A domain tool is advertised only when the token has one of its required scopes.
3. A read-only server never advertises mutation tools, even when the token itself has write scopes.
4. Every advertised tool has all four annotation hints, a shared output schema, an Ilo icon, and
   metadata identifying its domain, policy, and workflow stage.
5. The API rechecks scope, ownership, policy, revisions, and provider capability. Discovery and
   annotations improve agent behavior but never grant authority.

The workflow stages are `context`, `inspect`, `prepare`, `commit`, `verify`, and `recover`.
Preview tools are read-only `prepare` operations. Direct changes use `approve_each`; domain-owned
rules use `approved_rule`; normal reads use `read_only`. `get_ilo_context` returns the tools
actually available on that connection together with the safe workflow and links back to Today,
activity, Reviews, Workspace access, approvals, and recovery.

Every tool result keeps its feature payload under `result` (or its structured `error`/empty `ok`)
and adds `_ilo` with the domain, stage, policy, read-only state, and first-party links. Text content
remains available for clients that do not consume structured output.

## Resources, prompts, and visual work surface

The primary resource namespace is `ilo://`:

- `ilo://context/self` provides authenticated identity, readiness, scopes, and available tools.
- `ilo://setup/{domain}/{step}` provides one server-owned setup step.
- `ilo://guidance/{domain}` provides active or draft domain guidance. Drafts are explicitly
  non-operative.
- `ui://ilo/work-surface` is a self-contained `text/html;profile=mcp-app` view for context,
  previews, approvals, and verification results. Selected entry tools link to it through standard
  `_meta.ui.resourceUri` metadata; all tools retain text and structured fallbacks.

`personal-os://agenda/today` and `personal-os://brief/daily` remain readable compatibility
resources. New clients should begin with `get_ilo_context` or `ilo://context/self`.

The server publishes task-oriented prompts for setup, daily planning, Mail triage, Calendar
commitment preparation, overdue Reminder review, Finance review, and a weekly review. Prompts
compose existing tools and approval boundaries; they do not embed new authority or business
rules. MCP Tasks are intentionally not advertised yet: current long-lived Mail and Finance work
has durable API-owned lifecycle state, but no shared MCP task handle contract. Exposing protocol
Tasks before that contract exists would create a misleading in-memory completion surface.

## Tools

The server exposes focused Reminder list/get/create/update/complete/trash/restore tools and an exact,
read-only overdue-deferral preview; read/create/update/delete event tools; calendar discovery and an
evidence-based commitment preview tool; mailbox, mail search, conversation, and mail rule tools;
actor-aware activity history; and Finance tools. Destructive, read-only, idempotent, and open-world
annotations are compatible-host UX hints only. Authorization, policy, source evidence, provider
capability, structured errors, conflict handling, audit history, recoverable deletion, and
partial-effect reporting remain deterministic API behavior.

The shared assistant tools give Claude, Codex, and other MCP hosts one consistent setup vocabulary:

- `get_ilo_setup` is the authoritative setup entrypoint. Call it immediately after connection and
  after every draft save, signed-in approval, or capability change. It returns the actual current
  semantic step, selected step context, observed evidence, scoped authority, domain instructions,
  required tools, approval owner, and next action. Reading a step never mutates or advances setup.
- `get_agent_setup_status` remains a compatibility view of accessible domains and profile state;
  it is not the procedural setup source of truth.
- `get_domain_profile` and `save_domain_profile` read and maintain durable domain preferences,
  source meanings, categories, and instructions.
- `list_attention_items`, `create_attention_item`, and `update_attention_item` use the same shape
  for important items, upcoming commitments, follow-ups, and post-run summaries across domains.
  Generic creation is an explicitly unlinked note path: it cannot accept source or related-entity
  provenance. Linked material must use its owning domain tool. Every attention item exposes an
  integer `version`, and status changes require `expectedVersion`; a stale mutation returns a
  structured conflict with the current version.
  Linked Calendar event attention must instead use `create_calendar_attention_item`: the API locks
  the owned event, derives its source reference, refreshes the open event/kind item, and writes a
  redacted audit atomically. Generic unlinked Calendar notes remain available, but generic callers
  cannot claim `calendar_event` provenance.

Reminders use a typed profile vocabulary for capture defaults, priority meanings, deadline versus
notification intent, time zones, overdue review, thresholds, and preferred automatic actions.
Those stored preferences guide agents; they do not grant, revoke, or enforce API authority.
`dueAt` drives due/overdue views and is not proof of notification delivery. Direct single-Reminder
mutations remain audited API actions. Their audit policy comes from the API's validated interactive
user or scoped-agent decision, never from profile preferences. Bulk overdue deferral begins with
`preview_overdue_reminder_deferral`, which returns the complete bounded candidate set, `preview`
policy, `previewedAt`, source references, and revisions without mutating. Guarded individual updates and
consequential state changes use `expectedUpdatedAt` so concurrent changes surface as conflicts.
The API service requires that revision for every agent update, complete/reopen, trash, and restore,
not merely for MCP callers. Guarded trash and restore revisions travel in POST request bodies;
the bodyless DELETE route remains signed-in-user compatibility and still performs recoverable
trash rather than permanent deletion.
`create_reminder_attention_item` locks and validates one active Reminder, derives its local source
and revision, and refreshes the open Reminder/kind item. Generic attention writes cannot claim
Reminder provenance.
Reminder list pagination accepts the returned `nextCursor`, and Reminder MCP failures preserve the
API error code, safe details, request ID, and HTTP status in structured content.

Rules share a versioned envelope—name, description, profile, sources, nullable confidence
threshold, policy, enabled state, and version—while each feature owns its condition and action
language. Mail uses exact deterministic matching, so its confidence threshold is always `null`.
Mail is the first executable implementation:

- `get_mail_setup_context` maps stable account IDs to user-facing inbox identity, mailbox roles and
  counts, sync freshness/error state, automatic-rule support, and deferred safety boundaries. Its
  commitment-intake summary reports provider-projected calendar attachment metadata as preview-only,
  with zero server-verified items and automatic creation disabled. It returns no provider
  credentials.
- `create_mail_attention_item` derives source attribution from an owned conversation and
  serializes same-thread/kind updates so important mail uses the shared attention envelope without
  duplicate open records.
- agent sending is draft-first: `create_mail_draft` records a durable local draft, and `send_mail`
  requires that draft ID plus an exact field match. A database claim permits only one provider
  attempt at a time. Ambiguous and stale attempts remain blocked until the signed-in person checks
  provider Sent Mail and resolves the draft in the Mail recovery panel.
- proposed rules preview against a dated, bounded window of at most 200 recent cached
  conversations. The response names the window and reports when it may be truncated.
- previously observed threads are retained when a provider returns its capped recent page; absence
  from that page is not treated as provider deletion. Reviewed Google archive and recoverable
  Trash rules, including one-day preferences, create durable work for matching observed and future
  synchronized conversations. Permanent deletion remains unavailable.
- saved rules are re-reviewed with `review_mail_rule`, then activated only by the signed-in person
  in **Settings → Workspace access → Mail**. The API rechecks the reviewed version,
  candidate facts, action due states, and fingerprint inside one locked transaction, rejects
  preview drift, and atomically records
  `approved_rule` plus enabled state. Acceptance must state that the candidates are a bounded recent
  sample and the enabled condition governs future matching sync material. A signed review is valid
  for 15 minutes.
- automatic execution coalesces compatible actions into one provider call per thread and processes
  at most six threads with two workers. Immediate and delayed retention both use a durable
  rule/action/thread identity. Leased claims recover through exact provider reconciliation after
  process loss or an uncertain external effect. Backlog remains pending for later scheduled runs;
  setup context exposes per-account pending, in-progress, reconciliation, failed, and
  last-completed state plus global oldest-due status, without message bodies or credentials.
- disconnecting or disabling Mail removes its cached provider mailbox/thread projection, detaches
  open thread/account attention provenance while preserving the user-visible signal, downgrades
  setup for review, and pauses affected rules. Calendar-specific profile invalidation is outside
  this Mail-only change and remains a follow-up.

New rules remain disabled and preview-only by default. Active rules must be paused before their
matching behavior changes, and connector sync executes only enabled `approved_rule` rules.
MCP annotations remain untrusted UX hints. The API and durable scheduler remain authoritative;
Mail-to-Calendar intake does not use experimental MCP task execution.

Finance tools are a read/proposal adapter over the same Finance API used by the web app.
`get_finance_guided_setup` is the entry point for a short Finance interview: it
returns the shared durable profile together with owned account sources, review
and ledger readiness, human-only boundaries, and suggested workflows. The
remaining tools include transactions, categories, budgets, merchants, review
work, wealth, cash flow, recurring obligations, and alerts. Agents should read
ledger health and the relevant transactions before offering a budget or
cash-flow recommendation.
`create_finance_attention_item` is the bounded exception to the otherwise read/proposal Finance
surface: it locks one owned transaction, derives provider/account/remote/revision attribution
server-side, deduplicates the same open transaction/kind item, and writes a redacted audit in the
same transaction. The audit carries `approved_rule` policy and privacy-safe source attribution
without merchant, amount, title, or summary content. Categorization proposals carry that same
derived transaction source reference from a consistent snapshot. Provider-backed CSV accounts
retain PayPal, Venmo, or Zelle attribution rather than being mislabeled as local.
Generic attention cannot claim Finance transaction provenance.

Categorization is intentionally proposal-first:
`propose_finance_categorizations` uses the Finance read scope on both `GET` and
the compatibility `POST` and does not mutate anything. Proposal pages return
an opaque `nextCursor`, and hosts can continue without making read calls mutate
the ledger. Direct transaction categorization is not an agent tool or
agent-permitted raw API shortcut. Applying a proposal, resolving any review or
alert, changing recurring state, adding a transaction, and renaming or merging
merchants require a signed-in Ilo session. Provider administration,
account/import/financial-profile/budget changes, permanent merchant rules, and
ambiguous transfer confirmation are also human-only.

The signed-in categorization batch API predates this guided-setup work and
commits each decision independently. Its bounded workers and per-item results
do not provide a durable batch or resume record if the process ends between
decisions. A follow-up must add an idempotency key, persisted per-item state,
query or resume support, and abort-aware scheduling. MCP does not expose this
human-only apply endpoint.

The shared `save_domain_profile` tool may save a Finance guidance draft with
`finances:write`. It cannot activate that draft: activation is a signed-in
action in **Finances → Profile**, requires an owned account source, and uses
the profile version guard. `get_finance_guided_setup` exposes active guidance
separately from a draft proposal. Draft text is explicitly untrusted and
non-operative until that signed-in activation; hosts must not inject it as
operating instructions. `sourceContexts` describe how to interpret accounts;
they do not limit which accounts a token can read. Scalar alert preferences
currently use one USD planning currency. Cadence and threshold preferences
guide later agent conversations; they neither schedule runs nor reconfigure
Finance alerts.

Tool annotations are host UX hints, not authorization. API scopes, policy,
revision checks, database invariants, and audit records enforce Finance safety.
Every Finance read tool declares all four annotation hints explicitly. The
shared API result helper supplies `structuredContent` and preserves structured
API failures. The shared MCP registration surface adds the same output envelope
and Ilo workflow metadata used by every other domain; Finance does not create a
domain-local result convention. OAuth uses
the MCP resource indicator, scopes remain least-privilege read/write grants,
and provider tokens never cross the MCP boundary.

Calendar setup records source meanings, default writable destination, hard/flexible semantics,
time zone, busy-block privacy, buffers, and the evidence kinds that would be eligible for automatic
creation after verified intake exists. `preview_calendar_commitment` accepts one exact,
caller-supplied ticket, booking, registration, or explicit-acceptance candidate and returns
destination/provider effects, a possible exact-match hint, policy reasons, warnings, and a payload
fingerprint without mutation. Exact matching is not durable deduplication, and the fingerprint is
not evidence authority. Caller-supplied evidence never permits
`approved_rule`; event creation remains an interactive action until a later integration persists a
server-verified source ownership/revision and idempotency identity. The bounded candidate cannot
add attendees, recurrence, or buffer events and never moves another event. Mail ingestion and
Mail-to-Calendar wiring are not part of this Calendar contract. The `calendar:write` scope remains
independent broad authority for direct event mutations; proposal-only agents should not receive
that scope. When one or more provider event mutations finish before a later provider or local
projection/audit failure, the API returns a reconciliation ledger with the Calendar operation,
completed, indeterminate, and pending provider effects, provider/calendar/remote identities, and
sync-before-retry recovery. An indeterminate effect means the provider did not confirm whether the
mutation completed. The API emits a redacted structured reconciliation log keyed by request ID;
the response and log are recovery evidence, not durable idempotency authority. These failures are
not safe to replay blindly. Agent mutations first read the event and then pass its `updatedAt` as
the local compare-and-swap revision. Compound mutations also pass the
exact event-ID-to-`updatedAt` map for every linked block because those blocks can change
independently. `source.revision` is provider provenance (the provider ETag when present, otherwise
the local `updatedAt`) and is not a substitute for the mutation fields. Delete returns the deleted
source and block revisions needed by restore. The public `updatedAt` contract and local CAS use
millisecond precision; a purely local event changed twice inside the same millisecond is the
remaining race. A future monotonic per-event revision, used instead of or alongside `updatedAt`,
would eliminate that local race. Connected projections also compare the provider ETag.

The compatibility `personal-os://agenda/today` resource merges open reminders due through the
current local day with that day's selected-calendar events.

## External-boundary record

| Concern | MCP answer |
| --- | --- |
| Capability and owner | MCP translates protocol operations to the authenticated Ilo API. Domain services and the API own behavior and authorization. |
| Configuration and authority | `MCP_PUBLIC_URL`, `APP_BASE_URL`, `PERSONAL_OS_API_URL`, `MCP_INTERNAL_SECRET`, the bearer token audience, and returned scopes must agree. |
| Transport | Public HTTPS Streamable HTTP terminates at `/mcp`; local hosts use stdio. The MCP-to-API hop is HTTPS in production and carries no provider credential. |
| Time and capacity | Requests use the existing API/provider deadlines and MCP fixed-window rate limit. Large or delayed provider work must already cross an API-owned durable handoff. |
| Commit point | A tool succeeds only for the durable API state represented by its response. MCP has no independent commit state. |
| Delivery semantics | Mutations inherit API optimistic revisions, idempotency, reconciliation, partial-effect, and recoverable-trash behavior. Annotations are not replay authority. |
| Degraded behavior | Authentication fails before protocol dispatch. API errors preserve code, safe details, request ID, status, and recovery metadata in the result envelope. |
| Recovery and observation | `_ilo.links`, API activity, feature recovery screens, and redacted request IDs lead the person or agent to the owning repair surface. |
| Evidence | Catalog coverage and scoped-discovery tests, API route/service tests, type checks, builds, Compose/Terraform agreement, E2E, and a post-deploy authenticated read-only smoke. |

A green mock can still miss a production mismatch among the public MCP audience, internal API
secret, deployed `APP_BASE_URL`, OAuth metadata, proxy Origin/Host policy, or the protocol client
era. Deployment verification must therefore perform a least-privilege authenticated
`get_ilo_context` call from a real MCP client and confirm that the returned links and scopes match
the intended account without invoking a provider mutation.

Tool annotations are host hints, not authorization. Read-only cached Mail tools are closed-world;
provider writes and sending are open-world. Rule activation is intentionally absent from MCP
because approved rules can mutate provider state; it requires the signed-in Settings review.
Reviewed Google archive and recoverable Trash rules may activate after signed-in review; automatic
execution for unsupported providers remains unavailable. The API still enforces scopes, source
ownership, policy, optimistic versions, audit, and the distinction between recoverable Trash and
permanent deletion. Bulk
provider updates report both successful IDs and structured per-ID failures when only part of a
request succeeds. Bulk updates are bounded to six conversations and two concurrent provider calls
so three 15-second provider waves still leave time beneath the 60-second public edge deadline for
local commits and a controlled response. If a provider succeeds but the atomic local
projection-and-audit transaction fails, the item failure reports `partialEffect: true` and directs
the caller to synchronize that Mail account before retrying.

Repair actions are signed-in user actions, not MCP tools. `sync_mail_account` means **Mail → Sync**;
`reconnect_then_sync_mail_account` means **Settings → Connections → reconnect**, then **Mail →
Sync**. `verify_sent_mail_then_reconcile_draft` means inspect provider **Sent Mail** and then use
the signed-in **Ilo Mail** recovery panel; never resend automatically. First-party/API sends without
a draft have no durable recovery object: `verify_sent_mail_never_retry` means inspect Sent Mail and
do not replay the request, not that Ilo can reconcile a missing audit record.

## Authorization

Open **Settings → Connected agents** for the current deployment's MCP URL. A new
account can go directly there from the Ready step. The person completes that
one unavoidable connection handoff; after authentication, the host calls
`get_ilo_setup` and Ilo supplies the current domain context and next work. A
separate skill install or copied procedural prompt is not required.

For compatibility with skill-aware hosts, the connection guide also reports one
optional artifact identity as `version`, `revision`, and `sourceUrl`. By default
the API derives the official URL from `APP_BASE_URL` and the checked, versioned
skill path. The web build publishes `SKILL.md`, its agent metadata, and relative
references at that path. The skill defers to the authenticated setup plan and
cannot grant scope or approve behavior. Self-hosted deployments may supply a
different public source, but the API rejects one that does not embed its
configured revision. The official tuple is sourced from the checked release
manifest; deployment projections are verified by the repository lint contract.
Legacy release migration is documented in
[deployment](deployment.md#upgrade-from-an-earlier-official-release).

Domain support is explicit. A missing or `unsupported` guide entry is not a
profile-only fallback, and hosts must not infer executable behavior from a
different domain's support level.

Remote MCP OAuth is the recommended connection. The host dynamically registers,
the user signs in to Ilo, and the consent page lists the requested permissions
before issuing audience-bound access and rotating refresh tokens. Provider
credentials remain inside Ilo. Local or manual hosts that cannot complete OAuth
can use an explicitly scoped personal access token from the advanced section.

Grant only the scopes the host needs:

- `reminders:read`, `reminders:write`
- `calendar:read`, `calendar:write`
- `mail:read`, `mail:write`
- `tasks:read`, `tasks:write`
- `goals:read`, `goals:write`
- `automations:read` (compatibility scope for the daily brief; no routine lifecycle)
- `bookmarks:read`
- `audit:read`
- `finances:read`, `finances:write`

Only a token hash is stored. Revoke a host without ending human sessions or affecting another host. Connector and account administration remain human-only.
