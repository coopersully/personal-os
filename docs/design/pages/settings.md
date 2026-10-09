# Settings


**Required: Sonner for all settings errors and discrete action feedback.** Pending, success,
and failure messages for notification tests, connection tests, refreshes, permissions, and
native actions must never appear as inline paragraphs, status rows, Alerts, banners, or cards.
Use one loading toast updated to the confirmed outcome; put recovery guidance in its description.
Do not replay cached results on page load. Background autosave success stays silent. Actual
permission/configuration state and field correction/retry controls may remain inline, but never
replace a Sonner error. Tests must assert Sonner and no inline action-result message.
See [the canonical feedback rule](../feedback.md).

The immediate job is to inspect or change a preference, account, or connection.
Use the shared [feedback rubric](../feedback.md) for every operation.

- Profile and invitation forms use FeedbackForm. Server validation maps to named
  inputs; related planning hours and location selection validate on submit/blur.
- Profile saves and confirmation-email results use Sonner. Required email
  verification and unavailable platform capabilities remain contextual Alerts.
- Keep unsaved drafts and one-time invitation/token values visible through failed
  refreshes. Never replace cached settings with an empty-success state.
- Desktop wallpaper is a primary sidebar page. Keep its live preview sticky beside scrolling
  controls at desktop widths, including a 1100px app window. On phone-sized surfaces only,
  place the preview above them. Board, Layout, Appearance, and Framing are separate cards.
  Layout and image adjustments are inline; reserve
  room for slider thumbs at both limits and show the complete track. Save the board through
  a tooltip-labelled checkmark action at the URL input’s trailing edge. Refresh remains a
  tooltip-labelled icon action on the Preview card, with confirmation before replacing the desktop wallpaper.
  Preview uses the native renderer at the primary display’s aspect ratio and proportional scale;
  it must never substitute illustrative images or guessed backdrop colors. Grid and Stack
  repeat resolved board images across the padded frame. Size controls density, rotation uses
  the displayed angle, and spacing/corners/padding use display points (scaled on Retina).
  Preserve keeps source proportions and clips at the outer frame; Fill crops each tile.
  Invalid/unresolved boards fail before saving. Failed downloads or decoding disable Refresh
  and preserve the current desktop. Apply uses the same ordered images shown in the preview.
- Appearance option labels sit above their previews.
- Preference toggles, selections, and committed numeric/color changes save automatically;
  do not add a page-wide Save preferences button. Serialize desktop writes, preserve unrelated
  preferences, and roll back failures with actionable feedback. Explicit board URL submission
  and server connection changes remain named actions.
- Notifications owns only global permission, enablement, sound, privacy, and quiet hours.
  Workspace links navigate and focus each workspace’s Notifications card. Tasks owns due
  tasks and reminders, Calendar owns event timing and calendar selection, and Mail owns
  new-mail alerts and account selection. Finances shows its unsupported desktop-alert state
  until that capability exists.
- Wallpaper board URLs are drafts until confirmed saved; failure preserves the
  typed URL, field correction, and Save board action. Other direct preferences
  roll back to their saved value when an update fails.
- Disconnecting accounts or revoking access requires a named confirmation.
- Query failures expose Retry; background failures retain prior values with a
  stale warning. Each error has one announcement owner.

## Layout and navigation

Settings is an account utility with its title and global search in the sidebar
header, without workspace top navigation. Each section uses `SettingsPageLayout`
for a visible page heading, short purpose statement, and consistent gutters.
Activity keeps its record filter in the page body; settings search does not replace
feature-specific data filters.

Use an Apple-like hierarchy: familiar grouped preferences, clear labels, restrained
semantic surfaces, and progressive disclosure. Use `SettingsSection` (a shared
shadcn Card composition) for distinct decisions, not every individual field.

Use `SettingsBento` for a compact setup group beside a larger editor. It switches
from one column to 1:2 columns at 46rem of available content width, independently
of rail/sidebar state. Preserve DOM reading order and let groups grow with content.
Use `primaryFirst` for a larger record list followed by a compact creation form
(Goals and Motives). Use `settings-stack` for full-width tiles with the same 1rem
gap. Do not nest `wide-page` or `narrow-page` inside the Settings frame or add
page-specific viewport breakpoints. A single task-sized card is a valid bento layout;
do not force unrelated fields into equal-height columns.

