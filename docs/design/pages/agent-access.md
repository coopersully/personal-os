# Agent access — action queue and contextual setup specification

## User job

**See what needs me across agent-enabled workspaces, complete the highest-priority
action, and manage access or setup only when needed.**

The surface is a supervision and connection point, not an instruction relay or
embedded chat. A cross-domain read model gathers person-owned review,
attention, and setup work without taking mutation ownership away from Mail,
Finances, Calendar, Tasks, or access management.

## Information hierarchy

```text
Agent access
├── observed connection summary and Manage access
├── Your action queue
│   ├── All / Review / Attention / Setup
│   └── one ordered, cursor-paginated list across workspaces
├── Agent workspaces
│   ├── Mail / Finances / Calendar / Tasks
│   └── selected workspace readiness and contextual setup
│       ├── readiness overview and evidence dialog
│       ├── Connect an agent
│       └── server-owned setup plan and optional protocol details

Access management
├── connected OAuth hosts and revoke actions
└── advanced local-token setup and revoked-token history
```

## Action queue contract

- `GET /v1/assistant/work-items` is an Integration-owned read model. It may
  project Mail rules, Finance reviews, guidance drafts, attention items,
  reconnect requirements, and observed agent authority, but every mutation
  stays with its owning domain API.
- Queue kinds are exactly **Review**, **Attention**, and **Setup**. Healthy
  diagnostics and agent-owned setup activity remain workspace evidence rather
  than being presented as human work.
- Account-level work such as **Connect an agent** uses `domain: null`, the Key
  functional icon, and the label **Agent access**. Workspace work retains its
  framed workspace identity.
- Ordering is deterministic: person-only review, blocked agent work, critical
  through low attention, then remaining setup; ties use effective action time,
  update time, and stable item identity.
- Pages contain at most ten rows at every breakpoint. The opaque cursor binds a
  snapshot, active filters, priority, effective time, update time, and item ID.
  The client stores returned cursors only for backward navigation and never
  manufactures offsets.
- Changing **All / Review / Attention / Setup** resets to the first page and
  restores focus to the queue heading. The range uses the selected kind's exact
  count. A successful empty result says **You’re caught up**.
- Source projections settle independently. Available work remains usable when
  one source fails; affected counts become unknown, unavailable workspaces are
  named, and the UI never reports a false zero.
- A queue row has one explicit action. Review links open the owning bounded
  review experience; navigation links open the owning workspace or access
  surface. The row is not a second catch-all target.

## Setup protocol contract

- `GET /v1/assistant/context` and MCP `get_ilo_context` are the orientation
  contract. They identify the actor, local time, granted scopes, setup
  readiness, available tools, safe workflow stages, and links to Today,
  activity, approvals, and recovery. A host calls this before choosing a
  domain workflow.
- `GET /v1/assistant/setup-plan` and the MCP `get_ilo_setup` tool expose one
  authenticated plan for a selected domain. The response identifies a stable
  semantic step, plan status, connection evidence, scoped authority, profile
  state, progress, instructions, required tools, approval owner, and next
  action. Hosts call it immediately after connection and again after saving or
  approval.
- Semantic IDs are stable protocol vocabulary, not display order:
  `connect_agent`, `learn_preferences`, `review_guidance`, and `complete`. A
  caller may request one step by ID for context, but Ilo still returns the
  actual `currentStepId`; a caller cannot advance the plan by selecting a step.
- The server owns completion. An authenticated MCP request or previously used,
  active credential proves a host reached Ilo. A saved profile proves guidance
  exists. Required signed-in approval or active guidance proves the review
  boundary has completed. An unused generated token, copied prompt, opened
  disclosure, or downloaded skill proves none of those things.
- Connection evidence is deliberately narrow: Ilo can prove an authenticated
  request reached its API and which scopes it carried. It cannot inspect a
  third-party host's filesystem, plugin registry, or internal configuration.
- The agent exhausts bounded, least-sensitive Ilo evidence before asking the
  person questions. It refines an existing profile, asks only about unresolved
  choices, saves a draft first, previews consequential behavior, and returns to
  the plan after every state change.
