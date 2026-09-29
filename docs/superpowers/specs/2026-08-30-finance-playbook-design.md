# Ilo Finance playbook

- Status: Approved and implemented
- Version: `1.0.0`
- Dependency: PR #157 (`cooper/finance-account-semantics`)

## Decision

Finance uses one server-owned, source-controlled playbook with an explicit
version, approval status, priority hierarchy, source lineage, and research
policy. It is a default decision policy: it starts with cash-flow stability,
emergency reserves, tax obligations, insurance and risk gaps, costly debt,
retirement advantages, diversified long-term investing, and a sustainable good
life. User goals and constraints refine the order only when they are explicit
and evidenced.

The playbook is deliberately separate from account semantics and user profile
data. PR #157 remains authoritative for account kind, ownership, and inclusion;
the playbook consumes those facts through existing wealth/profile services.

## Contract and data flow

`packages/domain/src/finance/playbook.ts` owns the canonical contract and a
pure assessment function. `apps/api/src/finance-playbook-service.ts` composes
the current effective profile and wealth summary with the registry. The API
route exposes the same result to the typed client, MCP, and web. Setup and
maintenance carry the playbook version in their existing result/payload seams,
so an agent can explain which policy governed the interaction.

The registry is auditable through its version, owner, approval status, source
identity, URL, retrieval date, scope, and stability classification. The API
does not claim that a live search occurred. Compatible agents must use native
web search when a recommendation depends on current tax, retirement,
insurance, accounting, deadline, rate, or product facts, and must record the
source identity/date/scope when they do.

## Uncertainty and safety

Missing profile, income, reserves, jurisdiction, debt rates, or active risk
coverage produce blockers or uncertainty rather than invented allocations.
The playbook recommends actions, not trades or regulated conclusions. Numeric
limits remain time-sensitive facts and are not embedded as timeless policy.

## Verification

Unit tests cover hierarchy/version/source validation, missing-profile behavior,
unknown debt-rate uncertainty, and high-cost debt prioritization. API/client,
MCP, setup, maintenance, and UI seams retain their existing contract tests.
