# Agent Access action queue design

## Status

Approved direction: action-first. The detailed interaction is a trial hypothesis
until it passes live desktop/mobile QA and one end-user review.

- Owner: account utility and assistant integration.
- Affected surface: **Settings → Agent access**.
- Affected states: disconnected, connected, partially configured, review
  pending, attention pending, caught up, partially unavailable, and fully
  unavailable.
- Immediate user job: understand what needs personal action across
  agent-enabled workspaces, complete the highest-priority action, and manage
  access or setup only when needed.

## Problem

The current page gives product selection, readiness, review material,
connection setup, guided setup, connected hosts, and local tokens comparable
visual weight. A person must inspect each workspace to discover outstanding
work, while attention is reduced to a count and review lists have no shared
pagination model. This makes setup dominate routine supervision and leaves no
cohesive answer to “what needs me now?”

The design must preserve domain ownership, honest readiness evidence, and
least-privilege access management while creating one predictable scan and
pagination model for person-owned work.

## Chosen approach

Use one action-first inbox across published workspaces, followed by compact
workspace status and contextual setup. Do not use a workspace dashboard grid
as the primary surface and do not keep workspace tabs as the only way to find
outstanding work.

This is preferred because it optimizes for completing work instead of
inspecting status. Workspace identity remains visible on every action and in a
separate overview, but it does not partition the person's queue.

## Information architecture

```text
Agent access
├── connection summary and Manage access action
├── Your action queue
│   ├── All / Review / Attention / Setup filters
│   ├── one ordered, paginated list across published workspaces
│   └── one queue-level loading, empty, partial-error, or error state
├── Agent workspaces
│   ├── Mail
│   ├── Finances
│   ├── Calendar
│   └── Tasks
│       └── selected workspace detail
│           ├── readiness overview and evidence dialog
│           ├── contextual setup plan
│           └── domain-specific access statement
└── Access management
    ├── connected OAuth hosts
    ├── active local tokens
    └── collapsed revoked-token history
```

The page title becomes **Agent access**. Its supporting copy explains the
supervision job in one sentence. A compact header summary reports the number
of observed hosts and exposes **Manage access**; it does not compete with the
queue as a second primary card.

### Primary block: Your action queue

The queue is the page's one raised primary block. It contains only work with a
specific user or setup outcome:

- **Review**: guidance drafts, disabled agent-drafted Mail rules, Finance
  review cases, and other consequential approvals owned by the signed-in
  person.
- **Attention**: open domain attention items, reconnect requirements, and
  other actionable source or workflow conditions.
- **Setup**: missing host connection, missing required agent authority, or an
  unresolved workspace setup step.

Readiness diagnostics do not become queue items unless they expose a concrete
action. Healthy checks, counts, capabilities, and evidence remain in workspace
detail.

Each row contains:

1. the framed workspace identity, or the Key functional icon and **Agent
   access** label when `domain` is `null`;
2. a persistent type label: **Review**, **Attention**, or **Setup**;
3. a concise title and one-line outcome or source context;
4. optional freshness or due metadata;
5. one explicit action.

The row itself is not a catch-all click target when it contains an independent
action. Review actions open the owning review experience; navigation actions
route to the owning workspace or settings surface. The global queue is a read
model and never duplicates domain mutations.

### Queue order

The server returns a deterministic order:

1. signed-in review or approval that only the person can complete;
2. blockers preventing an agent from continuing;
3. open attention ordered by importance and due or occurrence time;
4. remaining setup work.

Within a priority bucket, items sort by effective action time, then update
time, then stable item identity. The interface does not imply that workspace
color or source order is priority.

### Filters

Use a compact single-select filter with **All**, **Review**, **Attention**, and
**Setup**. Filters do not display zero-count badges before the queue summary
loads. Changing a filter resets pagination and moves focus to the queue
heading, not the first action.

### Pagination

The queue uses server-owned cursor pagination with ten rows per page at every
breakpoint. The footer shows the visible range and total when the server can
provide an exact count, plus labelled **Previous** and **Next** controls.

The opaque cursor carries a snapshot boundary and the complete ordering tuple.
This prevents newly created or reprioritized work from producing duplicates or
skips during one paging session. Refreshing the queue starts a new snapshot.
The client keeps the previously returned cursor stack only for backward
navigation; it never manufactures cursors or uses an offset.

Counts such as `100+` are no longer used as pagination. Bounded counts remain
valid in readiness evidence only when explicitly labelled as bounded.

## Workspace overview and detail

Below the queue, **Agent workspaces** presents four equal compact choices for
the published domains. Each choice contains its workspace icon, label, setup
phase, and at most one action summary such as **2 need attention** or **1 ready
for review**. The selection control does not repeat full readiness progress.

Selecting a workspace reveals one detail region below the choices:

- the existing two-row `ReadinessPanel` overview;
- **View checks** for complete evidence in a dialog;
- the current server-owned setup step;
- the workspace's observed agent authority.

Connection instructions and the setup protocol become contextual disclosure
inside this detail. They are open only when they are the selected workspace's
current action. Protocol reference material remains collapsed.

Mail rule review moves out of the default vertical page flow. Its queue action
opens the existing bounded preview and activation experience. Active rules are
healthy workspace evidence, not queue items.

## Connection-state behavior

The layout remains action-first in every state:

- **No observed host:** **Connect an agent** is the first Setup item. Its action
  reveals the MCP URL and authorization handoff. Workspace blockers follow it.
- **Host connected, setup incomplete:** person-owned review comes first;
  agent-owned work is described in workspace detail and is not presented as a
  human task.