- The person owns the unavoidable MCP authorization, genuine preference
  decisions, and consequential approval. Ilo and the agent own discovery,
  inspection, draft construction, status checking, and next-step routing.
- Missing read or write scope blocks the plan and names the exact required
  scopes. The agent explains that boundary; it never silently requests broader
  access or treats signed-in browser authority as agent authority.
- `get_agent_setup_status` remains an opt-in compatibility status view and is
  omitted from normal discovery. It must not compete with `get_ilo_setup` as a
  procedural source of truth.

## Connection and distribution contract

- The API publishes a typed connection guide containing the configured MCP
  resource URL and an optional, immutable skill identity. The web client does
  not hard-code deployment endpoints.
- Remote MCP with Ilo OAuth is the recommended path. The consent page names the
  requesting host, lists each requested permission in plain language, explains
  that provider credentials stay in Ilo, and provides authorize and cancel
  actions.
- Personal access tokens are an advanced fallback for local or manual hosts.
  Presets are task-oriented, permissions remain editable, and the secret is
  displayed once. Revoking one host never ends a human Ilo session or affects a
  different host.
- MCP discovery is generated from the credential's actual scopes. The
  `/mcp/readonly` endpoint additionally removes every mutation regardless of
  granted write scope. Agent hosts should not show inaccessible tools or
  prompts with unavailable prerequisites.
- `ilo://` context, setup, and guidance resources progressively disclose
  reusable state. `ui://ilo/work-surface` may render selected results as an MCP
  App, but useful text and structured fallbacks are mandatory.
- A separately installed skill is not required when the MCP host exposes
  `get_ilo_setup`. The versioned Ilo-hosted `SKILL.md` and relative references
  are compatibility documentation for hosts that support skills. They defer to
  the authenticated plan and cannot grant scope, prove connection, or approve
  behavior.
- Workspace selection is URL-owned through `workspace=mail|finances|calendar|tasks`
  and changes the server plan, readiness, and capability statement. The
  selector covers Mail, Finances, Calendar, and Tasks. Their
  profile-and-attention envelopes remain shared while domain-owned adapters
  derive material and workflow rows from authoritative APIs.
- Selectors are enabled only when the connection guide publishes that domain.
  Missing and explicitly unsupported entries disable setup and never inherit a
  generic capability or another domain's rules.

## Domain safety boundaries

- Mail can inspect connected source identity, mailbox role, freshness, and a
  bounded sample; learn signal and noise; save a draft profile; create linked
  attention; and preview disabled rules. The signed-in person activates a rule
  after exact re-review. Permanent deletion, provider filter creation, spam
  classification, and unsubscribe automation remain unavailable.
- Finance setup may read account identity, ledger health, review state, and
  suggested workflows without unnecessarily exposing balances. The agent may
  save a guidance draft; transaction edits, categorization decisions, account
  changes, and activation remain in the signed-in Finance surface.
- Calendar setup may learn selected and writable destinations and preview
  strong-evidence commitments. It does not imply automatic event creation or
  invent evidence from cached prose.
- Tasks setup may learn capture, priority, estimate, scheduling, and deadline
  preferences while executable behavior stays inside the Tasks API. Reminder
  behavior remains a Tasks sub-surface and is not presented as a fifth
  workspace.

## Readiness and recovery

- Workspace choices are one mutually exclusive control family. Each keeps a
  persistent framed workspace icon, label, and truthful setup phase. Workspace
  color supplements the icon and label; it never carries state. Setup phase is
  **Checking**, **Not set up**, **Needs
  review**, **Set up**, or **Unavailable** and never masquerades as readiness.
- The selected workspace shows one readiness overview before diagnostic rows. It
  uses the shared `ReadinessPanel` and reports **Checking** or **Unavailable**
  until the required reads settle. Determinate states show **Needs attention**
  or **Ready**, the truthful completed-check count, a progress bar, and either a
  directive-style **Next step** or an honest **Current constraint** when the
  first failed diagnostic has no user action.
- The closed readiness overview has a hard two-row maximum at every width. Row
  one contains product identity, status, and a one-line focus that replaces the
  normal description. Row two contains completed-check count, progress, and
  **View checks**. A focus callout, nested item, action row, or expandable
  diagnostic area is not allowed.
