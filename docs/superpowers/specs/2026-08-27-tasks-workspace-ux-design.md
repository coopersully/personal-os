# Tasks Workspace UX Design

**Status:** Approved for implementation

**Date:** 2026-08-27

## Outcome

The Tasks workspace helps a person capture finite work quickly, see what deserves attention in the
right order, organize it into Lists and Projects, and recover every record an authorized agent can
make less visible. The web remains a direct manipulation surface over the same Task ledger exposed
through the public API and MCP.

## Product contract

### Planning views

- Today includes every open overdue Task plus Tasks due or reserved in the person's current local
  day. It orders overdue deadlines first, then today's reserved work chronologically, then remaining
  due-today work chronologically.
- Upcoming includes open future deadlines or reserved time and orders by the earliest relevant time.
- Scheduled includes open Tasks with reserved time and orders by reserved time.
- Completed, Cancelled, and Trash order by the timestamp of the lifecycle event they represent.
- Inbox keeps capture order. Ordinary List and Project pages show open Tasks as the working queue and
  place completed and cancelled Tasks in closed History disclosure.

### Orientation

The primary app bar retains the Tasks workspace identity, search, and New task action. A Tasks-owned
secondary app bar persistently names the selected View, List, Project, or Archive scope. It exposes a
scope-specific Manage action without depending on hover or an open navigation drawer. On narrow
screens the selected scope remains visible after the navigation sheet closes.

Selecting a Project also shows a compact outcome overview with its List, why, target date, and open
Task count before the working queue. The overview is orientation, not a dashboard.

### Capture and detail

New task opens a short capture form containing Task, List, Project, Deadline, and Reserved time.
Why, Notes, Priority, Estimate, and Tags live under a labelled More details disclosure. Editing an
existing Task opens the full refinement surface. The surface is a right Sheet on desktop and keeps
all fields and lifecycle actions reachable at narrow widths.

Task rows omit the redundant Open label and duplicate edit glyph. The named primary action opens the
Task while the checkbox remains an independent completion control. Rows show priority only when it is
high or low and keep organization/timing context relevant to the selected scope.

### Human and MCP reachability

- Archive is a first-class Tasks history destination listing archived Lists plus archived,
  completed, and cancelled Projects.
- Archived List contents and terminal Project contents have canonical read-only web URLs and remain
  searchable and inspectable.
- A Task can be opened through a canonical `task` query parameter. Closing it preserves the current
  View/List/Project/filter selection.
- The List archive conflict renders every server-authored resolution, including Archive contents
  together. The confirmation explains that the material moves to Archive and remains inspectable.
- Advanced filters expose lifecycle and bounded deadline/reserved-time criteria backed directly by
  `TaskListQuery`. Fixed Views remain the primary navigation.
- Source, revision, created time, and updated time remain behind a labelled Details disclosure in the
  Task inspector.

## Architecture

Task query semantics and stable pagination remain owned by `apps/api/src/task-service.ts`; the web
must not reorder a partial page. The public domain query adds only the explicit read option needed to
inspect unavailable Project containers. MCP inherits that read capability through its existing
schema-backed `list_tasks` tool and keeps all mutation rules in the API.

Tasks feature code owns selection parsing, secondary context, archive/history composition, filters,
and Task detail. `app.tsx` receives only the minimal composition wiring required to render the Tasks
secondary bar and route-backed Task inspector. Existing shadcn primitives provide Sheet,
Collapsible, Popover, Item, Alert, and Buttons.

## Safety and accessibility

- Archive, lifecycle, move-preview, revision, and idempotency behavior remain unchanged.
- Every destructive choice is explicit and server-authored.
- Native controls and labelled landmarks preserve WCAG 2.2 AA keyboard behavior.
- Dialogs and Sheets have accessible titles; focus returns to the initiating control when possible.
- Loading, empty, error, search-empty, archive-empty, and pagination-recovery states remain distinct.

## Verification

- API integration coverage proves overdue inclusion and stable chronological pagination for every
  fixed View.
- React coverage proves canonical scope/task URLs, Archive reachability, every List conflict choice,
  progressive capture, scope orientation, Project overview, history disclosure, and filters.
- Playwright verifies populated and empty Tasks at desktop and 390 x 844, including scope persistence,
  task deep links, and Archive access.
- `pnpm verify` is the handoff gate.
