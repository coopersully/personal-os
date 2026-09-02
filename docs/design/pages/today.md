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

All-day markers (compact strip)
└── Concise calendar-colored context for events marking the whole day

Today schedule (ordered list)
├── Every in-progress and upcoming timed event remaining today
├── Absolute start times with relative countdowns for future events
└── Direct event actions and in-progress meeting controls

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
| `all-day markers` | A compact, unlabelled shadcn `ItemGroup` above the timed schedule for occasions that shape the day or span several days. Keep an accessible section label, but do not add visible category chrome. Use the distinct `OccasionCard`, composed from `Item`, not `EventCard`. Multi-day occasions show inclusive start and end dates joined by a quiet duration rail; same-day occasions collapse that metadata to one date plus “All day.” Source calendar color identifies the occasion without making it look like an appointment. Use normal sentence case and never show redundant midnight times. | Omit the strip. |
| `schedule` | “Your timeline” is one minimal vertical timeline of every in-progress and upcoming timed event remaining today. Its description summarizes total visible events and those left to start; append the ongoing count only when nonzero. It begins at the most recent 15-minute mark, labels each full hour at its true position, marks unlabeled quarter hours with smaller dots, carries Calendar's connected live now badge and rule, and ends with the last event. Continue Calendar's solid hour and dotted subhour rules across the event track. Snap each event's visual bounds outward to the 15-minute grid and size its block by that duration. Content disclosure follows available height: a 15-minute block shows its title, a 30-minute block adds its exact time, and longer blocks may add location. Keep the time-axis gutter narrow and omit the redundant time column and accent rail inside spatial event cards. Place events by time and use compact columns for overlaps without reproducing Calendar's full grid. Each preview follows Calendar's title → exact time range → location hierarchy and pairs future titles with a small inline relative countdown without parentheses. The whole event surface opens a quick-action menu; its first action navigates to Calendar's week view and opens the native event inspector, followed only by contextually valid directions, meeting, or source-link actions. Never underline its title. | “The day is open.” Do not invent a next event. |
| `queue` | “To take care of” is one quiet, bounded vertical `ItemGroup`, never separate category sections. Its description reports things left and appends the overdue count only when nonzero; planning-window capacity does not belong in this heading. Order overdue tasks first, then overdue reminders, today reminders, undated reminders, due tasks, and next tasks. Place single-select All, Overdue, Tasks, and Reminders filters above a height-bounded `ScrollArea`; paginate the filtered result with the shared `Pagination` below it. Today keeps task titles and timing but suppresses verbose descriptions and tags. A row with title only collapses to one vertically centered line; timing or useful metadata expands it. Overdue tasks use the semantic danger surface as a restrained row highlight. | “Nothing in this view” when a filter has no matches; “Nothing pulling at you” only when the complete queue is empty. |
| `history` | A labelled collapsible for completed reminders and tasks. Count remains visible when closed. | Omit when there is no completion history. |

## Content budget

- Keep one ordered timed-event list; never duplicate an event between schedule states.
- The default queue may show all currently actionable material; it must not show
  completed or cancelled material.
- Each queue row shows one title, one most-useful time/plan fact, one state or
  priority treatment, completion, and a secondary destructive action. Tasks and
  reminders share the commitment-item structure but use distinct neutral
  surfaces; next and high-priority states use a subtle surface treatment rather
  than labels. Destructive actions float at the lower edge on hover or focus so
  they do not constrain the title. Nearby dates use Today, Tomorrow, and
  Yesterday; other dates use concise relative-day copy. Details open from the
  material title rather than expanding every row inline.
- A provider badge, source note, or recommendation is shown only when it changes
  interpretation or action. It never displaces the title or current time.
- Weather is orientation, not the page’s primary content. It belongs in the app
  frame and opens detail on demand. Its trigger combines condition icon and
  temperature; the separate location trigger opens an in-app map preview with
  the map preview itself as the explicit external-map action. The location
  preview uses the weather popover's compact tonal hierarchy: source and place
  first, coordinates as quiet metadata, then a bounded map without duplicate
  headings or bordered sections.

## State matrix

| Situation | Visible treatment | Hidden until requested |
| --- | --- | --- |
| Event in progress | Keep it in its timeline position with the same exact-range preview as other events | Join, directions, source link, event notes, source revision, audit history |
| No fixed event | The schedule says “Nothing scheduled today” and shows a content-sized, stable daily `QuoteCard` using the system empty-state treatment: transparent with a quiet dashed border. The schedule column still fills the available height, and attribution appears only when supplied | Full calendar controls |
| Overcommitted planning window | Queue summary says the consequence plainly; no red dashboard treatment | Scheduling alternatives and plan details |
| No open capacity | Queue summary reports no time before planning-window end | Calendar calculations |
| Location/weather unavailable | Compact status row only while unresolved or unavailable | Setup mechanics; Account settings is linked only when saved location is needed |
| Provider material is stale/failing | Affected item shows source/freshness and an actionable reconnect/retry state | Raw provider payload |
| Completed material | Count is visible; content is in Done today, closed by default | Full completed list |

## Responsive contract

- **Desktop:** moment and day flow occupy the primary column; decision queue is
  a stable secondary rail, distinguished through spacing and hierarchy rather
  than a structural divider or second page-sized card.
- **Narrow/mobile:** use one sequence: moment → day flow → decision queue →
  history. Do not move urgent material behind horizontal scrolling or a tab.
- The app frame keeps capture available. Conditions may compress to icon buttons
  with accessible labels and popovers; narrow navigation is the shell-owned
  bottom workspace dock and contextual Actions sheet.

## Interaction contract

- Today has no desktop sidebar. Its app bar owns the workspace switcher and
  account menu; the narrow workspace dock owns the equivalent mobile access.
  Goals, Motives, Reviews, and Activity live in Settings. Reminders remains a
  Tasks destination rather than a separate workspace.
- Today uses the current condition glyph inside the same framed identity shape
  as every workspace in desktop and mobile switchers. The frame remains neutral;
  clear day, clear night, rain, and cloud/unavailable states change only the
  glyph, never Today into a colored workspace identity.
- Opening a timed event first presents its quick-action menu. “View Event in
  Calendar” routes to the event’s week and opens the established Calendar
  inspector; all-day occasions, tasks, and reminders retain their established
  inspector/dialog behavior.
- An open task with time reserved today appears in the Today timeline using a
  neutral task treatment and opens the task editor. Its queue row may retain the
  reserved time, but does not repeat a Scheduled or Time reserved label.
- Your timeline and To take care of use the same title and description hierarchy and
  align at the top of equal-height desktop columns. Weather fallback and
  all-day context belong below the Today heading so optional states never shift
  only one column's title. The empty-calendar quote is stable for the local day;
  fully completed days may use completion-specific lines, while days with
  remaining commitments use open-calendar lines.
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
| `all-day markers` | `TodayPage` + `.today-all-day-strip` + shared `OccasionCard` |
| `schedule` | `TodayPage` + `.today-schedule` + shared compound `EventCard` |
| `queue` | `TodayPage` + `.today-queue` and the unified commitment list |
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
