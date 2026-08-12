---
name: personal-os-mcp
description: Build and review secure Personal OS MCP tools and transports. Use when changing `apps/mcp`, adding a tool or resource, modifying agent-token scopes, or evaluating agent-initiated mutations.
---

# Personal OS MCP

Read `docs/mcp.md` and the agent-action section of
`docs/engineering/feature-ownership.md` before altering MCP behavior.

## Preserve the adapter boundary

- Call the authenticated public API through `@personal-os/api-client`.
- Keep MCP stateless and free of reminder, calendar, provider, and audit rules.
- Do not call connectors, the database, or provider APIs from MCP.
- Keep HTTP requests isolated and forward only the caller's scoped agent token.
- Keep stdio credentials in environment variables; never expose tokens in tool
  arguments, logs, or tool results.

## Add a tool safely

1. Add or verify the API contract and its authorization scope first.
2. Implement a focused module in `apps/mcp/src/tools` and register it from the
   server composition root.
3. Describe inputs, return structured and useful errors, and set read-only or
   destructive annotations accurately.
4. Preserve API authorization errors rather than inventing separate permission
   rules in MCP.
5. Add server/tool tests using the typed client boundary.

## Treat mutations as policy decisions

Every mutation is `read_only`, `preview`, `approve_each`, or `approved_rule`.
Use the API's policy decision and audit behavior; never infer an approval,
permanent financial categorization rule, or provider capability locally. Keep
source references and actor/policy audit data intact.
