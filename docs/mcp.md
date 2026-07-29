# MCP integration

The MCP server is an adapter over the authenticated ilo API. It contains no reminder, calendar,
mail, finance, provider, or audit rules of its own.

## Transports

- `apps/mcp/dist/stdio.js` for local MCP hosts. Configure `PERSONAL_OS_API_URL`, `PERSONAL_OS_TOKEN`, and optionally `PERSONAL_OS_TIMEZONE`.
- `apps/mcp/dist/http.js` for Streamable HTTP. Send `Authorization: Bearer pos_…`; optionally send `X-Personal-OS-Timezone`.

The HTTP server is stateless: it creates an isolated MCP server and transport for each request and
uses the caller's audience-bound Ilo access token against the Ilo API. It never accepts or forwards
provider credentials. Replacing this same-service bearer handoff with an internal credential
exchange is a bounded shared-MCP follow-up; Finance does not invent a domain-local token path.

## Tools

The server exposes focused Reminder list/get/create/update/complete/trash/restore tools and an exact,
read-only overdue-deferral preview; read/create/update/delete event tools; calendar discovery and an
evidence-based commitment preview tool; mailbox, mail search, conversation, and mail rule tools;
actor-aware activity history; and Finance tools. Destructive, read-only, idempotent, and open-world
annotations are compatible-host UX hints only. Authorization, policy, source evidence, provider
capability, structured errors, conflict handling, audit history, recoverable deletion, and
partial-effect reporting remain deterministic API behavior.

The shared assistant tools give Claude, Codex, and other MCP hosts one consistent setup vocabulary:

- `get_agent_setup_status` discovers accessible domains and existing profile state.
- `get_domain_profile` and `save_domain_profile` read and maintain durable domain preferences,
  source meanings, categories, and instructions.
- `list_attention_items`, `create_attention_item`, and `update_attention_item` use the same shape
  for important items, upcoming commitments, follow-ups, and post-run summaries across domains.
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
  counts, sync freshness/error state, automatic-rule support, and deferred safety boundaries. It
  returns no provider credentials.
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
  in **Settings → Agent access → Review Mail rules**. The API rechecks the reviewed version,
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

Finance tools are a read/proposal adapter over the same Finance API used by the web app.
`get_finance_guided_setup` is the entry point for a short Finance interview: it
returns the shared durable profile together with owned account sources, review
and ledger readiness, human-only boundaries, and suggested workflows. The
remaining tools include transactions, categories, budgets, merchants, review
work, wealth, cash flow, recurring obligations, and alerts. Agents should read
ledger health and the relevant transactions before offering a budget or
cash-flow recommendation.

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
API failures. Finance does not add domain-local `outputSchema` declarations
while combined API responses lack a shared MCP schema convention; capability
negotiation and output schemas are a bounded shared-MCP follow-up. OAuth uses
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

The fixed `personal-os://agenda/today` resource merges open reminders due through the current local day with that day's selected-calendar events.

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

Open **Settings → Agent access** for the current deployment's MCP URL, the
install request for the versioned `ilo-setup` skill, its immutable source
revision, and a domain-specific starter prompt. A new account can go directly
there from the Ready step. The handoff works with Claude, Codex, and other
compatible MCP hosts, but Ilo does not claim to install into a host: the person
copies the connection URL and prompts into the host they already use.

The connection guide reports one artifact identity as `version`, `revision`,
and `sourceUrl`. The official URL is pinned to the reported Git commit.
Self-hosted deployments supply all three values and the API rejects a source URL
that does not embed its configured revision. The official tuple is sourced from
the checked release manifest; deployment projections are verified by the
repository lint contract. The one-time legacy official `main` URL migration is
documented in [deployment](deployment.md#upgrade-from-the-mutable-official-url).

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
- `automations:read`, `automations:write`
- `bookmarks:read`
- `audit:read`
- `finances:read`, `finances:write`

Only a token hash is stored. Revoke a host without ending human sessions or affecting another host. Connector and account administration remain human-only.
