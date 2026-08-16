# Feature ownership and parallel development

## Purpose

ilo has several composition roots that must remain stable while
independent product domains evolve. This document is the source of truth for
parallel worktree ownership. It complements the system boundary in
[`ADR 0001`](../architecture/0001-system-shape.md).

## Worktree rules

1. Every feature task starts from the latest `main` in its own worktree and
   branch. Feature tasks never push directly to `main`.
2. A feature task owns its paths below. A change outside those paths needs an
   Integration owner review before it is made.
3. Every branch rebases on current `main` immediately before opening its PR.
   Resolve migration ordering during that rebase. Follow the
   [database migration policy](database-migrations.md): once a migration is
   published to a shared branch or applied outside a private worktree, it is
   append-only.
4. A feature is complete only with its domain contract, API behavior, typed
   client surface, UI state handling, audit behavior for mutations, and tests.
   `pnpm verify` is required before handoff.
5. Provider material is a projection, not a local replacement. Provider
   failures, stale data, missing capability, and reconnect state must remain
   visible to the user and caller.

## Path ownership

| Owner | Primary paths | Explicitly does not own |
| --- | --- | --- |
| Finances | `apps/web/src/features/finances`, `apps/api/src/routes/finances.ts`, `apps/api/src/finance-*`, `packages/domain/src/finance.ts`, `packages/api-client/src/features/finances.ts`, `apps/mcp/src/tools/finances.ts`, `packages/connectors/src/plaid*` | Sessions, generic OAuth, Today composition, global navigation |
| Mail | `apps/web/src/features/mail`, `apps/api/src/routes/mail.ts`, `apps/api/src/mail-*`, `packages/domain/src/mail.ts`, `packages/connectors/src/google/mail.ts`, `packages/connectors/src/icloud-mail*` | Google OAuth core, Calendar provider adapter, Today composition |
| Tasks | `apps/web/src/features/tasks`, `apps/api/src/routes/tasks.ts`, `apps/api/src/routes/task-lists.ts`, `apps/api/src/routes/task-projects.ts`, `apps/api/src/task-service.ts`, `apps/api/src/task-list-service.ts`, `apps/api/src/task-project-service.ts`, `packages/domain/src/task.ts`, `packages/domain/src/task-organization.ts`, `packages/api-client/src/features/tasks.ts`, `apps/mcp/src/tools/planning.ts` | Reminder lifecycle, Today composition, global navigation, generic Add menu, physical database extraction |
| Reminders | `apps/web/src/features/reminders`, `apps/api/src/routes/reminders.ts`, `apps/api/src/reminder-service.ts`, `packages/domain/src/reminder.ts`, `packages/api-client/src/features/reminders.ts`, `apps/mcp/src/tools/reminders.ts` | Task/List/Project lifecycle, Prompt migration, Today composition, global navigation |
| Tracking (planned) | `apps/web/src/features/tracking`, future Tracking route/service modules, `packages/domain` Tracking contracts, typed client and MCP Tracking adapters | Tasks, Reminders, Today composition, global navigation, provider health bridges |
| Settings/Auth | `apps/web/src/features/settings`, `apps/api/src/routes/auth.ts`, `apps/api/src/auth-*`, `apps/api/src/security.ts`, account and token contracts | Feature-specific mail/calendar/finance workflows |
| Calendar | `apps/web/src/features/calendar`, `apps/api/src/routes/calendar.ts`, `apps/api/src/calendar-*`, `packages/domain/src/calendar.ts`, `packages/connectors/src/google/calendar.ts`, `packages/connectors/src/icloud-calendar*` | Google OAuth core, Today composition, mail provider adapter |
| Integration | app/API/MCP composition roots, global navigation, Today, Reviews composition, shared shadcn primitives, shared style tokens, migration journal | Feature-specific implementation details owned above |

The following are Integration-owned until they are reduced to thin registries:

- The typed workspace/navigation-owner manifest is the source of truth for the
  five workspace defaults and route-to-sidebar ownership. Feature routes must
  register an owner or explicitly use the account-utility owner; they must not
  infer sidebar composition from a leaf route.

- `apps/web/src/app.tsx`
- `apps/api/src/app.ts`
- `apps/mcp/src/server.ts`
- `packages/api-client/src/client.ts`
- `packages/connectors/src/google.ts`
- `packages/database/src/schema.ts` and `packages/database/migrations/meta/_journal.json`

Feature owners may add new feature modules freely. The Integration owner wires
those modules into the composition roots, which keeps parallel feature branches
from repeatedly conflicting on the same file.

### Tasks domain boundary

Tasks owns four distinct concepts:

- a **View** is a query (`today`, `upcoming`, `scheduled`, `completed`, `cancelled`, or `trash`) and
  owns no material;
