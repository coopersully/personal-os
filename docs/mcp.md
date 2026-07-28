# MCP integration

The MCP server is an adapter over the authenticated ilo API. It contains no reminder, calendar,
mail, finance, provider, or audit rules of its own.

## Transports

- `apps/mcp/dist/stdio.js` for local MCP hosts. Configure `PERSONAL_OS_API_URL`, `PERSONAL_OS_TOKEN`, and optionally `PERSONAL_OS_TIMEZONE`.
- `apps/mcp/dist/http.js` for Streamable HTTP. Send `Authorization: Bearer pos_…`; optionally send `X-Personal-OS-Timezone`.

The HTTP server is stateless: it creates an isolated MCP server and transport for each request and forwards only the caller's agent token to the API.

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

Rules share a versioned envelope—name, description, profile, sources, confidence threshold, policy,
enabled state, and version—while each feature owns its condition and action language. Mail is the
first executable implementation: agents can list, preview, create, and update mail rules. New rules
are disabled and preview-only by default, and connector sync executes only enabled
`approved_rule` rules.

Finance tools are an adapter over the same Finance API used by the web app.
`get_finance_guided_setup` is the entry point for a short Finance interview: it
returns the shared durable profile together with owned account sources, review
and ledger readiness, human-only boundaries, and suggested workflows. The
remaining tools include transactions, categories, budgets, merchants, review
work, wealth, cash flow, recurring-payment review, and alerts. Agents should
read ledger health and the relevant transactions before offering a budget or
cash-flow recommendation.

Categorization is intentionally proposal-first:
`propose_finance_categorizations` is a read-scoped `GET` and does not mutate
anything. An accepted apply must echo the proposal transaction's exact
`updatedAt` as `expectedTransactionUpdatedAt`; stale decisions fail without
overwriting newer data. Each decision is atomic, while a batch can truthfully
report `applied`, `review_required`, and structured `failed` results for
different transactions. The API runs at most four decisions concurrently.
Proposal pages return an opaque `nextCursor`, and hosts can continue without
making read calls mutate the ledger. Direct transaction categorization is not
an agent tool or agent-permitted raw API shortcut. Agent approval or
recategorization through the review tool must likewise carry the accepted
proposal confidence and transaction revision. Merchant merges and
recurring-payment, alert, and ordinary review decisions are bounded mutations.
Provider administration, account/import/profile/budget changes, permanent
merchant rules, and ambiguous transfer confirmation remain human-only.

Tool annotations are host UX hints, not authorization. API scopes, policy,
revision checks, database invariants, and audit records enforce Finance safety.
The shared result helper supplies `structuredContent`; hosts must inspect
per-item results and disclose partial effects between decisions.

The fixed `personal-os://agenda/today` resource merges open reminders due through the current local day with that day's selected-calendar events.

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
