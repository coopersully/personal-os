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

The server exposes read/create/update/complete/delete reminder tools; read/create/update/delete event
tools; calendar discovery; mailbox, mail search, conversation, and mail rule tools; actor-aware
activity history; and Finance tools. Destructive and read-only annotations are included for
compatible MCP hosts.

The shared assistant tools give Claude, Codex, and other MCP hosts one consistent setup vocabulary:

- `get_agent_setup_status` discovers accessible domains and existing profile state.
- `get_domain_profile` and `save_domain_profile` read and maintain durable domain preferences,
  source meanings, categories, and instructions.
- `list_attention_items`, `create_attention_item`, and `update_attention_item` use the same shape
  for important items, upcoming commitments, follow-ups, and post-run summaries across domains.

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
  from that page is not treated as provider deletion. Archive and recoverable Trash rules,
  including immediate and one-day preferences, remain disabled and preview-only until a durable
  due-work queue exists.
- saved rules are re-reviewed with `review_mail_rule`, then activated only by the signed-in person
  in **Settings → Agent access → Review Mail rules**. The API rechecks the reviewed version,
  candidate facts, action due states, and fingerprint inside one locked transaction, rejects
  preview drift, and atomically records
  `approved_rule` plus enabled state. Acceptance must state that the candidates are a bounded recent
  sample and the enabled condition governs future matching sync material. A signed review is valid
  for 15 minutes.
- automatic execution coalesces compatible actions into one provider call per thread and processes
  at most six threads with two workers. Backlog remains pending for later syncs; failures persist a
  redacted run summary and return a structured aggregate repair contract rather than an all-green
  sync.
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

The shared `save_domain_profile` tool may save a Finance guidance draft with
`finances:write`. It cannot activate that draft: activation is a signed-in
action in **Finances → Profile**, requires an owned account source, and uses
the profile version guard. `sourceContexts` describe how to interpret accounts;
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

The fixed `personal-os://agenda/today` resource merges open reminders due through the current local day with that day's selected-calendar events.

Tool annotations are host hints, not authorization. Read-only cached Mail tools are closed-world;
provider writes and sending are open-world. Rule activation is intentionally absent from MCP
because approved rules can mutate provider state; it requires the signed-in Settings review.
Retention rules and any other delayed Mail rules cannot activate in this release. The API still enforces scopes,
source ownership, policy, optimistic
versions, audit, and the distinction between recoverable Trash and permanent deletion. Bulk
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
install request for the versioned `ilo-setup` skill, and a domain-specific
starter prompt. A new account can go directly there from the Ready step.

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
