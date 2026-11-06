# Today — reference page specification

## User job

**Help me orient to this day, protect the commitment that matters now, and make
the next small set of decisions without having to reconstruct my plan.**

Today is not a dashboard and does not compete with Calendar, Tasks, Mail, or
Finances. It is an ordered operating surface that links to those domains when a
deeper decision is needed.

## Expo mobile briefing (accepted November 5, 2026)

The mobile homepage is a short briefing for an always-on monitoring assistant: **needs you →
coming up → handled for you**. Each summary contains a concrete title and one useful context line;
one tap opens evidence, source, authority and the next available action. Completed work is visible
in the briefing, not hidden behind a generic activity count. Colors and reicon glyphs identify the
owning workspace; amber attention and green completion have separate semantic meanings.

Keep the wordmark and profile image compact (18-point wordmark, 28-point avatar within a 44-point
target). The iOS workspace bar uses Expo Router's system native tabs so Liquid Glass, safe areas
and OS accessibility treatments remain system-owned. Cooper explicitly requested icons only;
hide visual labels while retaining accessible tab names. This is a deliberate deviation from
Apple's recommendation to include visible tab labels, not a claim that icon-only tabs satisfy
every HIG recommendation. Preserve stable destinations and selected icon variants. Web keeps
visible labels and shares the same screens and record presentation.

The first TestFlight UI increment is an explicitly labeled **sample day**, with normal, quiet and
interrupted-monitoring scenarios in preview settings. It performs no provider reads, monitoring,
sign-in or mutations. A generic profile glyph represents the unsigned-in preview; a real profile
photo must come from the future authenticated account. Sample check times never claim live health.
Future live briefings must be backed by domain-owned evidence and must distinguish last check
from source freshness, proposals from completed effects, and missing coverage from an all-clear.

This mobile direction supersedes the schedule-first mobile sequence below for the Expo client.
The existing web implementation is unchanged by this preview. Live aggregation, authentication,
notifications and monitoring delivery remain separate acceptance work.

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

The top bar contains orientation and weather context, without a generic Add action.
Weather and location use separate matching secondary pills. The schedule toggle
is plain text with a transparent resting and expanded background.


Today uses Tasks' `WorkspaceRow` for task and reminder records, including metadata,
completion alignment, inspectors and options. Both center the checkbox on the first
title line instead of the complete title/metadata block. The collapsed Schedule keeps
all-day event cards and one timed event in the same shared Calendar grid/event styling.

The shared Calendar grid on Today inherits the schedule card surface; retain the
same time rules and event treatment without painting a body-colored rectangle.

### Workspace search header prototype (November 5, 2026)

The next Expo iteration replaces the small wordmark row with a shared full-width search field.
Its leading control is the current workspace icon, optically centered in the leading curve without a chevron, replacing the
magnifying glass. It opens a downward vertical picker ordered today, tasks, mail, finances,
calendar. Tap keeps it open for selection; hold then slide and release chooses the highlighted
workspace, while release outside cancels. Selection requests a haptic on a changed workspace.
Labels and selected state accompany workspace colors/icons. The trailing account control opens
settings. The header remains fixed above scrolling content, and every control has a 44-point or
larger touch target. Native Liquid Glass belongs to the picker, with readable fallback surfaces.

This is a local Fast Refresh prototype, not a new TestFlight release or completed live search.
Search uses explicitly labeled sample results. The later contextual-navigation decision below replaces the original global bottom tabs. Physical gesture/haptic and accessibility acceptance remain
separate from the native rendering and tap-navigation checks.


### Contextual bottom navigation (accepted November 5, 2026)

The workspace picker owns workspace switching. Bottom navigation now mirrors the existing web
mobile dock: Tasks has today/views/pinned/history; Mail has inbox/mailboxes; Finances has
overview/money/planning/manage; Settings has account/personal/workspaces/app. Today and Calendar
have no bottom dock. Settings remains an account utility outside the workspace picker and opens
from the trailing account control. Nested pages retain their workspace identity and search scope.

The Expo preview provides title-only route shells for these destinations, retaining the existing
Today sample briefing. Domain content and the section pages' child navigation remain later work.


### Spatial navigation motion (November 5, 2026)

Workspace selection moves the whole screen vertically in picker order: today, tasks, mail,
finances, calendar. Moving farther down the list brings the destination up from below; moving
back up brings it down from above. Page selection within a workspace brings content from the
right for later tabs and from the left for earlier tabs; the header and native dock stay fixed.
The selector glyph sits alone in a 50-point square target at the search field's leading curve.
Reduce Motion skips translation, including when enabled during a transition. Detail routes keep
the root navigator's behavior. This remains a local preview, not a TestFlight update.


### Fixed-region motion refinement (November 5, 2026)

This supersedes whole-screen translation: search field, body viewport and dock slot stay mounted
at fixed bounds. Only their inner contents move, clipped to each region. Workspace switches use
18-point search, 24-point body and 20-point dock displacement with opacity, a 70 ms exit and
130 ms eased entry. Page changes use a 24-point horizontal content entry over 160 ms. Reduce Motion
retains immediate navigation. The dock reserves its slot even on workspaces with no dock, so body
bounds do not jump. Its native GlassView material stays stationary while controls change; it is
now a shared custom dock, rather than a separate native tab controller per workspace.


### Account dropdown (November 5, 2026)

The trailing account icon opens a right-aligned glass dropdown instead of immediately navigating.
It displays account identity followed by settings, workspace settings, agent settings, and log out.
Settings links open page shells. The local preview explicitly labels its sample Cooper Sullivan
identity as not signed in and disables log out; authenticated session behavior is not implemented.
Only one header menu is open at a time, with outside-tap and navigation dismissal.

