# Mobile frontend standards

This is the canonical entry point for nohmi's Expo mobile UI. It consolidates the accepted
interaction decisions from the mobile workspace and Tasks refinement work. It defines the target
contract; code, tests and the implementation log establish what is delivered. The frontend owner
maintains this document and [mobile forms](mobile-forms.md) together with shared components.

## Platform and shared product

Share API/domain contracts, entity vocabulary, account preferences and product behavior with web.
Use native mobile presentation where it improves interaction; parity does not require identical
layout. Follow the design system, feedback rules and account/record authority boundaries.
Use theme tokens, shared atomic primitives and feature compositions instead of page-local copies.

Use Apple's actual native tab bar on supported iOS, including system Liquid Glass, selection,
dragging, labels and animation. Do not recreate it with a blurred custom bar. Native menus and
pickers own their selection marks, sections and dismissal. Use real platform glass rendering for
approved glass controls, with an honest fallback on unsupported platforms/web. The vertical
workspace selector is an explicitly accepted custom interaction using native glass, not a claim
that Apple provides a vertical tab bar. Avoid fake glass shaders or custom tab indicator physics.

## Shell, navigation and motion

Keep shell chrome small and stable. The top search row spans available width; its leading
workspace icon opens the workspace selector and replaces the magnifier. Its trailing account
control opens account identity, Settings, Workspace settings, Agent settings and Log out.

The workspace selector supports tap-to-open/tap-to-select and press/drag/release selection,
with native haptic selection feedback on meaningful changes. Leading menu icons align with the
trigger icon; selection accessories sit at the trailing end. Use the same glyph's outline and
solid states with workspace color for highlighted/selected identities. Unselected glyphs stay
neutral. Prefer system interaction behavior wherever available.

Workspace changes communicate a vertical relationship; pages within a workspace communicate a
horizontal relationship. Animate contents inside stable search/body/tab-bar bounds, not the
entire shell flying away. Keep transitions brief and responsive to rapid selection; interrupt
rather than queue them. Respect Reduce Motion, avoid loading flashes and keep existing content
visible during refresh. System tab-bar animation takes precedence over custom motion.

Workspace-specific tab definitions belong to the navigation registry. Selected icons use the
solid counterpart and workspace color; unselected icons retain outline and neutral color. Keep
standard Apple tab labels where supported. Never replace working native dragging with a mock.

## Components, geometry and identity

Use the 4-point spacing scale, 16-point grouped-surface radius and 44-point minimum touch targets.
Content cards/rows anchor their identity icon or checkbox top-left and their action top-right;
wrapped titles do not vertically center these glyphs. Keep checkbox-to-content spacing compact
without overlapping hit targets. Completed checkbox containers contain a plain checkmark.
Settings rows instead vertically center icon, label, value and accessory.

Use the canonical entity dictionary for association fields and headings. Entity icons appear
before List/Project labels and project/list page titles. Use the canonical reicon registry and
generated native assets; system control rendering is not permission to introduce another icon pack.
Customizable record icons/colors are separate from workspace identity and reflect saved choices.

[Mobile forms](mobile-forms.md) owns identity/title/description composition, example placeholders,
compact idle rows, expanded editing, tags, appearance, dirty state and floating Save. No ordinary
fields hide behind More details/Show more. Record time zones always inherit account preferences.

## Actions and feedback

Zero actions means no control; one action means an accessible icon button; multiple actions use
a native vertical-ellipsis menu. Put ordinary actions first, then a separated destructive group
at the bottom in red. Actions have semantic icons. Record cancel/trash are destructive; Close or
Cancel in a picker only dismisses that draft. Preserve explicit destructive confirmations.

Primary capture uses a floating glass plus, not a small heading-level Add link. Editors use the
floating bottom-right plain-check Save, with safe-area and keyboard clearance. Close sits top-left
until an explicit edit; then Cancel prompts before discarding. Untouched Save is disabled; dirty
Save also respects validity, pending, conflicts and permissions. Lifecycle actions stay top-right.

Use Sonner for discrete pending/success/failure feedback, preserving one toast through the action.
Do not inject action-result banners into content. Successful background autosaves remain quiet.
Never treat an uncertain write as failure that can be blindly retried. Preserve drafts/revisions.

## Task organization and view controls

Tabs are To-do, Projects, Lists, Browse. To-do defaults to open items due today or overdue, ungrouped, with Auto ordering.
The due filter is removable and all view options remain editable; Reset view restores these defaults. Pinned lists/projects occupy only their horizontal pinned
section; omit an empty pinned row. Inbox remains the default list for unorganized tasks under Lists.
Browse has no Add action. Upcoming and History share its top cards; below them group Task views
(All, Tasks, Reminders, Scheduled), Storage (Archive, Trash), and Preferences.

Projects has Active, Completed, Cancelled and All status chips with counts above its pinned row;
Active is the default. A completed or cancelled project stays in Projects under its status until it
is archived, and opening it shows all of its tasks, including finished ones. Rows and pinned cards
for finished projects show the status and include it in the accessibility label ("Open Move,
completed"). A project's metadata line (status, list, target date
formatted as a short calendar date) sits directly under its name; a list description keeps the full
width below the row actions. A finished or archived project, or one whose list is archived, offers no Add,
because the server rejects new work there; Add also stays hidden until the project has loaded. Counts cover projects outside Archive and Trash and ignore the current search; chips show
their bare label until lists and projects have loaded, never a zero from a pending or failed read.
An empty status names itself, All with no projects says "No projects yet.", and a search that hides
every project says no projects match. Lists have no completed or cancelled state and no status chips. Lists, Projects
and Archive search matches names plus list descriptions and project why and notes.

Upcoming means due/reserved after today; Scheduled means a task has reserved time, regardless of
date. History contains completed/cancelled records outside archived containers. Archive contains
archived containers, not merely closed projects; those remain under Projects. Trash contains deleted records and supports
Restore. Give Archive and Trash distinct icons. Trash does not offer capture or permanent deletion
without an explicit product decision and confirmation. A failed restore keeps the item recoverable.

Filters live in a bounded sheet; sort/group use native selected menus. Global views narrow by
List, Project and the Today, Tomorrow and Next 7 days due shortcuts. Display human-readable
active chips and effective sorting/grouping beside results. Preserve fixed destination scope,
distinguish filter reset from view reset, and make saved defaults explicit. See the detailed form
contract for geometry, state and reset behavior. Do not scatter configuration through result lists.

### Task selection, counts and project header

Long-pressing a task row starts a selection; its bar shows the number selected, Cancel, Select
all and the actions every selected item allows. Select all selects the loaded items that can
change, up to the selection limit of 100, and replaces the current selection, so a read-only
pick that was blocking the actions is dropped. It is not offered when nothing loaded can change
or everything that can is already selected. It never reaches items that have not been loaded:
Load more first. The number selected and the actions both cover only selected items that are
still listed, and a refresh that drops a row removes it from the selection, so it no longer
counts toward the limit.

