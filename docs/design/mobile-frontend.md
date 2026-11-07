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

Upcoming means due/reserved after today; Scheduled means a task has reserved time, regardless of
date. History contains completed/cancelled records outside archived containers. Archive contains
archived containers, not merely closed projects. Trash contains deleted records and supports
Restore. Give Archive and Trash distinct icons. Trash does not offer capture or permanent deletion
without an explicit product decision and confirmation. A failed restore keeps the item recoverable.

Filters live in a bounded sheet; sort/group use native selected menus. Display human-readable
active chips and effective sorting/grouping beside results. Preserve fixed destination scope,
distinguish filter reset from view reset, and make saved defaults explicit. See the detailed form
contract for geometry, state and reset behavior. Do not scatter configuration through result lists.

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
