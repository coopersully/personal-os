# Tasks and Reminders — reference page specification

## User jobs

**Tasks:** Find a finite action, understand where it belongs and when it matters, then complete,
cancel, move, trash, or restore it without losing context.

**Reminders:** Find the lighter item that needs attention, complete or reopen it, and keep finished
reminders available without mixing Reminder lifecycle into Task organization.

These are related commitment surfaces, not interchangeable records. They currently retain separate
domain, API, authorization, and MCP contracts even though Task and Reminder rows share transitional
physical storage.

## Target product direction

Tasks should be a complete, familiar task manager rather than a queue attached to an agent. Its
target navigation includes Inbox, Today, Upcoming, Open, Later, Projects, long-lived organizational
containers, Completed, and Trash, with quick capture, strong keyboard control, search, filters,
progressive details, and capacity-aware planning.

External task providers feed imports into nohmi, after which nohmi is the authoritative working
workspace. Bidirectional synchronization across multiple task providers remains a possible future
capability, not a current goal. The long-lived container above Projects is a required concept but
its final user-facing label is unresolved; product copy must not assume “Areas.”

Tasks owns what the person intends to do and why. Calendar owns when time is committed. User
Knowledge supplies relevant goals, priorities, relationships, constraints, routines, habits, and
planning preferences without copying them into each Task.

## Information hierarchy

```text
Orientation (app frame)
├── Current workspace and selected query/container
├── Search across title and notes
└── Direct create action for the current material

Tasks context (sidebar)
├── Inbox, Today, Upcoming, All
├── Lists and Projects: collection destinations
├── Pinned: explicitly pinned active Lists and open Projects as independent entries
└── History, Trash

Tasks top navigation (shared app frame)
├── Compact view picker: Inbox, Today, Upcoming, All, active Lists/Projects, History, Trash
├── Search, Filter, Sort, and Display
└── Contextual List/Project actions (active-filter chips and counts accompany results)

Shared queue
├── Task and Reminder rows retain their own record type and actions
└── Explicit selection reveals compatible batch actions
```

Views are queries and own no records. Inbox is a List, not a View or Task lifecycle. Scheduled is
derived from reserved time; Completed and Cancelled derive from lifecycle.

### Compact navigation and queue (trial)

The Tasks feature owns this hierarchy trial: all destinations are visible, and common controls
work across the shared queue. Behavior coverage and responsive inspection validate implementation,
not user comprehension or research outcomes.

- Inbox is visually promoted but remains the protected List. Projects can still belong to Inbox.
- Lists and Projects are collection destinations. Explicitly pinned active lists and open projects
  appear in a flat **Pinned** group; project pins are independent of list pins. All other containers
  remain available in their collection grid and the view picker.
- The primary plus opens the shared creation flow. List menus expose Edit list and Archive list;
  Inbox needs no management menu. Project menus open the existing management flow, including lifecycle
  and move previews. The top bar exposes the same contextual menu when a container is open.
  Menu controls are keyboard-accessible and visible on touch. Archive menu selection opens a
  confirmation before any write; active-content conflicts remain server-authored.
- Today, Upcoming, and All can mix tasks and reminders. All includes undated material. History
  includes completed/cancelled records and unavailable container context; its archived-container
  link preserves even empty List/Project history. Trash is separate and recoverable. Scheduled is
  a reserved-time filter, Reminder is a type filter, and Completed/Cancelled are History filters.
- `/reminders`, `view=scheduled`, `view=completed`, and `view=cancelled` redirect to equivalent
  shared queries. No record is converted, moved, or duplicated by changing views.
- Workspace rows show a checkbox, title, and one compact timing/organization/estimate line.
  Notes and tags are optional Display details and remain in the inspector. High priority uses a
  subtle semantic tone and accessible text label. Reminder checkboxes remain round; Task
  checkboxes remain rounded-square. Trash is confirmed and restored from Trash. Today retains
  its separate compact row composition.