Browse, Lists, Projects and Archive show how many items each destination lists. A count is the
`total` of the same query the destination opens, read with a one-item page, so it equals the
"N items" line on the opened list while no search is active, including the Show completed tasks preference and the
every-status view of an archived container or finished project. The Archive row on Browse
counts its containers, from the loaded lists and projects, and announces them as containers. Browse rows and the Upcoming and History cards show the
bare number; list and project rows and pinned cards say "3 items" beside the name. The count is
the control's accessibility value, so the label stays the destination's name. A count that is
unread or could not be read is absent, never a zero; failed totals raise one Sonner error, not
one per row or per screen. Counts ignore the search, which finds containers rather than
narrowing what they hold. Counts read after the Tasks preferences answer. Each list or project
row and pinned card reads its own count, so a long directory asks only for the rows it has
drawn; Browse reads its seven together. A Tasks action refreshes the counts on mounted screens
in the background: the action finishes, and its controls unlock, without waiting for them. A
count read still in flight when the action lands is dropped and read again.
Returning to a directory re-reads them, and the lists and projects behind the Archive count, so
they follow changes made elsewhere.

A project's page shows its why (three lines at most) and "Target" with the short calendar date
under the title and above the filters and tasks. A project with neither shows nothing there.

### Task row details

A task row keeps its full title, wrapping rather than truncating, then quieter lines below it.
The scan line stays about urgency: Read-only, Reminder, Cancelled, High priority and the due
date, with the overdue treatment unchanged. A one-line context line follows with reserved time
and the estimate, then the owning List / Project on a line of its own, so neither a long
reservation nor a long container name can push the other out of view. Reserved time
and the container always show when the task has them; a row inside a list or project browser, or
under a List or Project filter, does not repeat that container. Estimate, notes and tags follow
the saved row-detail preference shared with the web app: notes take at most two lines, tags wrap
as small chips and a row shows five before counting the rest (+2 more). Nothing optional shows
until the preference has loaded. An absent value, or a container that cannot be named, renders
nothing; never a placeholder. Reminders have only notes. The row's accessibility value carries
the same lines in reading order.

### Archived items in task search

"Include archived in search" (on by default) widens a task search to completed and cancelled
items and to items in archived Lists and archived or finished Projects, the same intent as the
web search toggle. Those container matches are read separately and listed last under "In
archived or finished lists and projects", after
every other match has loaded; the item count covers both. The preference applies wherever a
search has no status of its own: it leaves alone a destination with a fixed status (To-do is open
items), a Status the person chose, History and Trash. Inside a list or project one read with
every status already covers its archived work. With the preference off a search keeps the view's
own status. Until the preference has loaded a search is not widened. One search that
fails raises one Sonner error even though it makes two reads; if only the archived read fails
while other matches are showing, the list offers "Retry loading archived matches" and counts the
matches it has. A cancelled task names itself Cancelled on the scan line, since it is otherwise
drawn like a completed one.

## Accessibility and verification

Preserve Dynamic Type, meaningful accessible labels, checked/selected/disabled states, keyboard
avoidance, safe areas and sufficient contrast. Color and haptics supplement text/shape, never carry
meaning alone. Verify creation/editing, populated/empty/long content, modal cancellation, rapid
navigation, native tab dragging, filter clearing, conflicts and recovery. Never claim native
visual acceptance from web preview or unit tests alone.

Notification permission is contextual and user initiated. Use standard OS permission/settings
flows, account-owned scheduling and generic lock-screen copy. Report only confirmed scheduling
or delivery outcomes. Local notifications do not guarantee always-on cross-device monitoring;
see the notification boundary record for current limitations.

## Glass contrast and action consistency

Glass controls must remain readable over their actual rendered material, not merely the page
background. Header capsules use a legible dark foreground on the native light glass treatment;
menu content follows its light/dark menu appearance. Keep enabled text/glyphs at primary emphasis
and disabled buttons visibly present with a distinct disabled state. Inspect both appearances
and the editor header, floating Save and native popup together. Retain native glass rendering.

Menu text and icons share the same semantic color, including destructive red. UIImage menu
assets preserve original pixels, so use generated semantic-color assets when template tint is
unavailable. Reuse the exact Trash/Archive glyphs from their destination pages. Cancel record
uses the cancel glyph; never substitute a disconnected-link icon. Ordinary actions and their
icons remain neutral. Keep these rules in shared controls, not page-specific patches.


### To-do urgency and rescheduling

Auto ordering is server-side before pagination: open items due within the next ten minutes rank
first, then High/Medium/Low priority, then earliest deadline, then stable identity. The default
membership includes only open items with a deadline before the end of today in the account's
planning timezone; undated, completed and future-due items remain available through filters.
A reservation today does not pull a future-due item into this default. Display groups, when
explicitly chosen, take precedence; Auto orders within each group. Cursor pages share their first
page's clock; a fresh refresh recalculates urgency. Mobile Auto views refresh every minute.
Auto is a view option and To-do default, not a persisted workspace-wide sort preference.

Overdue means an open, non-trashed item whose due timestamp is in the past, including earlier
today. Use a subtle destructive-color surface tint and a red, explicitly named Overdue date;
keep title and other metadata in their normal colors. Include deadline time. The due-date editor
retains red date treatment while the draft deadline is past. Quick draft-only choices are In 1
hour, Tomorrow at 9 AM, and In 1 week at 9 AM, all relative to now/today in the account timezone,
not relative to the old overdue date. Use calendar days across DST. Save/Cancel retain their
existing semantics; a shortcut never saves automatically. Clear removes the deadline.


### Permanent lists, header rhythm, and toast presentation

Inbox is the permanent default List. Show a quiet secondary “Permanent” label alongside its
name in the directory and below its name when pinned. Do not imply that it is locked or unusable;
it still opens and can be pinned. Its protected identity has no edit/archive action.

Page titles have 16 points before unfiltered content. A title row containing view actions owns
12 points below the row; the heading and action must not add their own bottom margins inside it.
Active filter chips have 8 points below them, then the result summary has 12 points before rows.
Use the same 20-point page inset across lists and directories. Avoid additive margins that leave
a large empty band between the title and filters.

Use AppToaster everywhere, with one active default-channel host: the root normally, or the host
inside the native task/container editor sheet. Enable Sonner stacking with up to three visible
notices, 8-point separation, and five-second ordinary notices (Undo keeps its longer window).
Use an opaque contrasting surface, legible text, subtle border/shadow, and an explicit close
control; never translucent glass for feedback. Keep Undo buttons at least 44 points tall. Update
one toast ID for loading/result; name outcomes such as “List pinned” rather than a generic Saved
when the action has a more informative name. Do not duplicate the same toast in root and sheet.

