# Workspace settings separation and MCP link integrity design

## Status

Design approved in conversation and implemented for pull-request review.

- Owners: account utility, assistant integration, Mail, Finances, Calendar,
  Tasks, MCP transport, and production deployment.
- Affected surfaces: Settings navigation, **Workspace access**, four new
  workspace Settings pages, existing workspace configuration and review links,
  MCP response metadata, and MCP production task configuration.
- Immediate user jobs:
  - In **Workspace access**, understand only whether connected agents can read
    or prepare work in each workspace.
  - In a workspace's Settings page, understand whether setup is complete and
    finish any configuration decision that needs the signed-in person.
  - In an operational workspace, review the actual email, transaction, event,
    or task items that need judgment.

This design supersedes the parts of
`2026-08-12-agent-controls-and-reviews-design.md` that place readiness, setup,
rules, and pending work inside **Workspace access**. Its separation of
**Connected agents**, **Workspace access**, and operational **Reviews** remains
valid.

## Problem and production evidence

**Workspace access** currently combines three different questions:

1. what connected agents are authorized to access;
2. whether a workspace is configured and its sources are healthy;
3. whether the person must approve guidance or review operational material.

The page presents four workspace choices with access language, readiness
progress, a checks dialog, a server-owned setup plan, and a persistent
**Let the agent set up Ilo** disclosure. The same setup prompt remains visible
after setup is complete. A person cannot tell whether a status describes agent
authority, source health, agent-owned setup work, or a decision they personally
must make.

The production Finance path demonstrated the failure. **Finances** displayed
**Needs review** and its checks dialog said that draft profile v1 was waiting
for review, but the dialog offered no action. The actionable approval existed
at `/finances/profile`, outside Settings. After activating the profile there,
Finance correctly reached setup phase `complete`, profile version 2, and 5/5
readiness; **Workspace access** still showed the agent-setup disclosure.

Production MCP responses exposed a separate trust defect during the same
journey. Tool-owned content used the production application origin, while the
standard `_ilo.links` metadata used `http://localhost:8081`. The MCP process
silently falls back to that local origin when `APP_BASE_URL` is absent. The
running production MCP task lacked the variable, and deployment preserves that
drift because it replaces only the image in the live task definition.

These defects share one product requirement: every status or link shown to a
person or agent must identify its owner, its meaning, and its next valid action.

## Chosen information architecture

```text
Settings
├── Personal
│   ├── Profile
│   ├── Appearance
│   └── Wallpaper
├── Sources
│   └── Connections
├── Workspaces
│   ├── Mail
│   ├── Finances
│   ├── Calendar
│   └── Tasks
└── Agents
    ├── Connected agents
    └── Workspace access
```

The current standalone **Calendars** settings surface moves into the
**Calendar** workspace Settings page under its sources section. This prevents
the navigation from presenting both **Calendar** and **Calendars** with an
unclear distinction. **Connections** remains the cross-workspace place for
authorizing and reconnecting external providers.

The stable Settings URLs are:

- `/settings?section=mail`
- `/settings?section=finances`
- `/settings?section=calendar`
- `/settings?section=tasks`
- `/settings?section=agent-connections`
- `/settings?section=workspace-access`

The legacy `/settings?section=calendars` URL redirects with replace semantics
to the Calendar Settings page and preserves any supported editor state.

Workspace Settings destinations show an **Action required** badge when the
server-owned setup plan's current step belongs to the signed-in person. The
same setup-plan query drives the badge and the page action so navigation never
contradicts the destination. Unknown, unavailable, agent-owned, and completed
states do not receive an action badge.

## Workspace access

**Workspace access** answers one question: **What can my connected agents
access and do?** It does not report setup readiness or workspace work.

The page shows one compact row for each published workspace. A row includes:

- workspace identity;
- whether any currently connected host has read access;
- whether any currently connected host has write or proposal access;
- a short, plain-language boundary such as **Can read and prepare changes;
  your approval is required**;
- a link to **Connected agents** when the person wants to inspect or change the
  exact host or credential scopes.

The selected-workspace detail, if retained, may explain exact capabilities and
limits by host. It may not include readiness checks, setup phases, source
health, guidance drafts, pending review counts, or setup instructions.

Its three access tiers remain labelled **Allowed**, **Needs your approval**,
and **Not allowed**. Every capability item starts with a stable semantic
icon—check circle, hand, or x circle—while the existing wording remains in
place as the readable source of truth.

Loading, unavailable, no connected host, no granted access, read-only, and
read/write or proposal authority are distinct states. The interface never
converts an unavailable authority query into **Not allowed**. Exact scope IDs
remain available in disclosed technical detail on **Connected agents**; this
page uses human language.