## Interaction contract

- Search belongs in the app frame and uses the `q` query parameter so results are linkable and
  survive browser history. The API searches title and notes; the page has no second client index.
- Direct container navigation uses `list` and optional `project`; Inbox is `/tasks` without its
  generated ID. Global views may additionally filter by List/Project. An exact record adds `task`
  or `reminder`. Filters, sorting, grouping, and optional row details are URL-backed. Navigation
  preserves search/presentation preferences while starting the new destination without stale
  lifecycle/type filters.
- A valid Project is authoritative: a missing or mismatched `list` parameter rewrites to the
  Project's actual List. Invalid ordinary selections return to canonical Inbox. Archived Lists and
  terminal/archived Projects are read-only history destinations under `/tasks?archive=all`; they
  remain unavailable to capture and move operations.
- Ordinary List and Project queues contain open Tasks by default. Their closed history is reached
  deliberately with the lifecycle filter rather than mixed into the action queue.
- Today includes every open overdue deadline plus Tasks due or reserved in the person's local day.
  It orders overdue deadlines first, reserved work second, and remaining due-today work third.
  Upcoming and Scheduled are chronological; terminal and Trash Views use their lifecycle time.
- Capture chooses one List (Inbox by default), an optional active/open Project in that List, a
  deadline, and reserved time in the primary form. `why`, notes, priority, estimate, and tags stay
  under **More details**. Deadline and reserved time are independent controls.
- Existing Tasks open in a right-side inspector sheet. The full form, lifecycle actions, and a
  progressive record-details disclosure (source, revision, creation, and update times) remain
  available without losing the queue behind it.
- Task lifecycle is only open, completed, or cancelled. There is no status selector and no Next
  destination. Complete, cancel, reopen, trash, and restore are focused actions outside the content
  form and use current revisions.
- A Task move that would detach its Project requires a server preview and explicit disclosure.
  Project moves likewise require a server preview with the affected Task count. Completing a
  Project or archiving a non-empty List presents the exact API conflict resolutions; the page does
  not invent cascade behavior.
- The protected Inbox cannot be renamed or archived. List and Project names surface normalized
  duplicate/reserved-name failures without hiding the form.
- Reminders remain distinct records inside the Tasks workspace, never members of a Task List or
  Project. **New task** is primary; its adjacent create menu exposes **New reminder**.
- Advanced lifecycle and timing filters are URL-backed and sent to the canonical API query. The UI
  does not fetch a broad result and filter it locally.
- Date filters start with Any time, Today, Tomorrow, and Next 7 days. Custom range reveals exact
  deadline/reserved bounds under Advanced. Presets use the planning timezone and calendar-day
  boundaries, including daylight saving; inclusive upper bounds exclude the following midnight.
  Applied ranges are fixed, shareable instants, not silently moving saved relative queries. Chips
  remove a complete range without dropping search or container selection. Clear removes filters
  and task selection, not the current scope or search.
- Creating, editing, moving, completing, cancelling, reopening, trashing, restoring, or changing a
  Task container invalidates Tasks, Today, Calendar, Activity, and organization queries together.
  Reminder mutations invalidate the corresponding shared projections.
- The optional shared secondary app bar sits directly below the Tasks title/search row. It keeps
  scope orientation and Filters out of the scrolling queue. Filters opens the shared responsive
  dialog (desktop) or drawer (mobile); Apply and Clear update the URL and close it. Lifecycle is
  available only where the current scope supports it. Archive has scope orientation but no filters.
- The body begins with the queue. Project
  orientation includes its parent List, purpose, target date, and loaded open count. This context
  remains visible when the desktop sidebar is absent.

### Query and action ownership

- `GET /v1/task-workspace` and the typed client return canonical discriminated Task/Reminder
  records, read-only state, relevant date, grouping key, total matched count, and a bounded cursor.
  SQL applies kind/status/priority/tag/deadline/reserved-time/container/search filters before
  sorting, grouping, counting, or paging. Never sort only the first loaded page in the browser.