### Finance workspace destinations

The approved mobile Finance map uses Overview, Spending, Plan, Accounts, and Assistant
as five stable native tabs. Spending owns Summary and Transactions; Plan owns Budget,
Cash flow, and Wealth. Assistant presents the existing conversation, review queue,
and recorded activity; it does not create a second decision store. Preserve the native
system tab bar, selected workspace tint and filled icons.

Finance summaries must preserve the server's currency, contribution basis, coverage,
and freshness qualifications. Unknown included balances are not zero. Do not display
legacy aggregate totals unless included balances, ownership and currencies are known.
Expected recurring amounts must distinguish income from obligations with signs and labels.
A scoped spending ledger identifies its contribution total separately from full record
amounts. Shortcut destinations preserve the intended subview on repeated navigation.

Native Finance implementation and its remaining web-parity work are tracked in
COO-210 — Mobile Finance; this target map is not a claim of full delivery.

## Finance totals and recovery

Money uses `$1,234.56` for USD; missing currencies remain explicit and other currencies retain
their code. Cash, investments, debt and net worth qualify independently through the shared domain
calculation. A source issue must not suppress an unrelated position. Unknown balances are never
zero; preserve signed assets and liability credits. Show an unavailable amount with its specific
reason and link to the affected account, not a repeated “View by account” placeholder. Never
combine currencies or include possible duplicates without resolution.

Spending retains its date range between summary and transactions. Search and posted/pending
filters operate on server results, not only loaded pages. Exact category drill-downs retain their
server revision and contribution scope. Native tab return refreshes relevant stale reads rather
than invalidating the whole workspace. Missing account timezone offers a Settings destination.

Plan separates monthly category limits, budget proposals, upcoming schedules and wealth; a bill
schedule must never imply a projected bank balance. Conversation sends require server readiness,
retain the draft and delivery key after uncertain results, and acknowledge only confirmed delivery.
Review actions use displayed revisions and disclose whether a decision was actually applied.

Sonner status icons must be visually distinct from the single dismiss X. Action labels are centered
in consistently rounded controls with at least 44-point height.

Overview KPI cards show their label and amount, with a separate 44-point information trigger.
Calculation assumptions, included accounts, coverage and source freshness belong in a scrollable
native info sheet. Healthy cards have no explanatory subtitle. Meaningful limitations retain a
short tappable status (Partial total, Needs update, Unavailable); the sheet explains all applicable
limitations. Keep the amount’s destination separate from the information action.

Accounts uses the shared header search and the same segmented control as Spending for Cash,
Investments and Debt; show Other only when needed to keep uncategorized assets reachable.
Budget summary and monthly category utilization share one card. Each progress track compares
spending with its own category limit, with spent/limit amounts and explicit remaining or over-limit
text. The spending-budget ring uses authoritative whole-month totals from the human-qualified
baseline, including unbudgeted/uncategorized spending in that baseline's account universe. Never
compare to the latest proposal or sum nested display groups. Require a matching month, complete
coverage and a positive baseline spending budget; otherwise show unavailable. The proposal amount
remains separate because it can also allocate money to savings, debt or goals. Expose the ring's
baseline spending denominator in its accessible description. Preserve approved/proposed state and
the period for each source.

Budget headers use a readable month name and compact version (v1). Hide the normal Approved
state; retain proposal and other exceptional states.

Budget category bars use the Finance tint within pace, warning amber when the spent fraction
exceeds the elapsed local-day fraction of the current month, and destructive red after spending
exceeds the limit. Use the account timezone and the real month length, allowing the whole current
day. Pair amber with “Pacing high” and red with an explicit over-limit amount; color is not the only
signal. Do not duplicate the category heading/month within the monthly budget card. Category
progress and allocation rows reuse the domain's semantic category icon mapping and native generated
registry assets, with a category glyph fallback for custom labels.

Budget category rows open a detail view of their contributing transactions and a monthly limit
editor. Drill-downs must share the budget calculation's split, reimbursement, refund and posted-only
rules; a transaction's top-level category is insufficient. Limit edits retain the record identity,
bind to the displayed revision, and preserve server approval/input outcomes. Use the standard
Close/Cancel, discard confirmation, floating Save and above-sheet Sonner feedback.

Account identities use validated provider institution artwork without recoloring it. Missing or
failed artwork falls back to institution initials, never a fabricated company logo. Reuse the same
identity component in account rows and details.

### Finance account management

Accounts has a floating plus that opens the manual account form; connecting a bank is a separate
flow. Account details keep ownership and planning as direct rows and put Edit account, Sync
account, Review duplicate and the destructive Stop tracking account in the top-right action menu.
Offer Sync only for a connected account, and neither Sync nor Stop tracking once tracking has
stopped. A connected account's balance stays read-only; only a manual account edits its balance.

Sync is a provider handoff: keep one toast from loading to the confirmed result, disable the
account's actions while it runs, and refresh freshness afterwards whatever the result. Distinguish
a definitive rejection from an unknown outcome (timeout, lost connection, server fault). An unknown
outcome never claims success or failure, keeps the same idempotency key for the retry, and tells
the person what to check. Adding a manual account has no retry key, so after an unknown outcome the
next Save looks for the earlier attempt, under the name and institution it was sent with, before
writing again; a corrected draft is not written as a second account. A rejected or unknown edit
re-reads accounts so reopening the editor starts from the latest revision. An invalid Currency or
Balance states the correction beside the field rather than relying on colour.
The form names its required fields, uses Required/Optional as placeholders rather than sample
values, and keeps one title: the page heading, with only dismissal in the navigation bar.

Duplicate review happens in the app. The person chooses the account to keep from accounts that are
connected and current, reads both identities, freshness and the overlapping and unique transaction
counts, then confirms. Resolution is bound to the reviewed comparison revision; a changed
comparison stops nothing and reloads. Stop tracking and duplicate resolution each keep a native
confirmation that names the account and what is preserved.

### Finance transaction management

