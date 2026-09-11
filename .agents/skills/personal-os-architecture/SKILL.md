---
name: personal-os-architecture
description: Keep nohmi changes within the established personal-os monorepo boundaries and domain ownership model. Use when adding or refactoring a product domain, deciding package placement, changing app/API/MCP composition roots, or planning cross-domain behavior.
---

# personal-os architecture

Treat `docs/architecture/0001-system-shape.md` as the system boundary and
`docs/engineering/feature-ownership.md` as the path-ownership authority.
For workspace stewardship, also read `docs/product/workspace-stewardship.md` and
`docs/architecture/0004-workspace-stewardship.md`.

## Place work by responsibility

- Design every surface as multi-user even when a fixture or early deployment contains one account.
  Bind domain rows, provider projections, background claims, caches, embeddings, searches,
  notifications, reviews, deep links, and audit reads to the authenticated owner through structural
  tenant keys and authorization checks. Never use a display name, phone number, provider ID,
  semantic match, or model inference as the tenant boundary; sharing and delegation require an
  explicit consented relationship model.
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

## Model a workspace steward

- Keep the domain's ledger, expert playbook, guided setup, rulebook, surgical operations,
  maintenance turn, typed work nodes, learning loop, advice, review artifact, and status
  semantically domain-owned.
- Share only mechanical execution infrastructure such as run/step persistence, leases, fencing,
  retry history, and terminal settlement.
- Put runtime expertise and User Knowledge in versioned domain/API data and contracts, never in an
  MCP host prompt or repository coding-agent skill. Use purpose-bound context packs; knowledge does
  not grant action authority.
- Complete `docs/product/workspace-charter-template.md` before splitting a new workspace across
  parallel branches. List composition-root and shared migration work as Integration handoffs.
- Keep Texting a shared channel and coordinator rather than a fifth workspace. Texting owns
  conversation, delivery, routing, and response composition; routed work retains workspace-owned
  expertise, policy, work nodes, and terminal truth.
- Treat SMS links as ordinary authenticated nohmi destinations, never bearer or approval links.
  Preserve the requested review destination across normal sign-in without putting sensitive item data
  in the URL.

## Model User Knowledge

- Read `docs/product/user-knowledge.md` and `docs/architecture/0005-user-knowledge.md` before
  changing profiles, goals, motives, memory, cross-workspace context, or semantic retrieval.
- Keep native workspace records in their owning domains and connect them through typed relations.
- Keep semantic indexes rebuildable; PostgreSQL records, revisions, provenance, scope, and policy
  remain authoritative.
- Let reinforced low-risk knowledge activate only through its documented promotion lifecycle. Never
  convert confidence, an inference, or external content into scopes or mutation authority.

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