- Sort choices are recommended, relevant date, reserved time, priority, newest, oldest, title, and shortest
  estimate. Group choices are none, date, List, and Project. Missing dates/organization remain
  visible in an explicit ungrouped bucket. Grouping is also server-ordered before pagination.
- Mixed reads require Tasks and Reminders read scopes. Single-kind API reads retain least
  privilege. MCP exposes the shared read projection without copying its query rules; surgical
  mutation tools and their scopes remain separate.
- Select items switches completion controls to selection controls. Select visible is explicitly
  bounded to the first 100 loaded mutable rows. Selection never silently expands to unseen pages.
- Batch Complete/Reopen/Trash/Restore appears only when compatible with every selected item.
  Operations call each existing guarded API with its current revision, not a new generic mutation
  endpoint. Partial failure reports the count and each failed title/error; successful rows leave
  selection. No implied transaction or silent partial success.
- This does not introduce agent maintenance, generated review queues, task recurrence, tracking,
  or notification delivery. Use existing source/revision details and audits as evidence.

## State matrix

| Situation | Visible treatment |
| --- | --- |
| Loading | Workspace-preserving skeleton; contextual navigation remains understandable. |
| Dependency unavailable | Named inline error for Tasks, Lists, or Projects with retry. |
| Empty View/List/Project | Selection-specific guidance without fabricating a status. |
| Search has no matches | “No matching tasks/reminders” with guidance to try another title or note. |
| Mutation pending | The affected control is disabled; dialogs expose pending copy. |
| Mutation conflict | Exact structured choices and current revision data from the API. |
| Mutation failed | The affected row or dialog stays open and actionable with the failure. |
| Partial Task move | The dialog retains the moved revision/location and retries only the remaining edit. |
| Populated | Compact, directly manipulable rows with organization, useful timing, and only meaningful non-default priority/lifecycle cues. |
| Archive index | Archived Lists and terminal/archived Projects link to explicit read-only history URLs. |

## Implementation map

| System concept | Current implementation |
| --- | --- |
| shared app-frame search | `components/workspace-search.tsx` |
| optional secondary frame and contextual slots | `components/workspace-layout.tsx`, `components/workspace-secondary-app-bar.tsx` |
| shared projection invalidation | `lib/material-queries.ts` |
| Shared workspace/rows/controls | `features/tasks/workspace-page.tsx`, `workspace-row.tsx`, `workspace-controls.tsx` |
| Query and batch helpers | `features/tasks/workspace-query.ts`, `workspace-actions.ts` |
| Context navigation, Today rows, archive compatibility | `features/tasks/task-navigation.tsx`, `features/tasks/page.tsx` |
| Planning-timezone date presets | `features/tasks/task-filter-presets.ts` |
| Task capture dialog and edit inspector | `features/tasks/task-dialog.tsx` |
| List management | `features/tasks/task-list-dialog.tsx` |
| Project management and conflicts | `features/tasks/task-project-dialog.tsx`, `features/tasks/project-conflict-dialog.tsx` |
| app-frame composition and Today integration | `app.tsx` |

## Verification

1. Open `/tasks`; confirm Inbox is selected without a generated URL parameter and Inbox, Today,
   Upcoming, All, Lists/Projects, History, and Trash are visible without opening a menu. Switch and
   reload; every project remains visible and only the selected destination is current.
2. Select Today, a standard List, and a Project. Confirm the canonical `view`, `list`, and
   `list+project` URLs survive refresh and preserve `q` and advanced filters.
3. Open a Task row, refresh its `task` URL, and confirm the same right-side inspector returns.
4. Create a Task with a List, optional Project, `why`, deadline, and reserved time. Confirm there is
   no Next/status selector, optional material starts under **More details**, and each timing field
   survives independently.
5. Move a Project Task to another List and confirm the detachment preview appears before commit.
   Move a Project and confirm the preview count and revision-bound commit.
