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
├── Remaining and overdue counts
├── Overdue material and tasks due or reserved today
├── Today and undated reminders
└── Completion controls on each row
```

## Block contracts

| Block | Content and rules | Empty state |
| --- | --- | --- |
| `all-day markers` | A compact, unlabelled shadcn `ItemGroup` above the timed schedule for occasions that shape the day or span several days. Keep an accessible section label, but do not add visible category chrome. Use the distinct `OccasionCard`, composed from `Item`, not `EventCard`. Multi-day occasions show inclusive start and end dates joined by a quiet duration rail; same-day occasions collapse that metadata to one date plus “All day.” Source calendar color identifies the occasion without making it look like an appointment. Use normal sentence case and never show redundant midnight times. | Omit the strip. |
| `schedule` | “schedule” is one minimal vertical timeline of every in-progress and upcoming timed event remaining today. Its description summarizes total visible events and those left to start; append the ongoing count only when nonzero. It begins at the most recent 15-minute mark, labels each full hour at its true position, marks unlabeled quarter hours with smaller dots, carries Calendar's connected live now badge and rule, and ends with the last event. Continue Calendar's solid hour and dotted subhour rules across the event track. Snap each event's visual bounds outward to the 15-minute grid and size its block by that duration. Content disclosure follows available height: a 15-minute block shows its title, a 30-minute block adds its exact time, and longer blocks may add location. Keep the time-axis gutter narrow and omit the redundant time column and accent rail inside spatial event cards. Place events by time and use compact columns for overlaps without reproducing Calendar's full grid. Each preview follows Calendar's title → exact time range → location hierarchy and pairs future titles with a small inline relative countdown without parentheses. The whole event surface opens a quick-action menu; its first action navigates to Calendar's week view and opens the native event inspector, followed only by contextually valid directions, meeting, or source-link actions. Never underline its title. | “nothing else scheduled today.” Do not invent a next event. |
| `queue` | “up next” is one quiet, bounded vertical `ItemGroup`, never separate category sections. Its description reports things left and appends the overdue count only when nonzero; planning-window capacity does not belong in this heading. Order overdue tasks first, then overdue reminders, today reminders, undated reminders, and tasks due or reserved today. Task relevance uses the canonical open lifecycle and excludes trashed tasks; recommendations never pull unrelated future or undated tasks into Today. Place single-select All, Overdue, Tasks, and Reminders filters above a height-bounded `ScrollArea`; paginate the filtered result with the shared `Pagination` below it. Today keeps task titles and timing but suppresses verbose descriptions and tags. A row with title only collapses to one vertically centered line; timing or useful metadata expands it. Overdue tasks use the semantic danger surface as a restrained row highlight. | “Nothing in this view” when a filter has no matches; “Nothing pulling at you” only when the complete queue is empty. |

## Content budget

- Keep one ordered timed-event list; never duplicate an event between schedule states.
- The default queue may show all currently actionable material; it must not show
  completed, cancelled, or trashed material. Tasks must be overdue, due today, or reserved today in the person’s planning timezone.
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
| Completed material | Removed from Today immediately after confirmed completion | History in the owning workspace |

## Responsive contract

- **Desktop:** moment and day flow occupy the primary column; decision queue is
  a stable secondary rail, distinguished through spacing and hierarchy rather
  than a structural divider or second page-sized card.
- **Narrow/mobile:** use one sequence: moment → day flow → decision queue →
  the bottom app bar. Do not move urgent material behind horizontal scrolling or a tab.
- All-day occasion content must shrink within its card at narrow widths. Long
  titles truncate visually while the full title remains in the accessible name
  and event details; they must never expand the layout viewport or displace the
  workspace dock’s hit targets.
- The app frame keeps capture available. Conditions may compress to icon buttons
  with accessible labels and popovers; narrow navigation is the shell-owned
  bottom workspace dock and contextual Actions sheet.

## Interaction contract

- Today has no desktop sidebar. Its app bar owns the workspace switcher and
  account menu; the narrow workspace dock owns the equivalent mobile access.
  Goals, Motives, and Activity live in Settings. Reviews opens from a workspace attention alert
  or that workspace’s Settings header action; Today has no separate review-queue link. Reminders
  remains a Tasks destination rather than a separate workspace.
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
- schedule and up next use the same title and description hierarchy and
  align at the top of equal-height desktop columns. Weather fallback and
  all-day context belong below the Today heading so optional states never shift
  only one column's title. Empty schedules explicitly say nothing else is scheduled,
  with a calendar icon and a quiet dashed empty-state surface.
- The schedule is a standard `Collapsible`, expanded on desktop and collapsed by
  default on mobile. The closed preview shows the current or next timed item and
  its start time (or “now”), plus the number of all-day events. An explicit user
  choice persists while the page is mounted, including through resizing.
- Completing a row removes it from the queue. Today does not fetch or render a
  completed-history section; history remains in the owning workspace.
- Mobile uses one compact top row: workspace switcher, “today,” weather, and actions.
- No route-level data is silently rearranged by an agent. Any planning proposal
  presents the candidate set and consequence before a user accepts it.

## Implementation map

| System concept | Current implementation |
| --- | --- |
| `all-day markers` | `TodayPage` + `.today-all-day-strip` + shared `OccasionCard` |
| `schedule` | `TodayPage` + `.today-schedule` + shared compound `EventCard` |
| `queue` | `TodayPage` + `.today-queue` and the unified commitment list |
| orientation | `TodayNavigationTitle` and `TodayWeatherTopbar` |

## Verification

1. Render no-event, active-event, later-event, task-only, overcommitted, and
   completed-material states.
2. Verify no event is rendered both in Moment and Day flow.
3. Verify the schedule defaults closed on mobile, shows the next item/time, and
   expands accessibly. Completed material must not appear in Today.
4. Inspect desktop and narrow visual layouts with live data. Confirm the visual
   scan still reads Moment → Day flow → Decision queue.
5. Confirm each event, task, and reminder retains the existing direct action
   and accessible name.

## Feedback contract

Follow [feedback and validation](../feedback.md). Keep the cached plan visible when a background refresh fails, with a contextual stale status
and Retry. An initial failure replaces only the unavailable region. Task and
reminder actions use shared mutation feedback; irreversible deletion requires a
named confirmation. Forms preserve values and show corrections at their inputs.

## Device location lifetime

The authenticated shell requests browser geolocation only on its first Today visit.
It retains the result, denial, or unavailability in memory for that shell's lifetime;
workspace revisits do not request permission again. A pending request may finish
while another workspace is open. Sign-out or a full reload resets the attempt;
coordinates are never persisted by this hook. Weather data continues its existing
refresh cadence using that snapshot or the saved home location. This is a session
location snapshot, not continuous movement tracking. The browser request remains
bounded by its existing ten-second timeout and five-minute cached-position allowance.

## Section surfaces

Schedule and up next use the same small, muted section labels as Settings.
Schedule has one summary Card; the task/reminder queue is an open list of native item surfaces. Schedule’s collapse control
stays beside its label; its mobile default remains the next-event preview.

Today uses a 16px gap between its sections without extra queue indentation. The
schedule empty state sits directly in its card, without a nested dashed surface.
The commitment section uses a Settings-sized sentence: “tasks and reminders for
today.” Its type and date phrases select both types, tasks, or reminders and today,
this week, this month, or an inclusive custom range using the shared Finance date
picker. Presets retain overdue commitments; custom ranges match due or scheduled
dates exactly in the planning timezone. Undated reminders are available in Tasks,
not the date-scoped Today queue. Week boundaries follow Calendar preferences.
Broader scopes read all pages of open native records, retain direct actions, and
show loading or recovery rather than presenting an incomplete read as empty.

### Compact sections

Schedule and the editable tasks/reminders sentence use the Settings section-label
scale, natural word spaces and no inline chevrons. The queue is an open ItemGroup
with individual task/reminder surfaces, never a containing Card. Schedule retains
its single Card; successful absence uses the shared centered-icon Empty inside it.
Weather location remains a separate reachable map control on mobile.
