# ADR 0001: System shape

- Status: Accepted
- Date: 2026-07-13

## Context

The product must serve interactive clients, externally scheduled maintenance intents, and arbitrary
MCP hosts without duplicating workspace expertise, User Knowledge, or action rules in each surface.
Mail, task, calendar, and financial providers remain independent systems with incompatible
semantics.

## Decision

Use a TypeScript monorepo with the following boundaries:

- `apps/api`: authenticated HTTP API, OpenAPI document, connector callbacks, and
  webhook ingress.
- `apps/mcp`: stateless MCP adapter that calls the public API with a scoped token.
- `apps/web`: React PWA used in browsers and as the desktop renderer.
- `apps/desktop`: Tauri shell and platform capabilities.
- `packages/domain`: schemas, invariants, and service contracts.
- `packages/database`: PostgreSQL schema, migrations, and repositories.
- `packages/connectors`: provider-neutral contract and Google implementation.
- `packages/api-client`: typed client shared by web, MCP, and tests.
- `apps/web/src/components/ui`: local shadcn primitives and product compositions.

The API is the product boundary. MCP contains no business rules. Interactive
clients never call provider APIs directly.

The system is multi-user even when an early environment contains only one account. Every API
operation, provider projection, domain record, background claim, cache key, embedding, search
result, notification, review, audit event, and deep link is bound to the authenticated owner through
a structural tenant key and ownership checks. A phone number, provider identifier, display name,
semantic match, or agent inference is never accepted as a tenant boundary. Shared or delegated
access requires a future explicit relationship, consent, and authorization model rather than an
exception to isolation.

Mail, Tasks, Calendar, and Finances own their native ledgers and maintenance semantics. The shared
User Knowledge domain owns the typed personal-context and context-assembly contract; `apps/api`
performs authorized, purpose-bound assembly. User Knowledge does not own workspace records or grant
action authority. See [`ADR 0005`](0005-user-knowledge.md).

External platforms may own cadence and invoke a small maintenance intent. nohmi owns durable run
state, playbook and policy versions, context retrieval, idempotency, questions, recovery, and the
verified terminal result; scheduled prompts are never the workflow source of truth.

PostgreSQL is used in production and local Docker environments. Tests use an
embedded PostgreSQL-compatible runtime where possible and integration tests run
against the same migrations.

## Authentication and authorization

- Browser sessions are opaque, random tokens. Only token hashes are stored.
- MCP uses revocable personal access tokens. Only token hashes are stored.
- Tokens carry explicit read/write scopes for each workspace and User Knowledge purpose. Audit
  access is read-only through `audit:read`; authorized mutations write their audit records
  internally rather than through a public audit-write operation.
- OAuth credentials are encrypted at rest with an application key distinct from
  the database.
- Connector callbacks bind OAuth state to a user, expire quickly, and are
  one-time-use.

## External system boundaries

Every external dependency is treated as independently fallible across
configuration, authority, transport, timing, capacity, delivery semantics, and
availability. A configured runtime value does not establish that its credential
is valid, its requested capability is authorized, or its network path is
reachable.

The owning service defines the caller deadline, downstream timeout, durable
commit point, idempotency or reconciliation rule, degraded state, retry and
repair behavior, and observable evidence. Work that can outlive an interactive
request crosses a durable handoff before the response; eventual completion
cannot depend only on an in-memory promise. Application code, deployment
configuration, and infrastructure policy form one boundary contract.

The required reasoning method and evidence levels live in
[`docs/engineering/external-boundary-reliability.md`](../engineering/external-boundary-reliability.md).

## Connector lifecycle

Connection is a durable handoff, not a full synchronization transaction. An
OAuth callback may exchange its one-time code, resolve the minimum provider
identity needed for an account key, encrypt credentials, persist the account,
and redirect. An app-password endpoint may validate its input and persist a
pending account. Source discovery, pagination, projection, and initial sync run
after that durable handoff and report progress or a redacted error on the
account.

All provider calls use bounded timeouts below the public edge timeout. Provider
transports must also be declared in production infrastructure; connector code
and security-group egress are one contract. The detailed invariant and review
checklist live in
[`docs/engineering/connector-reliability.md`](../engineering/connector-reliability.md).

## Calendar projection

Every calendar event includes:

- internal ID and owning user ID;
- account and calendar IDs;
- provider kind, remote calendar ID, and remote event ID;
- provider revision/etag and raw payload;
- normalized title, notes, location, start/end, time zone, all-day state,
  recurrence data, status, and visibility;
- synchronization and deletion timestamps.

Local events use the same normalized shape with `provider = local` and no remote
write. Provider mutations use optimistic concurrency where supported.

## Transparency

Every mutation emits an append-only audit record containing the actor type and
ID, request correlation ID, operation, entity identity, and redacted before/after
snapshots. Sensitive credentials and OAuth payloads are never audited.

## Consequences

- Adding Microsoft Graph or CalDAV requires a connector implementation rather
  than changes to UI or MCP tools.
- The desktop and browser clients can share most UI code.
- Native widgets remain platform adapters because Apple and Windows do not share
  a widget runtime.
- Running a separate MCP process remains safe because authorization and domain
  validation stay in the API.