Every persistent content group belongs in a Card, including filters, review queues,
activity history, financial context, and native desktop preferences. Use card headers
for group titles and actions; avoid repeating the page introduction above the cards.
Loading, empty, and failure states should stay in their owning group when possible.
Dialogs, toasts, and contextual refresh warnings are not separate bento tiles.

Use shadcn `ItemGroup` / `Item variant="secondary"` for records inside cards:
outcomes, motives, review items, accounts, sessions, invitations, connected hosts,
tokens, and ritual steps. The shared variant pairs `bg-secondary` with
`text-secondary-foreground`, keeping rows distinct from `bg-card` in either theme.
Do not recreate row surfaces with local colors, borders, or nested Cards. Use
ItemContent, ItemTitle, ItemDescription, and ItemActions for the row anatomy.
Form fields remain Fields; rich choice cards and grouped activity disclosures
retain their interaction-specific structures.

Audit coverage: Profile, Setup, Appearance, Connections, Workspace access, Connected
agents, Mail, Calendar, Tasks, Finances, Rituals, Goals, Motives, Activity,
Invitations, Sessions, Texting, Desktop, Wallpaper, Pet, and Notifications. Native-only
sections share these primitives but also require native runtime QA for their actions.
This follows the [shadcn Item guidance](https://ui.shadcn.com/docs/components/radix/item):
use Items for records and actions, Fields for labeled inputs.

Forms retain shadcn Field/FieldGroup/FieldSet, visible labels, and existing save
semantics. Keep security actions in a named group. Layout changes must not reset
drafts or change persistence.

## Search

The search button sits inline with Settings in the sidebar header and remains
available with the sidebar collapsed. At narrow widths the same search appears
in the page heading, alongside the existing dock's section navigation. If both
rails are collapsed, reserve a separate header row for the workspace switcher.

Compose a shadcn Dialog and InputGroup with ordinary navigable links. Rank individual
field names before aliases and section context; retain section results for browsing.
`features/settings/settings-fields.ts` is the field catalog: every new preference
needs its public label, synonyms, and a control ID or exact visible label. Never
index private values. Filter results using the sidebar's permission/platform rules.

Field links use `/settings?section=…&field=…`. `SettingsFieldFocus` opens only
allowlisted tabs, disclosures, or existing editors, then scrolls and focuses the
control after asynchronous content mounts. It never changes a setting, sends a
verification code, or submits a form. Conditional controls may target their
prerequisite when unavailable. Dialog dismissal must not restore focus over the
destination. Section descriptions and terms remain in `settings-search.tsx`.

Focus the input on open. Tab reaches results, Enter follows links, Escape closes
and restores focus, and no results offers another query. Search text stays local to
the dialog; field links identify the destination without applying a data filter.

## Sidebar metadata and inputs

Settings uses `SidebarItemMeta` for attention and counts, including the mobile
section sheet. An attention dot means a person-owned action is required; the
accessible status retains “Action required.” Counts are independent, end-aligned,
normal-weight secondary text. Connections counts connected provider accounts plus
an X bookmark account; Connected agents uses the same active, used credentials and
OAuth-host definition as its page. Unknown or failed inventories omit their count;
zero is shown only after successful reads. Do not turn unread Mail into an alert.

Use shadcn Input, NativeSelect, Textarea, Checkbox/Switch, and Field compositions;
no feature-specific raw control styling. Date-only preferences use `DateInput`,
composing InputGroup, Popover, and Calendar. Typed dates and calendar picks keep
`YYYY-MM-DD` values in local calendar time, respect bounds, and allow clearing.
Use ordinary Input with `type="number"` for quantities and durations.

USD amounts use `CurrencyInput`: plain decimal text while editing, grouped commas
and two decimals on blur, with an inline currency symbol. Formatting must never
round an invalid draft into validity or change the saved value. Empty stays empty;
invalid precision, negative values, or out-of-range amounts remain correctable.
Keep the visible input's name so FeedbackForm can focus server field errors. The
formdata handler replaces formatted display text with the canonical decimal value
for native FormData consumers; controlled save handlers use that same raw value.

Allow grids and Field/Item content to shrink (`minmax(0, …)` / `min-width: 0`).
Bound selects and truncate their selected display text; keep complete options in
the menu. Wrap descriptive content inside cards. Do not hide overflowing inputs or
buttons behind card clipping as a substitute for responsive layout.

## Record anatomy

Goals, Motives, Sessions, Connections, and editable Ritual steps share `SettingsRecord` /
`SettingsRecordContent`, composed from shadcn Item on the secondary surface.
Use a wrapping title at the top, with compact icon actions aligned to its top-right;
descriptions and metadata get their own full-width rows beneath. Status badges use
sentence case (Active, Paused), progress stays a percentage, and date-only targets
use `formatCalendarDate` with a semantic time element so time zones cannot shift
the written day. Keep prose readable instead of squeezing it beside actions.

Use `SettingsRecordAction` for consistent icon sizing, accessible labels, and
hover/focus tooltips. Preserve confirmation for destructive actions. Ritual steps
keep their drag handle at the start of the header, followed by their step title and
remove action; their form fields fill the width below. The handle must retain
keyboard arrow reordering and its accessible instructions. Do not replace editable
Field compositions with static Item descriptions.


Collection creation actions use a labeled plus icon in the CardAction slot beside
the card title. Ritual Checklist adds a step directly; Goals and Motives open a
shadcn Dialog containing the creation form. Keep the list full width and hide
creation fields until requested. Close only after a successful save; errors and
drafts remain available, and closing returns focus to the trigger. Settings search
field destinations must reveal the matching creation dialog before focusing its
field. Connections uses the shared record header for icon actions; keep provider health,
capabilities, and workspace metadata readable below, preserving semantic status colors and
meaningful accessible action labels. The retained legacy Reviews queue is not a current Settings
record editor; active review presentation follows the [workspace Reviews contract](reviews.md).


Account profile preferences autosave after a brief typing pause. Serialize writes
and save the latest draft after an in-flight request finishes; never overwrite
newer edits or announce them as saved when only an older draft succeeded. Keep
invalid input and unselected location searches local. Show temporary saving feedback and an explicit retry after failure; successful
autosaves return to a quiet idle state with no persistent saved label; do not require a Save profile
button. Security actions (password reset, verification, logout) remain explicit.
Use the labels Day start, Day end, and Time zone in the UI and search catalog.

Account is the person's profile overview: a prominent identity header, editable
personal details, verified phone and country, live connection health, and workspace
summaries. Reuse the verified Agent Texting number and its consent/verification
flow, including a direct Agent Texting link. Never silently activate texting when
editing other profile fields. Workspace summaries combine setup actions and the
review queue, with a Workspace settings destination. Failed reads are
unavailable, never healthy; do not invent per-workspace session history. Keep
decoration in the identity header using the shared auth BrandPattern tiles, fading
from the bottom-right toward the profile text; use theme foregrounds, not status
colors, and respect reduced motion.

Account workspace summaries use a borderless workspace-tinted block, a title-sized unframed icon,
and the shared sidebar attention dot inline with the title when setup or review work needs attention.
Show a Workspace settings destination. Reviews opens from the workspace alert, the action
beside that workspace Settings title, or workspace search. Setup uses the settings
destination; do not add a duplicate Continue setup action or title arrow. Workspace navigation
belongs to the rail; the account summary does not add a Today at a Glance launch button.

## Accepted navigation revision

[Settings information architecture](settings-architecture.md) supersedes earlier sidebar grouping
and the placement of Reviews in Settings. Use its parent/secondary-page and workspace layout rules.

Settings failures are announced through Sonner, including autosave, validation responses,
queries, native actions, updates, and routine recovery. Keep inline field guidance and retry
controls where useful, preserve edits, and do not automatically retry uncertain writes.
Repeated polling of the same unresolved failure must not repeatedly announce it; recovery
clears its toast. Quiet-hour From and Until controls share a row on larger screens.
