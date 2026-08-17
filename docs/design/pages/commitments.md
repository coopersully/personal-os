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
├── Views: Today, Upcoming, Scheduled, Completed, Cancelled, Trash
├── Lists: protected Inbox plus active user Lists
└── Projects: active, open Projects in the selected List

Tasks queue
└── One directly manipulable Task row with organization and timing context

Reminders queue
└── One directly manipulable Reminder row
```

Views are queries and own no records. Inbox is a List, not a View or Task lifecycle. Scheduled is
derived from reserved time; Completed and Cancelled derive from lifecycle.

## Interaction contract

- Search belongs in the app frame and uses the `q` query parameter so results are linkable and
  survive browser history. The API searches title and notes; the page has no second client index.
- Task selection has one canonical URL representation. `view` excludes `list` and `project`; a
  `project` implies its `list`; a List excludes `view` and `project`; Inbox is `/tasks` without its
  generated ID. Search is preserved while selection normalizes.
- A valid Project is authoritative: a missing or mismatched `list` parameter rewrites to the
  Project's actual List. Invalid, archived, or terminal selections return to canonical Inbox.
  Archived Lists and terminal/archived Projects are not ordinary navigation or capture
  destinations.
- The Task editor chooses one List (Inbox by default) and an optional active, open Project in that
  List. It edits content, `why`, priority, estimate, tags, deadline, and reserved time. Deadline and
  reserved time are independent controls.
- Task lifecycle is only open, completed, or cancelled. There is no status selector and no Next
  destination. Complete, cancel, reopen, trash, and restore are focused actions outside the content
  form and use current revisions.
- A Task move that would detach its Project requires a server preview and explicit disclosure.
  Project moves likewise require a server preview with the affected Task count. Completing a
  Project or archiving a non-empty List presents the exact API conflict resolutions; the page does
  not invent cascade behavior.
- The protected Inbox cannot be renamed or archived. List and Project names surface normalized
  duplicate/reserved-name failures without hiding the form.
- Reminders remains reachable from Tasks as a related compatibility surface. It is not a Task View,
  List, or Project, and it is not promoted to a second copy in Today navigation.
- The app-frame primary action creates the current material directly: **New task** on Tasks and
  **New reminder** on Reminders.
- Creating, editing, moving, completing, cancelling, reopening, trashing, restoring, or changing a
  Task container invalidates Tasks, Today, Calendar, Activity, and organization queries together.
  Reminder mutations invalidate the corresponding shared projections.
- The body begins with the queue. It does not repeat the workspace title, search, selection
  description, or create action inside an additional card.

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
| Populated | Compact, directly manipulable rows with lifecycle, organization, and useful timing. |

## Implementation map

| System concept | Current implementation |
| --- | --- |
| shared app-frame search | `components/workspace-search.tsx` |
| shared projection invalidation | `lib/material-queries.ts` |
| Reminder page, navigation, and rows | `features/reminders/page.tsx` |
| Tasks workspace and navigation | `features/tasks/page.tsx` |
| Task content and lifecycle dialog | `features/tasks/task-dialog.tsx` |
| List management | `features/tasks/task-list-dialog.tsx` |
| Project management and conflicts | `features/tasks/task-project-dialog.tsx`, `features/tasks/project-conflict-dialog.tsx` |
| app-frame composition and Today integration | `app.tsx` |

## Verification

1. Open `/tasks`; confirm Inbox is selected without a generated URL parameter and Views, Lists, and
   Projects are distinct groups.
2. Select Today, a standard List, and a Project. Confirm the canonical `view`, `list`, and
   `list+project` URLs survive refresh and preserve `q`.
3. Create a Task with a List, optional Project, `why`, deadline, and reserved time. Confirm there is
   no Next/status selector and each timing field survives independently.
4. Move a Project Task to another List and confirm the detachment preview appears before commit.
   Move a Project and confirm the preview count and revision-bound commit.
5. Exercise Project completion and List archive conflicts; confirm only the server-provided
   resolutions appear and cancellation makes no write.
6. Complete, cancel, reopen, trash, and restore a Task; confirm Tasks, Today, and Activity refresh.
7. Search Tasks and Reminders by title or note; verify a no-match search differs from an empty
   selection.
8. Inspect desktop and 320 px layouts. Confirm search, direct creation, contextual navigation,
   conflict choices, and row actions remain reachable by keyboard.