### Shared-axis timing polish (November 5, 2026)

The local Expo preview now uses a 90 ms accelerating departure and a 190 ms decelerating
arrival, replacing the abrupt 70/130 ms pair above. Travel is 10 points inside the search
bar, 20 in the body, and 12 in the dock; their boundaries remain fixed. Opacity stays
higher through most of the travel and fades near the route handoff. Workspace order
still determines vertical direction; page navigation remains horizontal. Reduce Motion
still skips translation. This is a preview tuning choice, not a platform-mandated timing.

References: [Apple Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
and [Material shared axis](https://m2.material.io/design/motion/the-motion-system.html).

### Contextual dock selection (November 5, 2026)

The selected page uses the filled variant of its canonical glyph and the active workspace's
color, shared with the workspace selector (including dark-theme variants). Unselected pages
use neutral outline glyphs. Settings remains neutral because it is an account utility.

### Fast selection and glass restoration (November 5, 2026)

Workspace selection now navigates immediately, then settles vertically over 120 ms,
replacing the staged 280 ms departure/arrival. Holding the selector opens it after
220 ms; entering each different drag candidate produces selection haptics on native
devices, with release selecting that candidate. Fixed boundaries and Reduce Motion remain.
Search, picker/account menus, dock, and floating add controls share native Liquid Glass
on supported iOS devices and a blurred translucent approximation on web (opaque fallback
on unsupported native platforms). Filled, workspace-colored selected icons remain.
Tasks, Mail, and Calendar show a bottom-right glass plus control above the dock area;
it is a disabled layout placeholder and performs no action.

### Gesture reliability repair (November 5, 2026)

Keep the same gesture responder throughout a drag, reading fresh callbacks after render.
The top selector owns its touch stream before the nested button can claim it; dragging
can open the picker directly as well as after holding. The dock captures horizontal drags,
previews the candidate with filled/tinted selection, and navigates on release; taps and
accessibility activation continue to work. Native glass material itself does not implement
these custom navigation gestures. Content no longer fades to zero during navigation: short
axis translations preserve spatial direction without blanking the shell like a loading state.
Verified actual simulator drags from the closed top selector to Finances and across the
Tasks dock from Today to Pinned. This does not prove physical-device haptic quality.

### Restore native iOS navigation and authenticated entry (November 5, 2026)

Cooper explicitly chose Apple's actual tab bar over custom glass imitation. iOS now
uses Expo Router NativeTabs within each workspace, retaining icon-only page destinations,
filled selected glyphs and workspace tint. UIKit owns bar gestures and selection motion;
custom horizontal page animation and the custom dock are disabled on iOS. The shared
workspace picker remains a separate control. Web retains its custom dock.

Signed-in routes require API-validated human sessions. Sign-in uses existing nohmi
accounts, with password recovery, secure native token persistence and revoking logout.
The account menu displays server-returned identity. Session restoration has a bounded
checking state and a retry control; action errors use Sonner, not inline result banners.
Sample Today content remains explicitly sample content after authentication.

### Native workspace menu and tab labels (November 5, 2026)

The iOS workspace picker now uses a system SwiftUI Menu/Picker through Expo UI.
Apple owns its Liquid Glass material, presentation and dismissal, with the current
workspace marked by the native selection checkmark. The trigger retains its colored
canonical glyph. Native tabs now show their page labels beneath the icons using the
system layout, superseding the earlier icon-only choice. Filled selected icons and
workspace tint remain. Web retains its custom menu and dock. Simulator verification
confirmed menu selection and labeled Tasks tabs; physical haptic feel remains unverified.

The native workspace menu includes canonical outline icons for inactive workspaces
and a filled icon in the selected workspace’s color. Light/dark menu artwork is
generated from the same registry and palette as the shell. iOS owns transient menu
tracking highlights; the Expo SwiftUI Menu API does not expose a highlighted-row
callback for changing custom images while dragging. Web preview icons also reflect
its hovered/dragged candidate. The circular trigger uses the active filled glyph.

The search-bar workspace trigger is a plain glyph, without an additional glass circle.
The iOS menu uses native Menu/Button/Label rows rather than Picker rows, avoiding
the leading checkmark gutter. Selected state remains a filled workspace-colored icon
and an accessible current-workspace label. Apple owns menu insets and positioning;
the native source anchor compensates for the menu icon gutter while the visible
trigger keeps its 50-point slot. The iPhone 18 Pro simulator verifies aligned icon
centers. The native menu supports hold-to-open and dragging through open rows to
select on release; it does not expose the native tab bar’s moving glass selection
indicator. Immediate dragging from the closed trigger was not successful in that
simulator check.

### Vertical glass workspace control (November 5, 2026)

Cooper approved replacing the system Menu with a vertical selector built from real
SwiftUI Liquid Glass. The panel and moving selection capsule use Apple's glassEffect
and native animation. App-owned gestures track the candidate, update filled/tinted
glyphs and selection haptics, and commit on release. This is a custom control using
native materials, not a vertically rotated UITabBar or system Menu. Native bottom
tabs stay unchanged. The panel opens below the persistent search bar; its icon column
shares the trigger's center. Tap opens it for a second tap; hold or drag from the
trigger supports immediate selection; releasing outside cancels. Accessibility uses
labelled selected-state buttons over the decorative SwiftUI view. Reduce Motion
disables the indicator's spring. Simulator checks cover direct closed-trigger drag
to Tasks and open-panel drag to Finances. Physical haptic feel remains unverified.
