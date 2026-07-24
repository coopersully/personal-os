# Personal OS experience standards

## Purpose

Personal OS should feel like one shared work surface for a person and their
agents. Pages may expose different material, but they should not invent a new
information hierarchy or a new location for common actions each time.

## Page anatomy

Every primary page follows the same order:

1. **Sidebar navigation** identifies the product and moves between its major
   objects. Global account and settings access belong here.
2. **Top navigation** owns the one route title and compact route controls. It has
   stable leading, context, and trailing slots: leading holds the title and mobile
   navigation trigger; context holds view controls, filters, and compact status;
   trailing holds route-specific actions such as **New event** or **Sync mail**.
   It uses the same inset, height, gaps, and control geometry on every route.
   The title and route-global controls never repeat in the page body, and focused
   workspaces do not use a generic **Add** action.
3. **Primary canvas** gives the page's material most of the available space.
   Empty, loading, offline, and error states occupy the same region.
4. **Inspector** opens beside the canvas for reading an existing object and
   taking common actions without losing context.
5. **Modal editor** is reserved for creation or precise editing. Destructive
   actions require an explicit confirmation inside the inspector or editor.

On narrow screens the inspector becomes a bottom sheet and the toolbar wraps
without changing its information order. Primary controls need visible labels;
icon-only controls need accessible names and tooltips where their meaning is not
universal.

## Interaction rules

- The visible object and the agent-accessible object are the same domain record.
- Display provider, calendar, time zone, writeability, and synchronization state
  at the point where they affect a decision, not as permanent chrome.
- Optimistic direct manipulation must preserve a snapshot, show pending state,
  and roll back with an inline explanation if persistence fails.
- Keyboard and form-based editing remain available when drag, drop, or touch
  gestures are offered.
- Use the user's selected time zone for display and input conversion. Never
  silently reinterpret a wall-clock time in the device time zone.
- Rich text is rendered from Markdown and a small sanitized HTML subset. Raw
  scripts, event handlers, and unsafe URLs are never rendered.
- Provider-owned records are only shown as changed after the remote write
  succeeds. Local projections do not impersonate successful synchronization.
- Read-only calendars expose detail and source identity while disabling mutation
  affordances.

## Calendar standard

Calendar top navigation contains **New event** in its trailing slot and the
compact calendar controls in its context slot. The context controls own
previous/today/next navigation, day/week/month selection, date picking, weekend
visibility, calendar visibility, and the active time zone. The canvas owns
events, the current-time indicator, selection, and direct manipulation.

Calendar visibility is a persisted product preference, not a temporary CSS
filter. Event color comes from its source calendar. Selecting an event opens the
inspector; editing is a separate intentional action. Dragging a writable event
reschedules it on a 15-minute grid while preserving its duration. Month moves
preserve the event's local start time or all-day span.

Connected event creation, update, movement, and deletion write through to the
provider before the synchronized local projection is committed. The inspector
states whether an event is local or remotely synchronized so the user can
predict the consequence of an action.

Calendar blocking is a relationship, not a duplicate event in the unified
canvas. A source event may reserve the same interval on one or more writable
destination calendars. Each destination chooses **Busy only** (title, notes,
and location stay private) or **Include details**. When the source calendar is
visible, the canvas shows the source once with a lock indicator and suppresses
its generated blocks. When the source is hidden, each selected destination may
show its block. Source edits, moves, deletion, and restoration reconcile the
linked provider records as one material action.

## Mail standard

Mail is a read-only synchronized surface in the first release. Top navigation
owns search, unread filtering, and explicit sync. The left rail places a
**Unified inbox** group before provider-account **Mailboxes**. The center column
selects a conversation, and the reader preserves subject, sender, recipients,
time, and plain-text body without exposing mutation controls.

Account identity remains visible whenever mailboxes from multiple providers are
combined. An empty, loading, stale, or failed provider state stays localized and
actionable. Message bodies are treated as private material: the UI renders text,
never remote scripts, and agent tools separate list/search summaries from full
conversation reads.

