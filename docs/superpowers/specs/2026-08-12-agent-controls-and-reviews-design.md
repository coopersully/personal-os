# Agent controls and Reviews design

## Status

Approved direction. The interaction details remain a trial hypothesis until
desktop and mobile QA plus one end-user review.

- Owners: Today integration, account utility, assistant integration, and each
  participating workspace.
- Affected surfaces: Today navigation, **Reviews**, Settings navigation,
  **Connected agents**, **Workspace access**, MCP routine tools, and the legacy
  routine scheduler.
- Immediate user jobs:
  - In **Reviews**, decide what needs personal judgment now.
  - In **Connected agents**, see and control who can access Ilo.
  - In **Workspace access**, understand exactly what connected agents may and
    may not do in each workspace.

## Problem

The current **Agent access** settings page combines an operational queue,
workspace setup, readiness diagnostics, connection instructions, OAuth hosts,
and local credentials in one long document. The **Automations** settings page
adds two nominal routines whose names imply distinct outcomes even though both
only record the same daily-brief snapshot. This obscures the difference between
work that needs a decision, identity and credential control, workspace
authority, and executable rules.

The redesign must preserve high visibility in Settings without duplicating
business logic or making Settings the place where ongoing work is completed.

## Chosen information architecture

```text
Today
└── Reviews
    ├── Review / Attention filter
    ├── All / Mail / Calendar / Tasks / Finances filter
    └── one cursor-paginated operational queue

Settings
└── Agents
    ├── Connected agents
    │   ├── connection instructions
    │   ├── observed OAuth hosts
    │   ├── local/manual credentials
    │   └── exact granted scopes and revoke actions
    └── Workspace access
        ├── all-workspace comparison
        └── selected workspace detail
            ├── connected-host authority
            ├── allowed behavior
            ├── approval boundary
            ├── explicitly unavailable behavior
            ├── readiness and setup
            ├── active or proposed workspace rules
            └── pending work linking to Reviews
```

**Automations** leaves Settings. `/settings?section=automations` redirects to
**Workspace access**. `/settings?section=agents` also redirects there so saved
links retain a useful destination.

## Reviews

**Reviews** is a Today-owned operational destination at `/reviews`. It contains
only work that needs the signed-in person's judgment or intervention:

- **Review**: a proposed rule, guidance draft, Finance case, or consequential
  approval.
- **Attention**: source reconnection, an agent blocker needing the person, or a
  workspace attention item with a concrete next action.

Generic setup instructions, credential creation, healthy checks, and capability
explanations never enter Reviews. The existing cross-domain server read model
remains authoritative, but its `setup` kind and synthetic missing-credential
rows are removed. Setup state stays in **Workspace access**.

The page uses URL-owned `kind` and `workspace` filters. Filter changes reset the
opaque cursor stack and focus the queue heading. The server continues to own
snapshot-stable ordering and pagination. Queue actions deep-link to the owning
workspace or to the exact workspace-access review dialog; Reviews never
duplicates domain mutations.

## Connected agents

**Connected agents** answers “who can access Ilo?” It shows:

- the authenticated connection URL and connection state;
- observed OAuth hosts, their last use, exact scopes, and workspace coverage;
- active local/manual tokens, expiration, last use, exact scopes, and revoke;
- token creation as a labelled advanced fallback;
- revoked credentials in collapsed history.

An unused generated token is not described as a connected agent. Permission
labels use plain language and retain the exact scope identifier in disclosed
details. `automations:read` is described as **Read daily brief**. New credentials
cannot request `automations:write`; existing credentials may still display that
legacy inert scope until revoked.

## Workspace access

**Workspace access** answers “what can agents do here?” Its default **All** view
compares Mail, Calendar, Tasks, and Finances as compact rows. Each row shows the
workspace identity, connected-reader count, connected-writer count, setup
phase, and pending Review/Attention count. Loading, unavailable, and zero are
distinct.

Selecting a workspace owns `workspace=mail|calendar|tasks|finances` in the URL
and reveals:

1. observed hosts with that workspace's read or write scope;
2. **Allowed**, **Approval required**, and **Not available** capability lists;
3. source scope, including an explicit statement when access applies to all
   connected workspace sources because per-source credentials are unavailable;
