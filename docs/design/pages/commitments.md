# Tasks and Reminders — reference page specification

## User jobs

**Tasks:** Find the flexible commitment I can act on now, move between planning states, and
complete or refine it without losing its timing or context.

**Reminders:** Find the simple item that needs my attention, complete or reopen it, and keep
finished reminders available without mixing them into current work.

These are related commitment surfaces, not interchangeable records. Tasks retain planning state,
estimate, schedule, due date, and tags. Reminders remain the lighter capture path.

## Information hierarchy

```text
Orientation (app frame)
├── Current workspace and selected view
├── Search across title and notes
└── Direct create action for the current material

Commitments (queue)
└── One directly manipulable row per task or reminder

History (alternate view)
└── Completed material, selected explicitly from contextual navigation
```

## Interaction contract

- Search belongs in the app frame and uses the `q` query parameter so the result is linkable and
  survives browser history. The API searches title and notes; the page does not maintain a second
  client-only search index.
- Tasks expose Inbox, Next, Scheduled, and Completed as contextual destinations. Reminders expose
  Open and Completed.
- Reminders remains reachable from the Tasks contextual sidebar as a related commitment surface;
  it is not duplicated in Today’s sidebar or promoted to a top-level workspace.
- The app-frame primary action creates the current material directly. A person on Tasks gets
  **New task**; a person on Reminders gets **New reminder**.
- Completing, reopening, creating, editing, or removing material invalidates Tasks, Reminders,
  Today, Calendar, Activity, and agenda projections together so no workspace retains stale
  commitment state.
- The body begins with the queue. It does not repeat the workspace title, search, view description,
  or create action inside an additional card.

## State matrix

| Situation | Visible treatment |
| --- | --- |
| Loading | Workspace-preserving skeleton. |
| Unavailable | Inline error with API-provided failure detail. |
| Empty view | View-specific empty guidance. |
| Search has no matches | “No matching tasks/reminders” with guidance to try another title or note. |
| Mutation pending | The affected control is disabled; dialog saves expose pending copy. |
| Mutation failed | The affected row or dialog exposes the failure without hiding the material. |
| Populated | Open queue of directly manipulable material rows. |

## Implementation map

| System concept | Current implementation |
| --- | --- |
| shared app-frame search | `components/workspace-search.tsx` |
| shared projection invalidation | `lib/material-queries.ts` |
| reminder page, navigation, and rows | `features/reminders/page.tsx` |
| task page, navigation, and rows | `features/tasks/page.tsx` |
| modal composition and Today integration | `app.tsx` |

## Verification

1. Search Tasks and Reminders by title or note; verify `q` updates and the typed API query receives
   the term.
2. Verify a no-match search is distinct from a genuinely empty view.
3. Complete and remove a task; confirm the Tasks projection and shared Today/Activity projections
   invalidate.
4. Trigger a reminder mutation failure and confirm the row remains actionable with an inline error.
5. Inspect desktop and 320 px layouts. Confirm search, direct creation, contextual navigation, and
   row actions remain reachable by keyboard.
