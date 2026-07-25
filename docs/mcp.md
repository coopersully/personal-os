# MCP integration

The MCP server is an adapter over the authenticated ilo API. It contains no reminder, calendar, provider, or audit rules of its own.

## Transports

- `apps/mcp/dist/stdio.js` for local MCP hosts. Configure `PERSONAL_OS_API_URL`, `PERSONAL_OS_TOKEN`, and optionally `PERSONAL_OS_TIMEZONE`.
- `apps/mcp/dist/http.js` for Streamable HTTP. Send `Authorization: Bearer pos_…`; optionally send `X-Personal-OS-Timezone`.

The HTTP server is stateless: it creates an isolated MCP server and transport for each request and forwards only the caller's agent token to the API.

## Tools

The server exposes read/create/update/complete/delete reminder tools; read/create/update/delete event tools; calendar discovery; read-only mailbox, mail search, and conversation tools; actor-aware activity history; and Finance tools. Destructive and read-only annotations are included for compatible MCP hosts.

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

Create a token in the product settings. Grant only the scopes the host needs:

- `reminders:read`, `reminders:write`
- `calendar:read`, `calendar:write`
- `mail:read`
- `audit:read`
- `finances:read`, `finances:write`

Only a token hash is stored. Revoke a host without ending human sessions or affecting another host. Connector and account administration remain human-only.
