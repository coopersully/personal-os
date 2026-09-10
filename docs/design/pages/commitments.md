# Tasks and Reminders — reference page specification

## User jobs

**Tasks:** Find a finite action, understand where it belongs and when it matters, then complete,
cancel, move, trash, or restore it without losing context.

**Reminders:** Find the lighter item that needs attention, complete or reopen it, and keep finished
reminders available without mixing Reminder lifecycle into Task organization.

These are related commitment surfaces, not interchangeable records. They currently retain separate
domain, API, authorization, and MCP contracts even though Task and Reminder rows share transitional
physical storage.

## Information hierarchy

```text
Orientation (app frame)
├── Current workspace and selected query/container
├── Search across title and notes
└── Direct create action for the current material

Tasks context (sidebar)
├── Inbox, Today, Upcoming, All
├── Lists: active user Lists with their nested active, open Projects
└── History, Trash

Tasks secondary navigation (shared app frame)
├── Selected View/List/Project and available count/context
├── Filter, Sort, Display, and removable active-filter chips
└── Contextual List/Project actions

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
- Every active List and open Project remains visible as a direct link. User-created Lists sit under
  **My lists** with a quiet tonal button treatment and their chosen semantic icon, distinguishing
  them from system destinations without changing active-state geometry. Projects are permanently
  indented under their List with no filled submenu surface or disclosure toggle. Only the selected
  destination is current. Menus expose actions, never additional destinations.
- A header plus creates a List. List menus expose New project, Edit list, and Archive list. Inbox
  only exposes New project. Project menus open the existing management flow, including lifecycle
  and move previews. The secondary bar exposes the same contextual menu when a container is open.
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
