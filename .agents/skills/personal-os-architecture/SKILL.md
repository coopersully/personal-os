---
name: personal-os-architecture
description: Keep Personal OS changes within the established monorepo boundaries and domain ownership model. Use when adding or refactoring a product domain, deciding package placement, changing app/API/MCP composition roots, or planning cross-domain behavior.
---

# Personal OS architecture

Treat `docs/architecture/0001-system-shape.md` as the system boundary and
`docs/engineering/feature-ownership.md` as the path-ownership authority.

## Place work by responsibility

- Put schemas, invariants, and cross-surface contracts in `packages/domain`.
- Put PostgreSQL schema, migrations, and data access in `packages/database`.
- Put provider-specific work behind `packages/connectors`; never call providers
  from web, MCP, or feature services.
- Put authenticated product behavior in `apps/api`.
- Put typed HTTP calls in `packages/api-client`; web, MCP, and tests consume it.
- Put page composition, query hooks, local view state, and feature-only
  components in `apps/web/src/features/<domain>`.
- Keep `apps/mcp` as a stateless adapter over the public API. Do not duplicate
  business rules there.
- Keep `apps/*/src/app.*`, `apps/mcp/src/server.ts`, and shared registries thin;
  they are Integration-owned composition roots.

## Deliver a vertical feature

1. Define or extend the domain contract before creating page-only shapes.
2. Implement service behavior and a feature route that receives dependencies
   from the API composition root.
3. Expose the same behavior through the typed API client.
4. Add web and MCP surfaces only where the product requires them.
5. For mutations, preserve source references, apply the declared policy level,
   and emit an append-only audit record with redacted before/after state.
6. Cover the public behavior and run `pnpm verify` before handoff.

## Respect ownership seams

Feature modules may be added without editing a composition root. Do not add
cross-domain behavior to Today, global navigation, the generic Add menu, shared
style tokens, or the migration journal without Integration-owner coordination.
Provider projections must disclose freshness, capability, retry/reconnect, and
provider-error state; they are not a replacement source of truth.
