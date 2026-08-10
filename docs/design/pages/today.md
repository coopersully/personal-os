# Today — reference page specification

## User job

**Help me orient to this day, protect the commitment that matters now, and make
the next small set of decisions without having to reconstruct my plan.**

Today is not a dashboard and does not compete with Calendar, Tasks, Mail, or
Finances. It is an ordered operating surface that links to those domains when a
deeper decision is needed.

## Information hierarchy

```text
Orientation (app frame)
└── Local date · planning timezone · compact live conditions · capture

Moment (primary block)
├── What is happening now, otherwise the next fixed commitment
├── Time status and a direct material action
└── The next transition when something is already in progress

Day flow (sequence)
├── All-day context, when present
└── The remaining fixed calendar sequence

Decision queue (quiet rail)
├── Capacity summary in the person’s planning window
├── Overdue and due material
├── Flexible commitments that are ready next
└── Completion controls on each row

History (collapsed)
└── Done today, with the count visible before opening
```

## Block contracts

| Block | Content and rules | Empty state |
| --- | --- | --- |
| `moment` | Exactly one raised card. Its title is **Happening now** when an event is in progress, otherwise **Next commitment**. It shows a direct event action, its time state, and a join action only when the provider supplied a conference URL. | “The day is open” with one optional capture path. Do not invent a next event. |
| `sequence` | A visibly ordered stream of all-day and later timed events. The next event is not duplicated. Provider/source identity stays a compact badge. | “Nothing else is fixed on the calendar.” |
| `queue` | A quiet, bounded action list ordered: overdue → today → no due date → overdue tasks → due tasks → next tasks. Capacity is an inline summary, not a metric tile. | “Nothing pulling at you” only when no actionable material exists. |
| `history` | A labelled collapsible for completed reminders and tasks. Count remains visible when closed. | Omit when there is no completion history. |

## Content budget

- One `moment` card only.
- The default queue may show all currently actionable material; it must not show
  completed or cancelled material.
- Each queue row shows one title, one most-useful time/plan fact, one state or
  priority marker, completion, and a secondary destructive action. Details open
  from the material title rather than expanding every row inline.
- A provider badge, source note, or recommendation is shown only when it changes
  interpretation or action. It never displaces the title or current time.
- Weather is orientation, not the page’s primary content. It belongs in the app
  frame and opens detail on demand. Its trigger combines condition icon and
  temperature; the separate location trigger opens an in-app map preview with
  the map preview itself as the explicit external-map action.

## State matrix

| Situation | Visible treatment | Hidden until requested |
| --- | --- | --- |
| Event in progress | Moment says “Happening now,” duration state, direct provider join when available | Event notes, source revision, audit history |
| No fixed event | Moment says “The day is open” and offers calm capture copy | Full calendar controls |
| Overcommitted planning window | Queue summary says the consequence plainly; no red dashboard treatment | Scheduling alternatives and plan details |
| No open capacity | Queue summary reports no time before planning-window end | Calendar calculations |
| Location/weather unavailable | Compact status row only while unresolved or unavailable | Setup mechanics; Profile is linked only when saved location is needed |
| Provider material is stale/failing | Affected item shows source/freshness and an actionable reconnect/retry state | Raw provider payload |
| Completed material | Count is visible; content is in Done today, closed by default | Full completed list |

## Responsive contract

- **Desktop:** moment and day flow occupy the primary column; decision queue is
  a stable secondary rail. The queue has an independent visual boundary, not a
  second page-sized card.
- **Narrow/mobile:** use one sequence: moment → day flow → decision queue →
  history. Do not move urgent material behind horizontal scrolling or a tab.
- The app frame keeps capture available. Conditions may compress to icon buttons
  with accessible labels and popovers; narrow navigation is the shell-owned
  bottom workspace dock and contextual Actions sheet.

## Interaction contract

- The Today sidebar keeps Today, Goals, and Motives available. Calendar, Tasks,
  Mail, and Finances are workspace destinations owned by the workspace switcher
  and the shell's narrow workspace dock; do not duplicate them in this sidebar.
  Reminders remains a Tasks destination rather than a separate workspace.
- Opening an event, task, or reminder preserves the user’s place and opens the
  established inspector/dialog.
- Completing a row updates the queue and moves the item into Done today without
  losing a direct reopen path.
- Done today is a standard `Collapsible`, initially closed. Its trigger exposes
  a label, count, expanded state, and icon rotation only as supplemental
  feedback.
- No route-level data is silently rearranged by an agent. Any planning proposal
  presents the candidate set and consequence before a user accepts it.

## Implementation map

| System concept | Current implementation |
| --- | --- |
| `moment` | `TodayPage` + `.today-moment-block` + shared compound `EventCard` |
| `sequence` | `TodayPage` + `.today-sequence` + shared compound `EventCard` |
| `queue` | `TodayPage` + `.today-queue` and the reminder/task groups |
| `history` | `TodayPage` + `.today-history` using shadcn `Collapsible` |
| orientation | `TodayNavigationTitle` and `TodayWeatherTopbar` |

## Verification

1. Render no-event, active-event, later-event, task-only, overcommitted, and
   completed-material states.
2. Verify no event is rendered both in Moment and Day flow.
3. Verify Done today is closed initially, announces its count, and reveals
   completed material when opened.
4. Inspect desktop and narrow visual layouts with live data. Confirm the visual
   scan still reads Moment → Day flow → Decision queue.
5. Confirm each event, task, and reminder retains the existing direct action
   and accessible name.
