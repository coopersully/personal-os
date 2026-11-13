# Ilo Finance playbook

- Status: Approved and implemented
- Version: `1.1.0` (rubric, ledger rules, alert tiers and dated limits added November 13, 2026)
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

## Version 1.1.0 (COO-243)

Version 1.1.0 keeps the eight ordered steps and adds four server-owned sections:

- `rubric`: eight stewardship checks with their measure, bands and sources. Six are assessable
  from recorded facts. Retirement saving rate and employer match are published as not assessable
  because nohmi does not yet record contributions or a match.
- `ledgerRules`: how transfers, card payments, refunds, reimbursements, roundups, savings
  contributions, pending rows, person-to-person payments, provider categories and protected
  preferences are treated.
- `alertTiers`: what interrupts the person, what waits for a digest and what stays silent.
  "Unusual" is judged against the person's own history, not a fixed amount.
- `referenceLimits`: dated contribution and coverage limits, each tied to a primary source.
  They are time-sensitive; the web-research policy still requires a recheck before use.

The assessment adds `rubric`: one result per check with `healthy`, `watch`, `gap` or
`not_assessed`, and a detail line stating the arithmetic or the missing fact. A missing fact
never produces a guessed score. The service reads the month's plan context and stated income as
optional evidence; if either read fails, its checks are `not_assessed` and the profile-based
readiness is unchanged. The wealth summary is still not required.

Results are observations, not advice. Bands for housing share are lending convention, not a
regulator rule, and the sources say so.