Spending offers Add as a command that opens the new transaction form: beside Select and Filters on
Transactions, and on its own line above the content on Summary, where it stays through a category
drill-down. It does not wait for the spending read, so it is there while that loads or fails. A
manual account's action menu opens the same form with that account chosen. Spending has no
floating plus, because it would sit over row amounts. The form uses Required and Optional as
placeholders, like the account form, rather than sample values. A transaction a person adds belongs to a manual
account, because the server removes a transaction only from one: the form offers manual accounts
only, chooses a lone one, and explains what is missing when there is none. Merchant, Amount,
Account and Date are required; the date defaults to today in the account planning timezone. A
blank Category leaves the choice to nohmi. Adding has no retry key, so after an unknown outcome the
next Save first looks on that account and date for the record the earlier attempt would have left,
and adds nothing when it finds one. If any field of the draft was changed since, category and notes
included, the form stays open, says the earlier version is recorded and offers Add anyway. That
action hands its toast to the save, which clears the action from it (an updated toast keeps its
earlier action unless told otherwise), and writes nothing while a save is running, once the add is
confirmed or submitted, or after the form has been left. Leaving after an unknown outcome never says the
transaction was not added, and re-reads Finance data. An amount takes a comma only as thousands
grouping; `12,50` is corrected beside the field, never read as 1250.

Transaction details put Edit transaction and, for a manual account's transaction only, the
destructive Remove transaction in the top-right action menu. Remove is not offered while the
account is unknown. It keeps a native confirmation, keeps its idempotency key across an unknown
outcome, and returns to the list only on a confirmed removal or when the record is already gone.

A category row is followed by New category, which expands in place to a name and Cancel/Add. The
new category is selected in the draft; the form's Save still persists the transaction against its
original revision. A name that already reads the same as an existing category is selected rather
than written again. Categories stored under one of the provider's raw codes are shown as words
(`RENT_AND_UTILITIES` reads "Rent And Utilities", as on web) wherever Finance names a category;
other names, including all-capitals ones such as `HSA`, are left as written, and writes still send
the stored name.

Every non-drill-down transaction list has Select and Filters beside its search. Filters is a sheet
with Category, Review, Sort by and Order as native choices that apply at once; a list already
scoped to one budget category omits Category. Review offers Needs review and No review needed,
which is every record not flagged, reviewed or not. Each active filter, and a non-default order, is
a selected shared filter chip above the list that clears on press, and the Filters control names
the active count and order to assistive technology. Rows state Pending and Needs review in their
text.

Select turns rows into toggles that state Selected or Not selected in their text. Categorize
applies one category to at most 100 displayed records after a native confirmation, each guarded by
the revision on screen, without changing merchant rules. One toast reports how many were applied
and, separately, how many went to review, changed elsewhere, were rejected or are unconfirmed; a
record the response does not mention is never counted as applied. Every submission ends the
selection and reloads the list, and nothing can be selected again until a reload succeeds. That
reload is silent when it works and raises one error when it fails, beside the Reload row.
Selection is unavailable while the list is loading, failed, empty or showing a previous filter's
rows.

Changing a transaction's date is not available: the API accepts only a category or a note on an
existing transaction.

A posted transaction's action menu offers Split transaction, or Edit splits once it has more than
one part. It opens the split editor in the transaction editor sheet, which writes through the
transaction breakdown endpoint the web Split dialog uses. A pending transaction offers neither,
because the server gives a breakdown only to a posted one. The editor opens with the saved parts in
their saved order, or with the whole amount on the transaction's category and one empty part. Each
part has a Category, an Amount and a Treatment of Mine or Reimbursable; Add part starts a part with
whatever is still unassigned, and Remove part is offered while more than one part remains; the
last part left takes the whole amount. The
amount still to assign, or the amount over-assigned, stays above the parts as field state. Save is
enabled only once every part has a category and an exact amount, no two parts share a category and
treatment, and the parts equal the transaction amount to the cent. One part alone assigns the whole
transaction to that category, which is how a split is removed. Saving sends the revision the editor
opened with. One toast reports the outcome: a conflict and any other rejection say nothing was
saved and keep the draft (a conflict that follows an unconfirmed save says the earlier save may
be why instead), and a save whose outcome is unknown says so, keeps the draft, re-reads
Finance data and changes the discard prompt so it never claims the splits were not saved. The
editor closes only on a confirmed save, and transaction details show parts only from what the
server returned. A split transaction's Category row reads "Split in N parts" and opens the editor
rather than asking for a category; its parts are listed by category with their treatment. The
edit transaction form shows the same row in place of the category picker and New category, and
never sends a category for a split transaction, because the server replaces every part with one
when it receives a category; notes stay editable there. A transaction with one part is an ordinary
categorized transaction and has no Splits section. A split transaction that is also awaiting
review keeps the review's category controls, and resolving the review with one category replaces
its parts. The
transaction list read does not return parts, so a list row cannot yet tell a split transaction
from an uncategorized one. The reusable merchant rule the web dialog offers for a single-category
breakdown is not offered on iPhone.

### Finance goal management

Plan › Wealth lists every goal that has not been removed and offers Add as a command above the
list, for the same reason Spending has no floating plus. A goal row opens the goal's own page,
which shows its confirmed progress, target, deadline, priority and status. Its top-right action
menu holds Edit goal, Confirm progress, Pause goal or Resume goal, Mark complete and, last and
destructive, Remove goal. Pause is offered for an active goal, Resume for a paused one, and Mark
complete until the goal is completed. Mark complete and Remove goal each keep a native
confirmation that names the goal; Pause and Resume act at once. In the browser build, where the
native alert does nothing, these confirmations and the forms' discard prompt use the browser's own
confirmation. A removed goal leaves the list and its page closes.

Progress is a recorded statement, never an inference: the person's own, or one their agent
recorded for them, which the goal page labels as such. A goal shows an amount and a
percentage only when the server returns a statement recorded for exactly the goal version on
screen, owned by the signed-in person, matching the recorded amount and not dated in the future;
the app applies the same rule as the domain's planning-evidence check, whose currency lookup is
unavailable in the app runtime. Otherwise the goal reads "progress not confirmed" and its recorded
amount is not shown as progress. Every change to a goal starts a new version, so an edit, pause,
resume or completion returns the goal to "progress not confirmed"; the edit form and the
completion prompt say so; Pause and Resume do not warn. A goal has no currency of its own: its
target reads in the currency of its latest progress statement, even one that no longer applies,
or the product's USD default when it has none.

The add and edit form holds Name, Target, Deadline and Priority and a floating Save. Name and
Target are required, with Required as their placeholder. The target is at most 21,474,836.47,
the largest the stored record holds, although the API accepts more;
an empty Deadline reads as not set. Confirm progress is its own form: Amount (zero is valid), Currency and As of, which
defaults to today in the account planning timezone and cannot be later. Currency starts from the
goal's last statement. Each form names its required fields. An invalid Target, Amount or Currency
states its correction beside the field; a typed Deadline or As of that is not a real calendar
date holds Save and is corrected in a line under the fields; a future As of date is corrected in a line under the
fields, and a cleared one only disables Save.