Access changes remain credential operations. **Workspace access** can link to
the correct host on **Connected agents**, but it does not grow a second token
or OAuth management interface.

## Workspace Settings page contract

Mail, Finances, Calendar, and Tasks each publish a domain-owned Settings page
through a shared shell. The shell creates a consistent reading order without
centralizing domain policy.

### 1. Action summary

The first region answers **Do I need to do anything in Settings?** It renders
one **Action required** alert only when the server-owned current setup step
belongs to the signed-in person. The alert names that one next action and links
directly to its control when a dedicated destination exists.

Completed setup and agent-owned progress do not create reassurance banners or
task-like panels. Their absence means there is no person-owned setup action;
the readiness summary directly below remains the place to inspect workspace
health. Loading and unavailable setup states remain explicit, but they never
become a false action badge.

### 2. Configuration and guidance

Configuration decisions that define how Ilo or an agent should behave are
reviewed directly on the workspace Settings page. Examples include Finance
guidance, workspace automation rules, and equivalent future Mail, Calendar, or
Tasks policies.

The page renders the domain-owned review component and calls the existing
domain mutation. Settings does not reimplement validation or persistence.
Draft, active, superseded, saving, success, and failure states remain explicit.
Consequential activation requires a labelled button and reports the resulting
active version.

The current Finance profile/guidance review moves from `/finances/profile` into
**Settings → Finances**. The old route redirects to that exact Settings section
and, when applicable, anchors or opens the guidance review. There is one
authoritative approval control, not two synchronized copies.

Guidance such as `monthly_review: true` describes desired agent behavior; it is
not evidence that a durable scheduled automation exists. The UI labels
guidance and scheduled automation separately. It may offer a setup action for
a supported automation, but it must not say one is scheduled until the
scheduler returns an actual persisted schedule and next-run state.

### 3. Setup and sources

The page never renders the setup plan as a checklist. It shows only the current
person-owned action; completed and blocked future steps remain hidden. Agent
protocol details remain one collapsed troubleshooting disclosure while setup
is incomplete.

Once setup is complete, both setup instructions and the troubleshooting
disclosure disappear. **No settings action needed**, **Let the agent set up
Ilo**, completed steps, and waiting steps are not permanent page sections.

Required source health and connection state live here because they determine
whether this workspace works. Provider authorization and reconnection actions
may deep-link to **Connections**. Calendar selection and visibility controls
move from the former **Calendars** Settings page into this section of
**Settings → Calendar**.

### 4. Operational work

Settings neither summarizes nor hosts operational work. Transactions,
messages, events, and tasks that need judgment remain visible in their owning
workspace or the shared **Reviews** destination. Their counts are not setup
evidence and cannot create a workspace Settings action badge.

- Finance transfer, duplicate, categorization, and transaction decisions stay
  in Finances.
- Mail message review stays in Mail or the shared Reviews queue. Draft
  automation or rule-policy approval is configuration and stays in Settings.
- Calendar event decisions stay in Calendar.
- Task-item decisions stay in Tasks.

This boundary avoids two mutation surfaces, inconsistent pagination, and
unclear return paths. Configuration approval is completed in Settings;
material-item judgment is completed where the material is understood.

### 5. Checks and diagnostics

Detailed readiness evidence is available behind **Review checks**. Unresolved
checks appear first with full evidence and actions; completed checks stay
collapsed as compact one-line history. The disclosure supports diagnosis and
may link to the exact configuration or source action. It is not the primary
task list.

Checks distinguish healthy, action required, agent in progress, unavailable,
and not applicable. A status without an action must not imply that the person
can resolve it. Counts are labelled with their source and freshness when that
context affects interpretation.

## Domain composition and ownership

The shared account utility owns only:

- Settings navigation and route compatibility;
- the workspace Settings shell and common action-state vocabulary;
- the access-only comparison surface;
- composition of links to connected-agent management and operational work.

Each workspace remains authoritative for:

- readiness facts and source requirements;
- setup-plan interpretation;
- configuration drafts, active configuration, validation, and activation;
- operational review counts and destinations;
- capability wording supplied to the access comparison.

Workspace adapters expose typed view models rather than allowing Settings to
query feature tables or infer status from labels. The intended boundary is:

```ts
type WorkspaceSettingsState = {
  action: WorkspaceConfigurationAction | null;
  checks: DomainReadinessItem[];
  configuration: DomainConfigurationSummary;
  setup: DomainSetupState;
  sources: DomainSourceStatus[];
  status:
    | "action_required"
    | "no_action_needed"
    | "setup_in_progress"
    | "source_attention"
    | "unavailable";
};
```