## Finance ledger standard

Transactions use a sortable data table: one transaction is one row, with the
date, merchant, category, amount, and a visible details control in the summary.
Rows remain compact and single-line; long merchant text truncates rather than
wrapping into an ambiguous second line. The details control expands a companion
row with direction, confidence, source, raw descriptor, notes, and any review
action. The table may scroll horizontally on narrow screens rather than hiding
financial context.

The ledger uses one typed, opaque-cursor pagination contract end to end. The
default is date descending; date, merchant, and amount sorting happens on the
server and changing sort resets pagination. The UI retains cursor history only
for Previous navigation, never re-sorts a partial client-side result. Expense
amounts are red with a minus sign, income amounts are green with a plus sign,
and transfers are neutral; the signs and labels preserve meaning without color.

Merchant cells show a check when the transaction is linked to a canonical
merchant entity and a question mark when no entity is available. The raw provider
descriptor can appear as secondary context, but the primary label is the
canonical display name. Provider enum codes (for example `TRANSFER_OUT`) never
appear as customer-facing labels; they are translated to a plain-language
category such as **Transfers**.

Transaction dates use the viewer's locale (for example, `Jul 13, 2026`), rather
than an ISO storage string. Confidence is persisted as basis points and exposed
to the client as a number from 0 to 1; UI displays it as a percentage from 0% to
100%. New confidence behavior, entity-match semantics, and review decisions
must be recorded in this standard or an adjacent product decision before relying
on them in the experience.

## Finance wealth and budget standard

Wealth reports keep cash, investments, debt, and other assets separate. Net worth is
assets minus debt. It shows the effective stated annual income and observed trailing
twelve-month income separately, explicitly excluding transfers from observed income; the
planning baseline prefers stated income when available and names that basis. A budget setup
shows monthly income, already planned limits, and remaining capacity when income is
available; otherwise it says that income cannot yet be inferred. Agents use the same wealth
summary through MCP.

Budget spending excludes transfers. Moves between a linked account and its vaults, provider
transactions explicitly classified as transfers, and matched cash-to-credit-card payments are
account movement—not new purchases. A cross-account match must have compatible payment
descriptors, equal amounts, nearby dates, and a debt account; amount alone is never enough.
When the system cannot establish that evidence, it leaves the transaction visible for review
rather than silently excluding it. A user-confirmed merchant rule can deliberately override a
provider transfer label (for example, a rent payment sent through Zelle).

## Finance information architecture and progressive disclosure standard

The finance sidebar exposes the recurring jobs: **Overview**, **Transactions**,
**Budgets**, **Cash flow**, **Review**, **Accounts**, **Imports**, **Profile**, and
**Subscriptions**. Account connections and manual account tracking live in **Accounts**;
sync and import history live in **Imports**; categorization decisions live in **Review**.
Each workspace owns the relevant secondary actions instead of putting all finance setup on
the overview page.

Overview answers "where am I now?" and makes scope explicit. Spend this month, cash,
and investments can each open a labeled account-selection dialog. The dialog gives the
per-account amount used in that calculation, supports checkboxes, and preserves the
choice for the browser session. A metric that opens configuration is a named button,
not an unlabeled clickable card.

Budgets answer "am I on plan?" before asking for setup. The default view shows planned,
spent, and remaining/over-plan totals, then one compact category row with its limit,
spend, remaining amount, and progress. Creation and edits open a modal editor so the
default page remains a readable plan. Empty states offer the single next step; loading
states reserve the same shape with skeletons; failures stay local to the affected
surface with a recovery action.

Finance layouts are mobile-first. Cards and toolbars may wrap; monetary values and
actions do not collide or clip; dense tables use intentional horizontal scrolling rather
than ambiguous wrapped rows. Every finance route must be checked at narrow and desktop
widths with populated, empty, loading, and error data before release.

## Financial workspaces and data-display standard

