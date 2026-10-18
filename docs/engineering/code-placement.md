# nohmi code placement and structure

This is the placement rubric for CS-01–04 and CS-17. Apply it to new/materially changed behavior;
use the [acceptance contract](acceptance-contract.md) for migration exceptions. The detailed
[path ownership map](feature-ownership.md) resolves feature and Integration ownership.

| Responsibility | Owning location | Keep out |
| --- | --- | --- |
| Shared domain schema, invariant, source identity | `packages/domain/src/<domain>.ts` or its domain module | HTTP request objects, React state, provider SDKs, database handles |
| Authenticated use case and domain policy orchestration | `apps/api/src/<domain>-service.ts` or domain-owned service directory | UI formatting, direct provider protocol code, alternate MCP policy |
| HTTP validation/serialization and routing | `apps/api/src/routes/<domain>.ts` | SQL, long workflows, duplicated domain decisions |
| Persistence, queries, constraints, migrations | `packages/database/src`, `packages/database/migrations` | UI state or provider side effects; cross-domain policy disguised as a query helper |
| Provider transport, pagination and normalized adapter behavior | `packages/connectors/src/<provider>` or existing provider module | Tenant authorization or workspace judgment delegated to the provider |
| Typed HTTP adapter | `packages/api-client/src/features/<domain>.ts` | Independent business rules or duplicated domain schemas |
| Feature UI, view models, query hooks and interaction | `apps/web/src/features/<domain>` | Direct provider/SQL access or server authority inferred from local state |
| Reusable presentational primitive | `apps/web/src/components/ui`, `packages/ui` when its existing public contract owns the primitive | Workspace-specific policy, network calls or a kitchen-sink component with domain switches |
| Stateless tool adapter | `apps/mcp/src/tools/<domain>.ts` | Durable orchestration or copies of API authorization/business logic |
| Platform capability | `apps/desktop` behind its established bridge | A second domain implementation |
| Dependency wiring and registration | Existing app/API/MCP composition roots | Business decisions, feature-specific SQL or new cross-domain controllers |
| Development verification and delivery tooling | Existing `.codex`, `.github`, `scripts`, or owning skill scripts | Runtime product expertise, a parallel task tracker or duplicate acceptance logic |

Use the existing module shape when it satisfies the contract. A flat service file does not need to
become a folder for ceremony; split when responsibilities, ownership or independent change paths
require it. Reference locations are a routing guide, not a claim that every existing file conforms.
Tests belong beside the owning implementation where established; cross-boundary integration and
E2E cases stay in `integration` and `e2e` respectively.

## Where shared utilities belong

First search the domain owner and current shared helpers. Reuse an existing operation when its
semantics, error behavior, authorization and lifecycle match. If several callers encode the same
rule, place that rule under its actual owner and update its consumers together. Similar syntax is
not proof of shared semantics: Mail and Calendar can legitimately have different freshness rules.

Keep a helper local until it represents a real shared responsibility. Presentation-only mechanics
can use the existing web shared owner (for example `apps/web/src/lib/utils.ts`); pure cross-surface
domain logic belongs in the domain package; transport mechanics belong beside their adapter.
Do not create a global `utils`/`common` dumping ground or import application internals into a shared
package. Shared utilities need named inputs/results, documented invariants when non-obvious, and
focused tests. Avoid introducing a new package when an existing owner can hold the abstraction.

## SOLID as review questions

| Principle | nohmi decision rule |
| --- | --- |
| Single responsibility | Separate changes driven by different domain owners or lifecycle responsibilities. A module may contain several functions serving one responsibility. |
| Open/closed | Extend through established typed provider/feature registries when a real variation exists. Do not modify unrelated domain policy or invent a plugin framework for one case. |
| Substitutability | Adapters sharing a contract preserve its authorization, error, retry, provenance and result semantics. A fake should not silently supply stronger guarantees than the real provider. |
| Interface segregation | Inject the operations a consumer actually needs; avoid requiring an entire service/container merely to read one capability. |
| Dependency inversion | Domain use cases depend on explicit capabilities, composed at the boundary. Do not couple pure rules to SDK/HTTP/global runtime details. Plain TypeScript functions and structural types are valid abstractions. |

Reviewers must identify the actual responsibility, consumer, invariant and consequence. Acronyms,
class counts, inheritance, universal factories and zero textual duplication are not acceptance
criteria. When consolidating code, verify each consumer rather than assuming a shared helper fixes
all callers. Keep policy checks on the authoritative path after extraction.

## Required structure review

For a material change, answer in the existing review record:

1. Which domain owns the decision, and which modules merely adapt it?
2. Is there an existing operation or invariant being duplicated? Why reuse or keep separate?
3. Which consumers and failure paths depend on this contract?
4. Are inputs, outputs, side effects, transaction/recovery boundaries and authority explicit?
5. What focused test would fail if the shared behavior or boundary were broken?

A negative answer tied to a required standard blocks acceptance. A preferred layout without a
concrete violated contract remains advisory. Research rationale is in [standards research](standards-research.md).