Every goal write carries the version that was on screen and an idempotency key. The key is kept
while the outcome is unknown and replaced only after a definitive rejection, so repeating the same
change cannot act twice. A changed goal is a conflict: the toast says to review the latest version
and nothing is overwritten. After an add whose outcome is unknown, saving the same draft repeats
it under the same key; saving a corrected draft first looks for a new goal under the earlier name
and adds nothing when it finds one. An earlier attempt that reaches the server only after that
look can still leave two goals; closing that gap needs a server-side key shared by both drafts.
A goal's actions stay disabled until the changed goal is on screen, so a second press cannot send
the version the first one replaced. One toast runs from loading to the confirmed result; a failed
or unknown save keeps the draft and the form open and never reads as saved.

### Finance cash flow, recurring items and income

Plan › Cash flow keeps the outlook: expected income and bills for the next 30 days, read from
confirmed schedules and described as an upcoming schedule, not a projected account balance. Each
outlook row opens its expected item. Under it, Recurring leads to four pages on one route
(`/finance-cashflow`, named by `view`): Income, Bills & subscriptions, Recent expected items and
Scenarios. The Plan tab reads nothing for those pages until one is opened.

Income lists every income stream with its status (Needs confirmation, Active or Paused), how
often it repeats, its next expected date and its expected amount. Bills & subscriptions lists
obligations under Bills, Subscriptions and Savings and states that changing a pattern does not
cancel a subscription or change a payment with its provider. An amount takes its currency from the
item's account; an item without an account uses the product's USD default, as elsewhere in
Finances, and an amount whose account is not known yet is shown without a currency. A row opens the recurring item: expected amount, status, kind, cadence, last seen date,
account, who found it, whether its schedule is confirmed and, for a bill or subscription, its cost
statement. A schedule statement and a cost statement each describe one revision of the item; once
the item changes they read as needing confirmation again, because the server stops using them.

The recurring item's top-right menu holds Confirm schedule or Revise schedule, Confirm cost or
Edit cost statement (bills and subscriptions only), Pause, Resume or Confirm pattern (for an item
that needs confirmation) and, last and destructive, Mark cancelled. Mark cancelled is offered for
obligations only, because the API rejects it for income, and keeps a confirmation that says
nothing is cancelled with the provider. Schedule and cost are offered only while the item is
active or needs confirmation; a paused or cancelled item offers Resume, and its page says to
resume it first. Each of these changes, and each schedule or cost statement, starts a new revision
of the item, so stating a cost makes the schedule need confirming again and the reverse; both
forms say so.

Confirm schedule is a form with a floating Save: Repeats, Timezone, First date, Effective from,
the two days of the month for a twice-monthly schedule, Amount type (Fixed or Variable), Expected
amount and Currency. The account is shown but not chosen: the server accepts a schedule only for
the item's own account. Timezone starts from the account planning timezone and Currency from the
account; a revision also starts from the previous statement. Cadence, dates and amount are never
taken from the detected pattern. A revision needs an effective date after the previous one. Confirm
cost records whether the expected payment is fixed or variable, its currency and an as-of date
that cannot be in the future, and needs the "This is my statement" switch.

Recent expected items lists the last 30 days of expected items from confirmed schedules, newest
first, because that is where posted transactions are. An expected item shows what was expected,
what is matched and what is still expected, its matches that have not been reversed and, once a
match has been reversed, its full history. A match the server no longer counts (for example after
its transaction changed) is labelled as such and can still be reversed. Match opens a form that lists posted transactions in the same account
and currency within two weeks of the expected date that the server marks eligible; a pending,
uncategorized or transfer transaction is not offered. A split transaction also asks which part
covers the item. The amount matched is at most what is still expected and at most the chosen
transaction or part, and a reason is required. Opening a match reverses the whole match with a
reason; the original stays in the history. An item from an earlier schedule can only have an
existing match reversed. Matching never creates or changes a payment.

Scenarios compares a baseline with up to five alternatives over a horizon of 1 to 120 months.
Each scenario needs a name, starting cash, monthly income, housing, debt payment and reserve
contribution, and either category spending lines or the "no other monthly spending" switch; debt
balance, goal target, goal savings and assumptions are optional. The first thing still missing is
named above the Compare button, which stays disabled until the comparison can be sent. Results
are the server's: monthly cash flow, projected lowest balance, reserve runway, debt payoff, goal
effects, warnings and assumptions. Scenario amounts carry no currency, so none is shown. Results
are read only, never change the plan, and are marked as belonging to the previous entries after an
edit.

Every write here uses one toast from loading to the confirmed result. Finance data is re-read
before the result is reported, and the item's actions stay disabled until that re-read has
succeeded: if it fails after a confirmed write, the write is reported and the actions wait for the
read to be retried. A schedule or cost form that is open when the item is paused elsewhere stays
open with its entries, cannot be saved and says why. A match or reverse form likewise stays
open through the re-read its own write causes, so it always reports the result and closes. The
day a match was recorded is shown in the account planning timezone. A refused write
(4xx) says nothing was changed or keeps the form open with its entries; a 409 says what changed
elsewhere; a write with no answer says it could not be confirmed, and sending it again from the
same open form or page reuses its idempotency key, so it cannot act twice. A form that is closed
and reopened starts a new key. A form opens only on a fresh read of what it states against, never
on a cached copy that is still being re-read.

Not on iPhone yet: the web outlook's date range and account filters, calendar presentation,
payday projection and balance statements, and reimbursements inside Cash flow (they are reached
from Assistant). A past expected item older than 30 days cannot be opened.

### Finance CSV import and export

Import is offered in the account's top-right menu as Import CSV, only for a PayPal, Venmo or Zelle
account: the server imports an export only into an account of the same provider, so the provider
is not a choice. The import form shows the account, the provider and the chosen file. Choose file
opens the system file picker from the file-system module the app already ships; no new native
module was added. On iPhone the picker hands the app a temporary copy, which is deleted as soon as
its text has been read. A file over four megabytes is not read at all and is reported as too
large.

Nothing is sent until the person chooses Import. Before that the form shows what will be
imported: the number of transactions, their date range and the first 50 rows with date, name, note
and signed amount, read by the same rules the server uses. A file that cannot be read in full
says which line and why, shows no rows and cannot be imported. The server reads the file again
and is the authority. The API imports all or nothing: one row it cannot read fails the whole file
and nothing is written. It has no preview route and reports only how many rows were imported and
how many were skipped because they were already in the account, so the result names those two
counts; there is no per-row rejection list to show.
A file with no transaction ID column says that an already imported row is recognized only while
the file keeps the same rows in the same order.

The import uses one toast from loading to the confirmed result. It is done only when the API
confirms it: "Imported 12 transactions; 3 already in this account were skipped." A refusal says
nothing was imported, adds the server's own reason and keeps the form. An unanswered import says it could not be confirmed and
is sent again from the open form under the same idempotency key, which the server answers once;
importing the same file again is also safe because rows already in the account are skipped.

