# MCP integration

The MCP server is an adapter over the authenticated ilo API. It contains no reminder, calendar,
mail, finance, provider, or audit rules of its own.

## Transports

- `apps/mcp/dist/stdio.js` for local MCP hosts. Configure `PERSONAL_OS_API_URL`, `PERSONAL_OS_TOKEN`, and optionally `PERSONAL_OS_TIMEZONE`.
- `apps/mcp/dist/http.js` for Streamable HTTP. Send `Authorization: Bearer pos_…`; optionally send `X-Personal-OS-Timezone`.

The HTTP server is stateless: it creates an isolated MCP server and transport for each request and forwards only the caller's agent token to the API.

## Tools

The server exposes focused Reminder list/get/create/update/complete/trash/restore tools and an exact,
read-only overdue-deferral preview; read/create/update/delete event tools; calendar discovery;
mailbox, mail search, conversation, and mail rule tools; actor-aware activity history; and Finance
tools. Every Reminder tool declares read-only, destructive, idempotent, and open-world hints for
compatible MCP hosts. These annotations are presentation hints only; API scopes, mutation policy,
structured errors, audit history, and recoverable deletion are authoritative.

The shared assistant tools give Claude, Codex, and other MCP hosts one consistent setup vocabulary:

- `get_agent_setup_status` discovers accessible domains and existing profile state.
- `get_domain_profile` and `save_domain_profile` read and maintain durable domain preferences,
  source meanings, categories, and instructions.
- `list_attention_items`, `create_attention_item`, and `update_attention_item` use the same shape
  for important items, upcoming commitments, follow-ups, and post-run summaries across domains.

Reminders use a typed profile vocabulary for capture defaults, priority meanings, deadline versus
notification intent, time zones, overdue review, thresholds, and preferred automatic actions.
Those stored preferences guide agents; they do not grant, revoke, or enforce API authority.
`dueAt` drives due/overdue views and is not proof of notification delivery. Direct single-Reminder
mutations remain audited API actions. Bulk overdue deferral begins with
`preview_overdue_reminder_deferral`, which returns the complete bounded candidate set, `preview`
policy, source references, and revisions without mutating. Guarded individual updates and
consequential state changes use `expectedUpdatedAt` so concurrent changes surface as conflicts.

Rules share a versioned envelope—name, description, profile, sources, confidence threshold, policy,
enabled state, and version—while each feature owns its condition and action language. Mail is the
first executable implementation: agents can list, preview, create, and update mail rules. New rules
are disabled and preview-only by default, and connector sync executes only enabled
`approved_rule` rules.

Finance tools are an adapter over the same Finance API used by the web app. They
include ledger health, transactions, categories, budgets, merchants, review
work, wealth, cash flow, recurring-payment review, and alerts. Agents should
read ledger health and the relevant transactions before offering a budget or
cash-flow recommendation. Categorization is intentionally proposal-first:
`propose_finance_categorizations` does not mutate anything, while
`apply_finance_categorizations` remains subject to the API's adaptive confidence
policy. Merchant merges and recurring-payment, alert, and review decisions are
bounded mutations; an agent must not infer a permanent merchant rule or mark an
uncertain transfer as non-spending without the user-visible review path.

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