- **Host connected, caught up:** the queue uses the shared Empty composition
  with **You're caught up** and leaves workspace status visible below.
- **Multiple hosts:** the header reports the total. Permission differences are
  explained in workspace evidence; credential management remains in Access
  management.

The page never treats an unused generated token as a connected host.

## Data contract and ownership

Add an assistant integration read model rather than assembling the global
queue in React:

```ts
type AgentAccessWorkItem = {
  action: { label: string; to: string } | null;
  actionAt: string | null;
  domain: "mail" | "finances" | "calendar" | "tasks";
  id: string;
  kind: "review" | "attention" | "setup";
  priority: "person_review" | "blocked" | "critical" | "high" | "normal" | "low";
  source: MaterialSourceReference | null;
  summary: string;
  title: string;
  updatedAt: string;
};

type AgentAccessWorkItemPage = {
  items: AgentAccessWorkItem[];
  nextCursor: string | null;
  snapshotAt: string;
  total: number | null;
  unavailableDomains: Array<AgentAccessWorkItem["domain"]>;
};
```

`GET /v1/assistant/work-items` accepts `limit`, opaque `cursor`, and optional
`kind` and `domain` filters. Each domain supplies a typed candidate projection;
the assistant integration layer performs the stable cross-domain merge and
does not read feature tables through page-specific queries. This follows the
repository's Integration queue boundary: feature owners define their material
and policy, while Integration owns cross-domain composition. Domain services
remain authoritative for Mail rule preview/activation, Finance review
decisions, profiles, attention lifecycle, source reconnection, and scoped
agent authority.

Every queue route is an allowlisted in-app URL owned by its domain. Mail rule
review uses a shareable Agent access URL that opens the bounded review dialog;
it does not require an opaque client-only callback in the server contract.

Synthetic setup blockers must derive from server-observed state and carry a
stable semantic identity. The browser must not infer completion from copied
URLs, opened disclosures, or local UI state.

## Loading, empty, error, and stale states

- Loading uses the shared Skeleton composition and preserves the queue's
  expected row geometry.
- A successful empty result renders **You're caught up**; it never disappears
  into whitespace.
- Partial domain failure keeps available work visible, identifies which
  workspace could not be checked, and offers one queue-level retry. It never
  reports an authoritative zero.
- Full queue failure uses a destructive Alert beside the queue heading with a
  retry action. Workspace status and access management continue loading
  independently when their own sources remain available.
- After an action succeeds, invalidate the queue and affected readiness data.
  Keep focus on the updated row until the refresh settles, then announce the
  result through the established toast/status behavior.
- Stale provider evidence remains labelled in the owning row or workspace
  detail; it is never silently presented as current.

## Responsive and accessibility behavior

- The action queue stays one column. Content order and page size do not change
  between desktop and mobile.
- Workspace choices use four equal controls at normal widths and two columns
  at narrow widths.
- On narrow screens, row metadata wraps below the title and the action remains
  a full persistent button; horizontal scrolling is forbidden.
- The queue is a named list, filters form one labelled single-select control,
  and pagination buttons expose direction and disabled state.
- Workspace identity, item kind, urgency, and completion always have text;
  color and icons are supplemental.
- Dialogs and disclosures restore focus to their trigger. Queue refreshes use
  non-interrupting status announcements.
- Keyboard order follows visual order: filter, rows and row actions,
  pagination, workspace choices, selected detail, then access management.

## Components and code boundaries

- Keep `AgentAccessSettings` as page composition and query orchestration.
- Add a feature-owned `AgentAccessQueue` composition built from existing
  `Card`, `ToggleGroup`, `ItemGroup`, `Item`, `Badge`, `Button`, `Pagination`,
  `Skeleton`, `Empty`, and `Alert` primitives.
- Keep `ReadinessPanel`, `WorkspaceIcon`, `MailRuleReview`, setup protocol, and
  credential components as bounded units; relocate their composition instead
  of rewriting their behavior.
- Put cursor history and filter state in one feature hook. Do not move queue
  paging into the app shell or global navigation.
- Update `docs/design/pages/agent-access.md` with the new hierarchy and queue
  contract. Update `docs/design/system.md` only for the reusable rule that a
  cross-domain supervision surface prioritizes actionable work over diagnostic
  status.

## Verification

1. Unit-test normalization and ordering for review, blocker, critical
   attention, ordinary attention, and setup projections.
2. API integration-test authorization, domain isolation, filters, exact limit,
   forward cursors, snapshot stability, ties, newly inserted work, resolved
   work, partial domain failure, and no-result pages.
3. Testing Library-test queue loading, empty, partial-error, full-error,
   filtering, cursor navigation, focus restoration, and invalidation after a
   successful action.
4. Preserve focused tests for readiness evidence, setup-plan truth,
   Mail-rule activation, OAuth revoke, token creation, and revoked history.
5. Playwright-test the disconnected and connected happy paths on desktop and
   mobile, including ten-plus mixed items, filter reset, next/previous pages,
   a domain review action, a reconnect route, and the caught-up result.
6. Manually inspect keyboard navigation, focus return, 320 px layout, 200%
   zoom, long titles, realistic workspace counts, partial availability, and
   screen-reader announcements.
7. Run `pnpm verify` before handoff.

## Out of scope

- Creating a new global workspace or adding Agent access to the workspace
  switcher.
- Moving domain mutations into the assistant integration layer.
- Adding bulk approval, bulk dismissal, search, saved filters, or user-defined
  queue ordering.
- Replacing Today or domain-owned work queues with Agent access.
- Treating diagnostic readiness checks as user tasks without a concrete action.