Export is a command beside Select and Filters on every transaction list that has those commands;
the list under a spending category, which has none, has no export. It exports the view that
is on screen (its account, dates, search, status, category, review state and order), reading every
page of it up to 5,000 transactions, and says so when a view is longer. The CSV has Date,
Merchant, Amount (signed, plain number), Currency, Type, Status, Category and Notes; every cell is
quoted and text that a spreadsheet would run as a formula is neutralized. The file is written to
one export directory in the app's cache only while the system share sheet is open, where the
person chooses its destination. The directory is removed whether they share it, cancel or the
sheet fails, and is emptied before every export, so a file left behind when the app is closed with
the sheet open is gone at the next export. One toast reports
the count exported, a cancelled export or a failure. If the view changes while its pages are
being read, nothing is exported and the toast says to export again. Export is offered on iPhone
only.

### Transaction conversations and review

- Needs your input cards show merchant, amount and category, and open the canonical transaction details page. Details place attention on the category row itself, with direct selection and approval. Do not duplicate the field with a separate Choose category banner/button. Notes remain optional and never count as a missing required field. This is record state, not action-result feedback.
- Money uses a currency prefix, with `$` for USD and legacy records without a currency. Explicit non-USD source currencies remain identified; missing amounts remain unavailable and mixed-currency totals are not combined.
- Message nohmi from transaction details opens the workspace conversation with a removable transaction attachment. Show merchant and amount before sending. Attachment removal preserves the draft; confirmed delivery clears it. Unavailable references block sending until removed, and uncertain retries retain both the reference and delivery key.
- Sent references remain accessible in conversation history. Chat context is distinct from a transaction note and does not itself confirm a categorization change.

### Workspace conversations

Chat uses a bounded, flex-sized transcript beneath fixed page controls. Only the transcript
scrolls; the composer stays at the bottom above navigation and follows the keyboard. User
messages align right and assistant messages left, with readable theme-aware bubbles and sender
labels. The multiline input has a maximum height and scrolls internally after that. Keep
pagination explicit: open the latest 50 messages and load older pages above them. Refresh every
five seconds only while the transcript is focused and foregrounded, so asynchronous replies appear
without reopening the workspace. Stop polling on blur/background. Preserve reading position when the user is away from the latest
messages. Sending retains the draft and idempotency key until the API confirms delivery;
connection readiness must remain honest and action outcomes use Sonner.

### Fields needing input

Preserve the standard settings-row layout, spacing, icon, label and background. Color only the value yellow when it needs attention or a decision (for example, Uncategorized). Color the value red when it is known to be incorrect or past its deadline (for example, an overdue task date). Do not add yellow row backgrounds, borders, warning icons or duplicate callout panels. Keep the actual value readable and expose the reason through an accessibility hint so color is not the only signal. Keep the label/value row vertically centered and tappable. Open a focused picker directly from details instead of requiring the full edit form for one field. Put suggestion approval beside the suggested value. Optional empty fields do not need attention styling. Clear attention only after a confirmed save or review resolution; pending, failed and unconfirmed writes retain the real record state and use Sonner for feedback. Refresh associated queues so the item also leaves Needs your input after resolution.

Finance applies value-only attention styling to unknown ownership, reconnect/sync status and unavailable expected amounts. Intentional states such as excluded-from-planning, manual accounts, optional notes and ordinary debt balances are neutral, not errors. Invalid entered amounts or ownership percentages are red; pacing high is yellow and overspending is red. Source-owned values stay read-only. User-owned planning/ownership, notes and monthly limits are editable from their detail rows with bounded controls and revision checks.

Category identity follows the record throughout transaction lists, detail rows, editor options, conversation attachments and spending/budget groups. Prefer the validated group icon supplied by the API, then the shared semantic category mapping; custom buckets use the bucket fallback. Never substitute a generic receipt/wallet for a known category, and never invent an identity for an unavailable category.

Coming next and Cash flow show the scheduled date, saved recurring type and matching icon, signed amount, and expected status. Recurring types (Income, Bill, Subscription, Savings) are distinct from transaction-category assignments; never infer a transaction category from the merchant name. Upcoming previews sort chronologically and exclude matched or superseded occurrences.

### Calendar day and agenda

Calendar on iPhone is one screen with Day and Agenda segments; it does not reproduce the web week
grid. The heading names the chosen day. Previous/next arrows step one day, a week strip that starts on
the account's "Week starts on" setting jumps within the week and marks today and days that have
events, and Today returns to the
current day in the account planning timezone. Day shows all-day events as rows above an hour
timeline that covers 8 AM–6 PM and widens to contain earlier or later events; overlapping events
sit side by side and say so in their accessible label. Agenda lists the next 14 days from the
chosen day, grouped by day, omitting empty days.

Reads are bounded: Day loads the chosen week and Agenda its 14 days, both as instants derived from
the account timezone. Provider all-day events stay on their calendar date; an event that crosses
midnight appears on each day with From/Until wording. Rows carry time, tentative/cancelled state,
location, a video-call marker and the calendar name; color comes from the calendar.

Choose calendars opens a sheet of every calendar with its source account, read-only state and
last-update freshness. Showing or hiding a calendar saves the same account-level choice web and
Settings use, then re-reads events; success is silent and failure uses Sonner. Hidden or absent
calendars and calendars that may be out of date are stated on the page rather than rendered as an
empty day. Event details show date and time with the display timezone and the event's
own timezone when different, repeat/tentative/cancelled state, location, the meeting link or its
pending/failed state, calendar and source, freshness, reminders, guests and notes. Blocking time
and conflict review are separate work (COO-242).

### Calendar event create, edit and delete

The agenda's floating plus opens a new event on the chosen day; it is absent when no calendar can
be written to. Event details offer Edit and Delete in the top-right action control only when the
event's calendar is writable and the event is not a busy block that mirrors another event. A
read-only calendar offers neither.

The event form follows [Mobile settings-style forms](mobile-forms.md): title, then When (All day,
Starts, Start time, Ends, End time), Calendar, and Details (Location, Notes). A new event starts
at the next whole hour today, or 9 AM on another chosen day, lasts the account's default event
length, and goes to the approved default calendar, else the primary writable one. Moving the start
keeps the event's length, and turning All day on for an event shorter than a day makes it that
one day. Without an approved default, a calendar the agenda shows is preferred. An event stays on its calendar; the Calendar row is fixed when editing.
Guests, reminders, repeat rules and meeting links are not edited on iPhone.