This is a UI composition contract, not a requirement for one cross-domain API
payload. Existing domain queries may be composed client-side when they already
provide consistent snapshot and error semantics. Cross-domain access facts
remain assistant-integration data because they compare agent authority across
workspaces.

## MCP link integrity

Every MCP response link uses one canonical configured application origin.
Tool-owned links and `_ilo.links` metadata call the same link builder; neither
constructs its own fallback origin.

For the HTTP production MCP entry point, `APP_BASE_URL` is required, parsed as
an absolute `https:` URL, and normalized once at startup. Missing, malformed,
or insecure production configuration prevents the service from reporting
ready and emits a clear configuration error. A local development entry point
may explicitly supply `http://localhost:8081`; the production path never gains
that value through an implicit fallback.

Deployment writes the expected production application URL into the rendered
MCP task definition on every release instead of inheriting whichever
environment keys happen to exist in the live revision. Infrastructure source,
deployment rendering, and runtime validation agree on the same variable name.

Generated links use allowlisted application paths. Workspace setup and
configuration links target the new workspace Settings sections, while
operational material links continue to target their owning workspace. The MCP
contract test asserts the origin and representative paths independently; a
healthy process alone is not sufficient production evidence.

## Error, empty, and compatibility behavior

- A failed configuration query produces **Unavailable**, not **No settings
  action needed**.
- A healthy workspace with zero operational reviews renders no settings action
  region or reassurance banner and does not render an empty review card.
- A completed setup with an unrelated source warning identifies the source
  warning without regressing the setup phase.
- A draft configuration names the person-owned approval action and opens the
  control directly; it never relies on evidence text alone.
- An agent-owned setup step reports **Setup in progress** and does not display a
  person-action badge.
- Legacy Settings and Finance-profile URLs redirect with replace semantics and
  preserve a useful destination.
- Unsupported workspace configuration sections say what is not yet available;
  they do not render inert controls.
- MCP startup failure is observable in service health and deployment status.
  It does not degrade into syntactically valid localhost links.

## Visual and accessibility contract

- Workspace Settings pages use the existing Settings reading width and flat
  section language; they are not dashboard grids.
- The action summary is the only visually primary region. Healthy checks and
  technical evidence do not compete with it.
- Status is expressed with text as well as color. Workspace color is limited
  to the framed workspace identity.
- Every action has a specific label, accessible name, pending state, success
  feedback, and failure feedback.
- Redirected or anchored review state restores focus to the page heading or
  opened review heading.
- The full information hierarchy works at 320 px without horizontal overflow,
  truncated action meaning, or icon-only status.

## Verification and acceptance criteria

1. Open **Workspace access** with zero, one, and multiple connected hosts.
   Verify each workspace reports only observed authority and boundaries; no
   readiness, setup, guidance, review, or source-health UI remains.
2. Open each workspace Settings page in complete, person-action, agent-action,
   source-attention, loading, partial-error, and full-error states. The first
   region must answer whether the person needs to act and what happens next.
3. Create a Finance guidance draft. Verify **Settings → Finances** exposes and
   activates it directly, reports the resulting active version, and removes
   the setup prompt after completion.
4. Verify transaction and other material review summaries link to their owning
   workspace and that Settings contains no duplicated item mutation controls.
5. Verify Calendar source selection works in **Settings → Calendar** and the
   old Calendars URL redirects without losing a supported edit target.
6. Verify a guidance preference for monthly review is not displayed as a
   scheduled automation in the absence of a persisted schedule.
7. Exercise keyboard, focus, pending, success, error, empty, and 320 px mobile
   behavior for the navigation and all new Settings sections.
8. Start the MCP HTTP service without `APP_BASE_URL`, with an invalid URL, with
   a local explicit URL, and with the production URL. Verify only valid,
   environment-appropriate configuration reaches ready state.
9. Assert representative MCP metadata and content links share the configured
   production origin and route to the correct Settings or operational page.
10. Inspect the rendered production MCP task definition after deployment,
    call a live read-only tool, and verify no response link contains localhost.
11. Run focused domain, API-client, web, MCP, infrastructure, route, desktop,
    and mobile tests, followed by `pnpm verify`.

## Explicit non-goals

- Creating or changing a recurring automation without a separate user choice
  of cadence and execution time.
- Moving transaction, message, event, or task-item review mutations into
  Settings.
- Redesigning Connected agents or the external-provider authorization flow.
- Treating stale Finance source data, inferred recurring obligations, transfer
  candidates, or other live-account material as resolved by this UI change.
- Dropping compatibility routes in the same release.