6. Exercise Project completion and every List archive conflict resolution, including archiving
   contents together; confirm cancellation makes no write.
7. Open Archive and verify archived Lists and terminal Projects retain readable Task history.
8. Complete, cancel, reopen, trash, and restore a Task; confirm Tasks, Today, and Activity refresh.
9. Search Tasks and Reminders by title or note; verify a no-match search differs from an empty
   selection.
10. Inspect desktop and 320 px layouts. Confirm search, direct creation, contextual navigation,
   conflict choices, and row actions remain reachable by keyboard.
11. Filter mixed material by kind, dates, no deadline, priority, reserved time, and container. Sort
    across multiple pages and group with ties/nulls; compare API totals and cursor traversal.
12. Select a mixed set, test compatible actions and partial conflicts, then confirm Trash recovery
    does not discard source, revision, or container fallback information.

### Compact Tasks header

The top header owns the view picker and end-aligned Search, Filters, Sort, Display, and
container actions. It uses the same shadcn radio dropdown pattern as Calendar. Selecting a
view clears the previous container scope while retaining explicit filters and presentation
choices. List/project names truncate without displacing controls. Item counts and active filter
chips sit above results, not in a second navigation bar. On mobile, creation stays in the
shared floating action area and review attention stays in the header. Below 360px the utilities
wrap to a second row within the primary header so the view name remains readable. Legacy archive recovery
may retain its contextual secondary bar.

The Tasks picker retains the selected destination’s icon before its name. Its groups mirror
the sidebar’s views, active lists/projects, and history destinations. The result count sits
at the start of the list toolbar, opposite Select items; selection reads “3 items • 1 selected.”
Partially loaded queues append the number shown without replacing the total.

### Creation flow

The workspace creation action is an icon-only plus. It opens a responsive dialog/drawer with
Task, Reminder, Project, and List choices. Tasks choose a list and optional active project;
projects choose a list. Default to the current active container, otherwise Inbox. Explicitly
choosing no project must override any project in the underlying route. Reminders and lists
skip irrelevant placement questions. Existing domain editors retain validation and save behavior;
list/project editors use the same responsive modal primitive.

Creation uses a shared progress bar through choice, optional placement, and details. All detail editors use the responsive dialog/drawer pattern and standard form fields. Projects use the registry ProjectIcon (box) in every navigation and creation surface. Container menus manage existing containers; project creation belongs in the primary plus flow. List icon choices are compact icon-only tiles in an adaptive row/grid, with accessible names, hover titles, and a subtle selected state.

### List and project collections

Lists and Projects are first-class Tasks views in the sidebar, view picker, and workspace search catalog. They use responsive card grids and share the workspace header control positions. The filter popover searches names and descriptions (plus project notes and the owning list), and selects lifecycle/archived status. Lists default to active; Projects default to open projects in active lists. Default to most recently updated (the persisted update timestamp, not a page visit). Also sort by name or creation date; Projects also support target date with undated work last. URL parameters retain collection search/filter/sort state, but collection-only filters never leak into task queries. Existing paginated domain APIs and query caches own collection data; no duplicate storage or alternate records. Cards open their contents and offer the existing management actions.

Lists and projects can be explicitly pinned from their cards. Account-backed Tasks preferences store separate list/project IDs with revision checks and owner validation. The sidebar replaces My lists and automatic project nesting with a flat Pinned group containing only explicit, available pins. Pinning a list does not implicitly pin its projects. Pins do not alter the grid sort. Archived or deleted material stays out of active sidebar navigation.

The Tasks view picker contains page destinations only: Inbox, Today, Upcoming, All Lists, Projects, History, Trash, and Archive. Individual containers remain accessible through their grids and explicit sidebar pins. Archive has its own sidebar destination and active state, separate from History. Action collections with one available action render a directly labeled icon button; overflow menus are reserved for multiple actions.