Dates and times are entered in the account planning timezone and saved with it; there is no
per-event timezone selector. An all-day event covers whole calendar days through its last day and
is sent the way each calendar reads it back: nohmi and Google calendars take the date in the
event's timezone, iCloud takes the UTC date. An edit sends only the fields the person changed plus
the revision the form opened with, so a change made elsewhere is a conflict rather than an
overwrite. A repeating event says that changes and deletion apply to every occurrence.

These writes change the person's calendar at its provider, so the app reports only what the API
confirms. Each write is one Sonner toast from pending to its outcome, and the page shows no result
copy. An end that is not after the start is one Sonner error and sends nothing. A refusal from
the API keeps the draft open. A conflict keeps the draft, disables Save and offers Reload event
(discard changes). When a result cannot be confirmed (no response, or a server or provider
failure) the app says so, re-reads the calendar, and never shows the change as saved:

- An unconfirmed create freezes the draft and offers Review calendar before creating again or
  Check calendar and create again. The second, after a confirmation, first reads that calendar
  over the event's days. If an event with the same calendar, title and span is there, the first
  attempt worked: it is reported as created and nothing more is sent. If the read fails, nothing
  is sent and the choice stays. Only when the read succeeds and finds no such event is exactly
  the first payload sent again. The API does not yet deduplicate event creation (COO-27), so
  the app never retries by itself.
  Events are read from shown calendars only, so on a hidden calendar the second create is not
  offered at all; the person reviews the calendar instead.
- When the failure says the provider did create the event but nohmi could not record it, no
  second create is offered: the toast says the event will appear after the next sync and the
  form offers only Close and review calendar.
- An unconfirmed edit or delete can be tried again; it still carries the reviewed revision, so
  the API refuses it if the first attempt did land.

A refusal that arrives after part of a write already reached a provider (an event with busy
blocks on other calendars) counts as unconfirmed, not as a refusal. The re-read after a write
never delays that write's result and raises no notice of its own.

Delete asks for confirmation, then moves the event to the API's recoverable deleted state. Its
confirmed toast offers Undo for ten seconds, which restores the event with the revision the delete
returned and reports its own result, inside the session that deleted it. An unconfirmed delete
offers no Undo. A restore the API plainly refuses changed nothing, so its error toast offers Try again
once (not after a conflict or a missing record); an unconfirmed restore is never repeated. Undo is offered only when restoring returns the same event: always for nohmi's
own calendars, and for a provider event only when it has no guests, repeat rule or meeting link
(the API re-creates a provider event from its title, time, location and notes) and is not an
all-day event that nohmi changed since its last sync. Otherwise the confirmation says the delete
cannot be undone from nohmi.

### Calendar blocks, conflicts and the free-time check

Event details offer Block time in the top-right action control for any event that is not itself
a block and has another writable calendar to block, including an event on a read-only calendar.
When the event already blocks time, a row names each calendar and how its block reads, and opens
the same page.

Block time follows [Mobile settings-style forms](mobile-forms.md). New blocks show starts from
the saved busy-block privacy (Busy when Calendar guidance is not active) and applies to blocks
added on this visit; it is not saved back. Each other writable calendar has one switch, Block on
<calendar>, and a blocked calendar adds <calendar> shows to change that block between Busy and
Details. Busy shows only that the person is busy; Details copies the event's title, location,
notes and link. A calendar with several linked copies reads as Details when any copy does. The event's own calendars and read-only calendars are not offered. The same occurrence
can sit on several calendars, each with its own linked copy on one destination; a switch or
choice changes every copy there. One event record carries only its own blocks, so the page and
the details row also read the event list for that time, which names the other calendars and
their blocks. The list shows one record per occurrence, and the API exposes no
occurrence identity. A record listed under another copy's id is taken for this event only when
it carries a block linked to this very event; a record that merely has the same title, time and
calendar could be another meeting, so its blocks are never merged or changed. An event opened
by a non-listed copy's id that has no block of its own therefore shows only its own record. Which
records are one occurrence is the API's decision: it groups provider events from different
accounts that share a title and exact time, and the page shows and changes the blocks of the
whole group, as the web app does. In
the conflict checks an event is left out by its own id, or, when the list does not hold that id,
by a single look-alike; two look-alikes are both listed. Opened for an event on a
hidden calendar, which the list does not return, the page knows only that record's own blocks.

Every switch and choice is one write to a real calendar. It is one Sonner toast from pending to
its outcome with no result copy on the page, and the control moves only after the API confirms
the change. Each write carries the event and block revisions the page showed. A change made
elsewhere is reported as such, sends nothing further and re-reads the event. Once one of several
copies has changed, a later failure is reported as unconfirmed.

An unconfirmed block attempt (no response, a server or provider failure, or a refusal that
carried a provider effect) is remembered for that event and calendar, with what was sent and the
calendar's last sync time, until one is confirmed or the app restarts. The next attempt there
reads before it writes:

- The event is read first. If it now carries the block, that is reported and nothing is sent.
- A nohmi calendar has no provider, so the event read is enough and the block is sent.
- A hidden calendar's events cannot be read back, so nothing is sent and the toast says to show
  the calendar or check it in the provider's app.
- nohmi sees a provider calendar only as of its last sync. Until that calendar has synced again
  since the attempt, nothing is sent and the toast says to try again after it syncs.
- Then that calendar is read over the event's days for an unlinked copy of what the earlier
  attempt sent (its privacy, title and time, not what is chosen now). If one is there, nothing
  is sent and the toast says to remove it first. The one exception is a single unlinked Busy
  copy at exactly the event's start and end when Busy is chosen again: it is sent on, because
  the API links it instead of writing another.
- The sync time at the attempt comes only from a read made right after the failure. If that
  read fails too, the time is unknown: the next attempt records the calendar's sync time then
  and sends nothing, so only a later sync opens the way.
- If any of these reads fails, nothing is sent.

What can still go wrong: a sync that fetched from the provider before the copy landed but
finished after the attempt counts as "synced since" and would not show the copy, so a repeat
could write a second one. The API does not expose when a sync began.

Removing a block or changing what it shows can be tried again after an unconfirmed result: the
page is re-read first and the next attempt carries the revisions it then shows.

Event details list Conflicts when another event overlaps this one, using the Calendar review's
rule: timed, busy, not cancelled, not a linked block and not a repeating series, with touching
ends not counted. Each row opens the other event. Nothing is listed for an event the rule leaves
out. A failed check shows one retry row and no toast.

The event form states under When what the time on screen overlaps: no one-off timed event, or
the first overlapping event and how many more. That note and the Conflicts list both say that
repeating and all-day events are not checked. It is read again whenever the time changes, shows nothing
while reading or while the end is not after the start, says that all-day events are not
compared, and offers Check this time again after a failed read. It never stops a save. Both
checks see only the calendars the person shows, and say so; the API has no free/busy read that
includes hidden calendars. The Calendar review itself is not opened or changed on iPhone.