- a **List** is a persistent organizational context, including the one protected system Inbox;
- a **Project** is a finite outcome inside exactly one List;
- a **Task** is one independently completable action in exactly one List and optionally one
  same-List Project.

The web uses the canonical URL model `view | list + optional project`: a View excludes container
selection, a Project implies its List, and Inbox is `/tasks` without a generated identifier. Task
lifecycle (`open`, `completed`, `cancelled`), timing (`dueAt`, `scheduledAt`), container
availability, and deletion are independent axes.

`packages/database` currently stores Task rows in `reminders` beside Reminder rows, with Task-only
columns protected by checks and foreign keys. That is a transitional physical boundary, not shared
domain ownership. Task services must query `kind = 'task'`; Reminder services retain their own
contract. Physical extraction is Integration/database-migration work and cannot begin until the
compatibility observation gate in the Tasks and Tracking design is satisfied.

Lists, Projects, and Tasks are local-only in v1. Their public `MaterialSourceReference` is derived
from stable entity ID and revision (`provider: local`, no account), not accepted from callers or
stored as a second provenance record. A future provider-backed container requires a new reviewed
storage and source contract.

The completed [Tasks Ilo charter](../product/tasks-ilo-charter.md) maps this shipped foundation and
its explicit follow-ups to the workspace-stewardship doctrine. It does not turn the unimplemented
maintenance, question, learning, status, or review layers into Integration-owned behavior.

## Workspace Ilo ownership

A workspace owner owns the semantics of its Ilo: living ledger, researched expert playbook,
definition of maintained, rulebook, surgical operations, maintenance-step graph, questions and
proposals, learning behavior, health/advisory model, review artifact, and domain status. These
contracts stay in the domain's normal paths and are described in a completed
[`workspace Ilo charter`](../product/workspace-ilo-charter-template.md).

Integration may own generic durable maintenance infrastructure such as run/step identifiers,
leases, fencing, idempotency, retry history, terminal settlement, and shared result envelopes. It
does not own domain judgment. A shared service must not decide what counts as a Finance transfer, a
Mail response obligation, a Calendar conflict, a healthy budget, or a useful recommendation.

Parallel workspace branches should deliver independently testable vertical slices and list shared
schema, migration-journal, registry, and composition-root changes as explicit Integration handoffs.
Do not move orchestration into an MCP host or coding-agent skill to avoid those seams. The governing
product and architecture contracts are
[`Ilo workspace stewardship`](../product/ilo-workspace-stewardship.md) and
[`ADR 0004`](../architecture/0004-workspace-ilo-stewardship.md).

## Required seams

### Domain and API

- Domain schemas are the canonical contract. Do not create page-only record
  shapes for provider material.
- Public HTTP behavior is owned by `apps/api`; MCP calls the API and contains
  no business rules.
- A feature-specific route module receives services and common middleware from
  the composition root. It does not construct cross-domain services itself.
- Typed API-client feature modules expose the same contract to web, MCP, and
  tests.

### Connectors

- Google OAuth/token lifecycle is shared infrastructure. Calendar and Mail
  adapters consume it through capability-specific interfaces.
- A connector reports selected accounts/sources, granted capabilities, freshness,
  retry/reconnect state, and provider error. UI never calls a provider directly.
- Read/write capability is checked before a UI, MCP, or agent operation is
  offered or executed.

### External dependencies

- A feature owner owns the capability, domain state, degraded behavior, and repair path for an
  external dependency it introduces.
- Integration owns shared edge deadlines, composition-root wiring, runtime configuration, network
  policy, deployment ordering, and cross-feature infrastructure. A change that adds a credential,
  callback, webhook, host class, protocol, port, queue, or native bridge crosses both ownership
  surfaces.
- The feature and Integration owners use the boundary record in
  [`external-boundary-reliability.md`](external-boundary-reliability.md) to agree on the durable
  commit point and production evidence. Neither side may infer that the other supplied the missing
  runtime contract.

### Agent actions and source links

Every agent mutation declares one policy level:

| Policy | Meaning |
| --- | --- |
| `read_only` | No mutation is allowed. |
| `preview` | Return a proposed action and exact candidate set only. |
| `approve_each` | A user must approve the individual action. |
| `approved_rule` | A user-created, enabled rule permits a bounded mutation. |

Every projection, proposal, or cross-domain link carries a
`MaterialSourceReference`: provider, account, remote ID, revision, and source
type. Mutations must emit an audit record with actor, policy, source reference,
and redacted before/after state.

## Integration queue

Feature work must not directly add cross-domain behavior to Today, the global
Add menu, or a generic routine catalog. Each feature instead supplies a typed
candidate/proposal surface. The Integration owner composes these after the
vertical features are independently verified.

This preserves a single source of truth for data, a single policy decision point
for agent actions, and predictable review/merge order.