- **View checks** sits at the end of the progress row and opens full readiness
  evidence as one vertical comparable list in a labelled dialog. The overview
  never expands or changes page height. Working actions stay with their checks
  inside the dialog.
- Missing sources show a working route to the owning connection surface.
- Loading, unavailable, empty, and zero are distinct. Counts and empty guidance
  appear only after the owning query succeeds.
- Connected source readiness names the account or calendar rather than exposing
  opaque IDs and calls out stale or reconnect-required state.
- Attention readiness reports its bounded open result; `100+` means the page
  limit was reached, not that the result is exhaustive.
- Agent authority comes from active, unexpired, observed credentials. The
  selected domain reports whether the observed host carries its read and write
  scopes.
- Copy actions are individually labelled and confirm their result through the
  shared transient-feedback system.
- Connected OAuth clients and access tokens show compact permission and
  last-use state. Revoked tokens remain in collapsed history.

## Responsive and accessibility contract

- The action queue remains above workspace diagnostics and access management at
  every width. Rows may wrap internally, but workspace identity, kind, title,
  and the one explicit action retain their reading order.
- The two contextual setup disclosures remain one ordered vertical sequence
  at every width. Expanding a disclosure never changes its completion state.
- Workspace choices use four equal controls at normal widths and two columns at
  narrow widths. Their icon, label, focus, selection, and disabled geometry
  remain stable.
- The readiness overview retains its aggregate state, determinate progress, and
  one-line current focus at every width without exceeding two rows. Its progress
  bar has the same visible count as its accessible name; **View checks** remains
  on that row and the dialog title names the selected workspace's evidence.
- The four protocol steps use the shared Item composition with text status;
  check and circle icons supplement rather than replace that status.
- Every copy action, domain choice, permission preset, disclosure, and revoke
  action has a persistent accessible name and keyboard target.
- URLs and fallback requests remain selectable in read-only controls and wrap
  without widening the page.
- Capability and safety explanations use semantic alerts. The advanced token
  flow, revoked history, and optional protocol reference remain collapsed by
  default. Mail rule preview is a URL-owned, labelled dialog; active healthy
  rules do not become default-page rows.

## Verification

1. Open **Settings → Agent access** with more than ten mixed items. Confirm
   person review precedes blockers and attention, **Next / Previous** has no
   duplicates, and filtering resets to the first page with the correct total.
2. Select each published workspace and confirm the URL, icon-labelled choice,
   aggregate overview, evidence dialog, and contextual setup plan change together.
3. Open a Mail review deep link, confirm the exact bounded preview and approval
   prerequisite, close it, and confirm only `reviewRule` is removed from the URL.
4. Before an agent call, confirm the connection step is incomplete even when an
   unused token exists.
5. Connect a dynamic OAuth client, inspect plain-language consent, complete PKCE
   exchange, call `get_ilo_context` and then `get_ilo_setup`, and confirm Ilo
   records the authenticated connection and advertises exactly the granted
   scopes.
6. Follow the returned Mail plan: inspect bounded context, save a draft, call
   `get_ilo_setup` again, complete signed-in review, and call it once more to
   confirm `complete`.
7. Repeat the state transition for Finances, Calendar, and Tasks while
   confirming their domain-specific boundaries remain intact.
8. Request a non-current semantic `stepId` and confirm `selectedStepId` changes
   without changing `currentStepId`, completion evidence, or persisted state.
9. Revoke the OAuth host and confirm its tokens can no longer use MCP and the
   human Ilo session remains active.
10. Expand optional protocol details, fetch the advertised versioned `SKILL.md`
   and one relative reference, and confirm the skill directs the host back to
   `get_ilo_setup` rather than presenting a competing checklist.
11. Verify caught-up and partial-source states, loading/error recovery, keyboard
    operation, copy feedback, 320 px
   layout, and normal desktop layout.
12. Record a real compatible-host invocation separately from local or mocked
    tests. It proves that host and deployed boundary worked; it does not prove
    every host can install skills or that future network calls will succeed.
