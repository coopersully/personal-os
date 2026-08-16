---
name: personal-os-mcp
description: Build and review secure Personal OS MCP tools and transports. Use when changing `apps/mcp`, adding a tool or resource, modifying agent-token scopes, or evaluating agent-initiated mutations.
---

# Personal OS MCP

Read `docs/mcp.md` and the agent-action section of
`docs/engineering/feature-ownership.md` before altering MCP behavior.
For a workspace status or maintenance surface, also read
`docs/product/ilo-workspace-stewardship.md` and
`docs/architecture/0004-workspace-ilo-stewardship.md`.

## Preserve the adapter boundary

- Call the authenticated public API through `@personal-os/api-client`.
- Keep MCP stateless and free of reminder, calendar, provider, and audit rules.
- Do not call connectors, the database, or provider APIs from MCP.
- Keep HTTP requests isolated and forward only the caller's scoped agent token.
- Keep stdio credentials in environment variables; never expose tokens in tool
  arguments, logs, or tool results.

## Expose workspace intent without moving intelligence

- For a mature workspace, prefer `get_<workspace>_status` and `maintain_<workspace>` as the small
  high-level intent surface, plus granular tools for useful surgical operations.
- Treat maintenance as one domain-owned, durable stewardship turn—not a batch endpoint or a
  client-authored sequence of tool calls.
- Return readiness, freshness, backlog, questions, run state, review, advice, and recovery links
  from API-owned contracts. Do not calculate maintained state in MCP.
- Never embed the expert playbook, rulebook, retry order, learning behavior, or completion criteria
  in tool descriptions, prompts, or host-specific instructions.
- Do not claim the conventional intent tools exist unless current discovery and tests prove they
  are shipped for that workspace.

## Add a tool safely

1. Add or verify the API contract and its authorization scope first.
2. Implement a focused module in `apps/mcp/src/tools` and register it from the
   server composition root.
3. Add the tool to `apps/mcp/src/tool-catalog.ts` with its domain, workflow
   stage, policy, read/write posture, least-privilege scopes, and whether it is
   a visual entrypoint. A tool without a catalog record must fail at startup.
4. Describe inputs precisely and preserve API authorization errors rather than inventing separate permission
   rules in MCP.
5. Add typed-client tests that prove full catalog coverage, output metadata,
   the least-privilege scope view, and the read-only view. A token must not
   discover a capability it cannot use.

## Design progressive disclosure

- Start hosts with `get_ilo_context`; keep identity, time, readiness, scopes,
  available tools, and first-party links in that one orientation result.
- Model a workflow as `context → inspect → prepare → commit → verify/recover`.
  Prefer preview tools to boolean `dryRun` flags for consequential changes.
- Keep tools focused and composable. Do not create a generic multi-domain
  action tool to reduce the tool count.
- Use `ilo://` templates for reusable context and `ui://` only for compact MCP
  Apps. Every visual entrypoint must retain useful text and structured output.
- Advertise prompts only when their prerequisite read scopes are present.
- Do not expose MCP Tasks until the API owns a durable handle, progress,
  idempotency/reconciliation rule, and terminal recovery contract.

## Keep one result and annotation contract

The tool surface supplies all four standard annotations and the shared output
schema. Feature callbacks return `result`, `ok`, or a structured API `error`;
the surface adds `_ilo` domain, stage, policy, read-only state, and work-surface
links. Do not add a domain-local envelope, omit text fallback, or treat
annotations/UI metadata as authorization.

Use the original feature annotation when it is more precise. Optimistic-lock
mutations and uncertain provider effects are usually not idempotent, even when
their input resembles a PUT or update. A reversible trash action can still be
destructive for host UX. External side effects are open-world; cached reads and
local drafts are closed-world.

## Treat mutations as policy decisions

Every mutation is `read_only`, `preview`, `approve_each`, or `approved_rule`.
Use the API's policy decision and audit behavior; never infer an approval,
permanent financial categorization rule, or provider capability locally. Keep
source references and actor/policy audit data intact.