The page header owns the page title, a one-line description, an optional end-aligned
status slot, and the page-level actions. Do not repeat that title or description inside a
content card. A workspace's primary content lives on the page canvas; cards are reserved
for discrete metrics, controls, or grouped decisions. On compact screens, header status
and actions stack beneath the title rather than competing for the same row.

Month-based finance workspaces place previous/next month controls and the create/edit
action in that header. They request data for the selected month, not merely a different
label for current data. Months with no plan, future months, and failed loads all name the
month and explain the next useful action.

Transaction-level data defaults to a table, including inside dialogs. Tables preserve
date, merchant, category, and amount as separate columns and use intentional horizontal
scrolling on narrow screens. Large detail sections are collapsible, with a visible item
count, so a review can start from the summary and reveal dense evidence only when needed.
Scrollable dialog bodies use the shared `app-scrollbar` treatment with a fixed header;
do not put a browser-default scrollbar against the dialog edge.

Budget metric cards use the shared metric pattern: label and value, an optional
end-aligned comparison/status slot, and an optional button behavior when evidence is
available. Planned allocation opens a chart and a tabular breakdown; spent and over-plan
metrics open the transactions that produce them. Finance export is always available from
the budget workspace and exposes raw accounts, transactions, and plan data as separate
CSV downloads so a user can audit categorization and amounts outside the app.

Budget pace uses a complete contribution-style calendar grid. Every displayed date has a
rounded square: no activity, future dates, missing data, and unbudgeted time use the same
muted blank state; only actual ahead/behind budget pace changes color, using restrained
success and destructive tones. The summary describes the latest evaluated day rather than
implying that future cells were calculated.

## Provider-fidelity roadmap

### Next: trustworthy coordination

- Extend the normalized event model with attendee and organizer state,
  `free`/`busy` transparency, provider visibility, conferencing, attachments,
  provider links, iCalendar UID, and explicit event type.
- Add event moves between writable calendars with a deliberate invitation-update
  policy and conflict handling based on provider revisions.
- Add pointer/touch movement, resize handles, and keyboard move/resize commands
  with the same 15-minute snapping and rollback guarantees.

### Then: scheduling context

- Add location suggestions, map links, and optional travel-time buffers.
- Attach documents and meeting notes to an event; turn checked action items into
  reminders without copying the event into a second source of truth.
- Expose multi-calendar availability, scheduling proposals, and shareable booking
  windows without revealing private event details.
- Add focus and out-of-office event types, saved calendar sets, command-menu
  shortcuts, and calendar search.

## Research basis

These standards adapt proven behaviors without copying any single product:

- [Notion Calendar event management](https://www.notion.com/help/manage-your-calendars-and-events)
  uses a contextual event panel, direct creation, multiple calendars, and event
  types.
- [Notion Calendar blocking](https://www.notion.com/help/blocking) mirrors busy
  time while protecting private source details.
- [Google Calendar event resources](https://developers.google.com/workspace/calendar/api/v3/reference/events)
  expose the provider fields required for faithful synchronization, including
  attendees, transparency, visibility, attachments, conferencing, revisions,
  and stable identifiers.
- [Apple Calendar location and travel time](https://support.apple.com/en-lamr/guide/calendar/icl43600/mac)
  demonstrates how place context can improve time planning.
- [Fantastical proposals](https://flexibits.com/fantastical/help/proposals)
  demonstrate lightweight meeting negotiation without requiring every attendee
  to use the same client.
- [Amie pages](https://amie.so/documentation/features/pages) connect meeting
  notes and action items to the event rather than scattering them across the UI.
- [FullCalendar accessibility guidance](https://fullcalendar.io/docs/accessibility)
  treats keyboard interaction and semantic event controls as core calendar
  behavior.

## Definition of done for calendar changes

A calendar change is complete when local and connected behavior agree, read-only
sources remain protected, failure rolls back visibly, keyboard editing still
works, narrow and desktop layouts remain usable, time-zone boundaries are
covered, and tests exercise both provider success and provider failure.