4. the existing two-row `ReadinessPanel` and evidence dialog;
5. the server-owned setup plan and contextual setup disclosures;
6. active and proposed domain-owned rules, where the workspace publishes them;
7. a pending-work summary linking to `/reviews` with matching filters.

The account utility composes these facts but does not own domain policy.
Workspace adapters continue to define readiness and capability language. Mail
continues to own preview and activation; Finances owns signed-in review;
Calendar and Tasks own their actions and any future executable rules.

## Retiring the placeholder routine lifecycle

Morning Brief and Nightly Review routine installation, scheduling, run writes,
API routes, MCP list/run tools, and the API-process scheduler are removed. The
historical database tables remain inert for this release so a previous binary
can still roll back safely. They receive no new reads or writes and may be
dropped only in a later contract migration after the caller-removal release is
live and rollback no longer depends on them.

The useful daily-brief computation remains and is renamed as an independent
service. `/v1/daily-brief`, Today, and MCP `get_daily_brief` keep working under
the existing `automations:read` compatibility scope. The removed
`automations:write` scope grants no tool or endpoint and is excluded from every
new permission preset.

## Visual and interaction contract

- Reviews contains at most one raised primary block. Settings pages use open
  sequences and compact `ItemGroup` rows instead of dashboards made of cards.
- Workspace color appears only in the framed `WorkspaceIcon`; authority and
  status use text and semantic badges.
- Surfaces remain flat: no gradients or shadows, and borders only where they
  clarify an interactive or bounded object.
- Labels remain visible at every width. Icon-only revoke actions have specific
  accessible names.
- Desktop comparison becomes an ordered responsive list rather than a dense
  matrix table so the same reading order survives at 320 px.
- Destructive credential revocation is deliberate and reports success or API
  failure through the shared transient-feedback system.

## Data flow and ownership

- `apps/api` keeps the cross-domain work-item read model and removes setup
  candidates before pagination.
- `packages/api-client` continues to expose the typed work-item page and daily
  brief; routine lifecycle calls are deleted.
- `apps/web/src/features/reviews` owns the Reviews page and queue.
- `apps/web/src/features/settings` owns Connected agents and Workspace access.
- Workspace-specific adapters under each feature own readiness and capability
  statements.
- `app.tsx` and navigation manifests only wire routes, titles, and destinations.
- `apps/mcp` remains a stateless daily-brief adapter and drops routine tools.

## Error, empty, and compatibility states

- Reviews distinguishes caught up, partial-source failure, complete failure,
  loading, and filtered-empty results.
- Connected agents distinguishes checking, none connected, observed OAuth
  hosts, unused local credentials, expired credentials, and API failure.
- Workspace access never converts an unavailable permission/readiness query to
  zero or “not allowed.” It says **Unavailable** until evidence loads.
- Legacy settings URLs redirect with `replace` semantics.
- Existing credentials carrying `automations:write` remain revocable and
  inspectable but cannot invoke any removed behavior.

## Verification

1. Open `/reviews` with more than ten mixed Review and Attention items; verify
   workspace/type filtering, stable pagination, focus reset, deep links, partial
   errors, and caught-up state.
2. Verify `/reviews` belongs to Today in desktop and mobile navigation and uses
   the shared app frame at 320 px without document overflow.
3. Open **Settings → Connected agents** and verify OAuth hosts, active and
   revoked tokens, plain-language and exact scopes, copy, creation, and revoke.
4. Open **Settings → Workspace access**, compare all workspaces, select each
   one, and verify observed authority, explicit limits, readiness, setup, rules,
   and matching Reviews links.
5. Verify legacy Agent access and Automations URLs redirect to Workspace access.
6. Confirm the Automations navigation item, routine API routes, routine MCP
   tools, scheduler dispatch, and runtime routine-table reads/writes are absent;
   confirm historical tables remain untouched for rollback compatibility.
7. Confirm Today and MCP daily brief still return scoped daily material.
8. Run focused domain, API, client, MCP, React, route, desktop, and mobile tests,
   then `pnpm verify`.