### Briefings and compact record rows

Today is a short, cross-workspace briefing: Needs you, Coming up, and Handled for you. Bound each preview to three entries and link directly to the existing entity detail or workspace view. Use Tasks' authoritative Auto ordering for today's open work, including overdue tasks; combine upcoming tasks/reminders with expected Finance occurrences using the user's timezone. Label expected amounts rather than implying payment. Only confirmed applied agent actions belong under Handled for you; pending proposals and the user's actions do not. Distinguish partial/unavailable reads from an empty or all-clear state and make freshness and refresh accessible. The native briefing covers Tasks, Calendar, Mail and Finance; complete connection monitoring is not part of it.

Today’s events lists what is left of the day in the account timezone: events still running or ahead by start time, then all-day events; ended and cancelled events are left out. A row carries the time on this day, Tentative and the location, marks a running event Now, and opens the event’s detail. Mail lists open Mail attention items (the first 100 the API returns), most important first; expired items and run summaries are left out. A row tied to a conversation opens that conversation in the Mail reader over Today, and any other row opens Mail. Opening a conversation keeps only its body-free summary; the reader loads and discards message text as it does in Mail. Both sections keep the three-row limit and say how many more there are; the summary chips carry the count of events left (opens Calendar) and, when there is any, unread inbox mail (opens Mail).

Each source fails alone: an unavailable Calendar or Mail read is named in its own section while the others stay on screen, and a failed refresh keeps the last results marked Partial or cached. No calendars, every calendar hidden and no connected mail account are each stated as a row that opens the place to fix it, never as an empty day or a clear inbox. The freshness line names the workspaces the briefing actually read.

Record-row trailing values and disclosure/actions occupy the heading line only. Descriptions below it use the full available content width, aligned with the title; do not reserve an empty trailing column beside every description line. Leading identity icons remain top-left and actions top-right. Use the shared `RecordRow` for informational rows; preserve vertically centered settings rows for editable label/value fields.

Today’s date/title sits in a decorative hero whose sky color continues behind the native search bar and top safe area. The briefing below uses the standard page canvas with rounded top corners, exposing the hero at the corners like a resting drawer. This is a static page composition, not a draggable sheet. Keep decoration noninteractive and hidden from accessibility; preserve native search and workspace interactions and readable contrast in both themes.

Today’s accepted sky direction is Atmospheric wash: smooth location/time/weather-driven gradients
and soft haze, with no dithering, rings, illustrated sun/moon, or particles. Sky color follows solar
conditions independently of app light/dark mode; keep the briefing canvas opaque and theme-standard.
Use a small weather/location caption for opt-in and fallback clarity. See
[the mobile sky boundary](../engineering/mobile-today-sky.md) for permission, freshness and lifecycle rules.

### Mail reading

Inbox is the unified inbox across connected accounts; Mailboxes lists each account's mailboxes with standard folders first (Inbox, Drafts, Sent, Archive, Spam, Trash), then the account's own folders by name, and the unread count as the trailing value. Choosing a mailbox shows its conversations in place with a back control to Mailboxes. A conversation row carries sender, time, subject, message count and a two-line preview; unread is a dot plus heavier weight, never colour alone.

Thread lists read only the body-free summary contract (`GET /v1/mail/thread-summaries`): no body text, recipient lists or provider thread identifier. Only these summaries may be cached. Message bodies, recipients and attachment names load when a conversation opens, stay in memory while the reader is open and are discarded when it closes. When a conversation cannot be read, keep the subject visible and say that message text is never stored on the device and needs a connection.

Search is typed in the workspace header and runs on the server against the current mailbox, debounced, through the `mailSearch` route parameter; the header shows no sample results on Mail, and the list keeps a visible indicator until the search read settles; results never mix with the unfiltered list, and switching mailbox clears the search. A search typed over the mailbox list, with no mailbox open, shows matches from every inbox. Distinguish an unavailable read from an empty mailbox, no connected account and no search matches. Pull-to-refresh follows the native refresh exception; an explicit Try again uses one Sonner toast from loading to outcome.

### Transparent sticky workspace search

The workspace search header floats above page content without an opaque full-width backing strip.
Keep its native Liquid Glass capsule and reserve its safe-area-plus-header height inside page content
so initial headings never sit under the controls. Shared Screen and virtualized Tasks lists use the
same header inset; scrolling content and decorative backgrounds can pass behind the fixed header.
Because pages own that spacing, native tab pages turn off UIKit's automatic content insets, so a
list is never inset twice. A tab page therefore also clears the floating tab bar itself: lists pad
their end by 100 points and the five Finances tab pages pass `tabBar` to the shared `Screen`, which
applies the same clearance whether or not the page scrolls. Routes that open above the tabs, such
as Finances details and editors, do not.
Keep the glass material's system appearance stable during scrolling; adapt foreground contrast
without changing the navigator or scroll surface's identity.

Today’s sky belongs to the hero, not the page canvas. The page and bottom safe area use the standard
canvas color; the rounded briefing drawer overlaps the hero’s final band. Today disables elastic
overscroll so pulling past either end never reveals an empty sky-colored gap. Status-bar and search
foregrounds follow the sky while it is behind them and return to page contrast once it scrolls away.

## Settings navigation target

Settings is an account utility, reached from the account menu. It has no bottom app bar or tabs.
Use a searchable root list of top-level destinations organized by section headings; each row
opens a child page in a native navigation stack with standard Back navigation. Account, Personal,
Workspaces, Intelligence and App are groups in the list, not additional mandatory landing pages.
Workspace Settings and Agent Settings entry points deep-link into the same tree. Follow Apple's
Settings hierarchy when an interaction is unspecified, while retaining this document's row,
identity, feedback, glass, attention-color and form contracts.

The migration includes Goals, Motives, Rituals and their history alongside account, workspace,
connection, agent and app configuration. Desktop-only controls stay platform-specific. This is
the approved target; implementation and release evidence are tracked separately under
COO-211 — Mobile Settings and the mobile Settings implementation plan.

Settings object-list pages use the shared floating plus at the bottom right for primary creation. Form submission and contextual additions within an editor retain their appropriate form controls. Settings version/build metadata appears in the root footer, not a separate About destination. Task Projects use the box identity; personal goals retain the target identity.


Native Settings uses focused children for connected accounts, device sessions, invitations, agent
setup/reviews/access/policy, Mail rules, Calendar sources and text-message policies. General rows
stay neutral and workspace subtrees retain their own accent. Routine pull refresh uses the native
spinner, silent success and one Sonner error, following Cooper's explicit preference. Native-stack
controllers own status-bar contrast, including Today sky overrides; generated iOS configuration
must enable controller-based status-bar appearance rather than suppress framework warnings.
