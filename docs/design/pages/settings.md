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
- Rejected autocomplete choices retain their attempted value and associated field error
  through popup closure, blur, and refocus. Announce the error with Sonner; correction
  happens in the visible input, not a hidden native control.
- Settings search opens existing editors without creating records or steps. When a
  conditional field is unavailable, focus the nearest visible controlling setting;
  never focus a hidden control behind a dialog.
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

## Titles and subsection headers

Use title case for Settings page titles, navigation destinations, and section labels
(e.g. Activity Log and Security & Access). Keep field help in sentence case.
Subsection headers provide visual identity, not a place for generic descriptions.
Do not render description-only header blocks inside section cards. Keep meaningful
help beside the setting it explains, and retain the main page header.

## Intent and decision rules

These rules capture the person's stated reasons, not just a screenshot:

- **Make settings easy to scan.** Prefer one concise label and one trailing value
  per row. Avoid forests of open inputs, oversized headings, redundant help, and
  nested cards that make ordinary preferences feel like forms.
- **Make the next action obvious.** Text-like values are still keyboard-accessible
  controls. Direct edits stay in place; searchable shadcn choices open immediately.
  A chevron promises a modal; an arrow promises navigation. Neither belongs on a
  simple selector. Do not add decorative clear buttons to flat values such as Home.
- **Disclose complexity honestly.** A multi-part setup belongs in a labelled modal,
  with meaningful steps, progress, Back, and preserved drafts. Phone is details/
  country/consent, then code verification after sending succeeds. Do not replace
  that with a large inline expansion or a disabled wall of all future steps.
  Simple switches, checkboxes, and radio choices never need their own modal.
- **Use contrast to explain hierarchy.** Header/body/footer share one card surface;
  nested records use a visibly different secondary surface. Primary buttons invert
  the neutral background, buttons are pills, and icon-only card actions are ghost.
  Compact does not mean every element has the same tone.
- **Align identities and values deliberately.** Framed and unframed leading icons
  occupy the same 32px slot. Use real workspace glyphs/colors, provider marks, and
  destination glyphs. Value icons travel with their text at text size; keep values
  right-aligned. Do not substitute invented icons, generic logos, or trailing clocks.
- **Do not require decoration.** Page headers and icons are optional. Keep the page
  introduction on Settings pages; Profile explicitly omits it because its in-card
  identity supplies that introduction. Do not hide headers globally. Use the
  avatar/name/account summary as Profile's in-card identity. Other retained page
  headers use centered solid icons in borderless frames; subsection identity is
  start-aligned. Dividers separate identity headers and settings rows.
- **Keep behavior real.** Preserve server authority, capability restrictions,
  validation, drafts, consent, account boundaries, and existing save timing.
  Generic placeholders must not imply personalized suggestions. Ritual scheduling
  uses the profile timezone, never a competing timezone setting.
- **Support rapid iteration without regressions.** Make changes in shared owners
  used by browser and desktop. Check the changed interactions and representative
  layouts; do not turn every visual iteration into a full release workflow.

The latest decisions above supersede earlier experiments: selectors are autocomplete,
not native dropdowns; Phone uses a stepped modal, not an inline form or all-at-once
modal; arrows and chevrons have different meanings; icons and headers are optional.

## Platform-agnostic settings model

The [System Settings study](../references/system-settings/README.md) informs this model.
Use the interaction principles, not a pixel copy or an assumed Apple implementation.
These are design requirements; the study does not claim every existing screen already
satisfies every rule.

A Settings screen contains **preferences**, **read-only state**, **records**,
**navigation**, and **commands**. Decide which kind an element is before choosing its
appearance. A row that looks editable must actually be operable; a displayed status
must not resemble a disabled input merely because both contain a value.

### Choose the smallest sufficient interaction

| Decision or material | Default interaction | Escalate when |
| --- | --- | --- |
| Independent on/off preference | Direct trailing switch | Enabling requires consent, setup, or approval; use that real workflow |
| Independent selection within a set | Checkbox group | Many records require filtering or a dedicated collection editor |
| A few mutually exclusive choices | Radios or compact single-select group | Differences need visual examples or a concise explanation |
| Larger or searchable option set | Flat shadcn Combobox with current value | Selection involves multiple related decisions |
| Short text or exact number | Trailing value edits in place | Validation depends on several fields committed together |
| Time, location, time zone | Direct typed/searchable editor; show formatted value at rest | Schedule rules, recurring exceptions, or verification create a workflow |
| Approximate continuous quantity | Slider with units/endpoints and accessible value | Exact precision also needs numeric entry |
| Appearance, layout, spatial behavior | Visual choice or meaningful preview | Never substitute a text row when it obscures the effect |
| Effective or inherited state | Selectable read-only value plus concise source if needed | A detail sheet is needed to understand diagnostics |
| Account, device, token, rule, ritual step | Identifiable record row with summary and scoped actions | Detail editing belongs to a subpage or bounded modal |
| Persistent domain of settings | Navigation row with arrow and current summary | Keep a route, parent, Back behavior, and search destination |
| Bounded multi-field task | Modal with clear title and completion/cancel actions | Use steps only for actual dependencies, such as verification |
| Discrete command | Named button, outcome through Sonner | Consequential/destructive commands require their existing confirmation |

Small closed choice sets do not need a search box solely for visual uniformity. Use
shadcn radios/toggle groups for those decisions; searchable selectors remain Comboboxes.
Do not change a preference just by highlighting a menu option, searching, opening a
sheet, or navigating. An explicit selection or established commit event changes it.

### Grouping, geometry, and explanation

- Group rows around one purpose or scope. Use spacing between groups and dividers
  within groups; a card is a coherent subsection, not a frame around every input.
- Keep stable leading labels and trailing controls. Resting icons and values form a
  single end-aligned unit with a small gap. Reserve the icon's width and allow the
  control to grow while editing; do not clip time suffixes, places, or time zones.
- Long values, translations, larger text, or narrow windows may wrap or move below
  the label. One-row layout is the default, not a reason to hide information or shrink
  text. Keep the same reading and keyboard order after reflow.
- Section labels name a group. An optional rich subsection header identifies a real
  object or concept with title and optional icon/avatar. Neither is a dumping ground
  for generic descriptions. Explain only a consequence, constraint, unit, scope, or
  unfamiliar choice that affects the decision, beside that decision.
- Keep hover/focus affordances discoverable. A quiet resting control still has a
  meaningful accessible name, focus ring, keyboard activation, and usable touch target.
  Hover is never required to discover an essential action.
- A disabled dependent setting stays visible with its effective value and a short
  reason where useful. Hide a setting only when it is genuinely irrelevant or not
  authorized, not just because a prerequisite has not yet been filled in.
- Distinguish Off, Not Set, Automatic, Inherited, Unsupported, Loading, and Failed.
  Never display a placeholder/default as though it were a confirmed saved value.
- Show scope when ambiguous: this account, workspace, device, source, or schedule.
  A parent toggle does not erase subordinate preferences; automatic mode may own
  the effective value while preserving a manual draft/override according to domain rules.

### Navigation and editors

Keep sidebar selection, page identity, secondary-page parent, and search destination
consistent. Search reveals and focuses the canonical control; it never creates a
second editor or mutates a value. Restore focus to the invoking row after closing a
modal. A subpage survives routing and browser Back; a modal completes a bounded task
and returns to its context. Use tabs only for peer views of the same subject.

A modal is not automatically a wizard. Use steps when a later step depends on a
completed earlier action, and preserve drafts on Back and failure. Clearly separate
Cancel/discard from Done/dismiss and Save/commit. Never label a button Cancel if the
changes have already been persisted and cannot be rolled back. Retain one-time secrets
until explicitly dismissed; do not reduce them to transient notifications.

## Scope and shared owners

SettingsPageLayout supplies the Settings-only control context. Routed Settings pages
show their centered icon, title, and description card by default. Profile
omits that header, retaining an accessible title, mobile search, and page actions. SettingsSection owns
small external labels and continuous cards. SettingsSelect and SettingsTimeInput compose
shadcn Combobox and retain each feature's native change/form contract; they show at
most six matching options. Settings form fields use compact rows and trailing controls,
with text-like resting surfaces and visible focus treatment. RelatedSettings owns
destination rows. Invitations open a focused creation dialog; iCloud credentials
and service selection use separate modal steps; Texting reuses the stepped Phone editor. Workspace screens outside Settings retain their existing controls.

This applies to Profile, Setup, Connections, Security, Activity, Appearance, Rituals,
Goals, Motives, Calendar, Tasks, Mail, Finances, Connected agents, Workspace access,
Invitations, Sessions, Texting, Desktop, Wallpaper, Pet, and Notifications. Record lists,
history, secret reveal, external authentication, consent, and meaningful visual previews
retain their domain-specific structure; they are not primitive preference rows.

## Layout and navigation

Settings is an account utility with its title and global search in the sidebar
header, without workspace top navigation. Each section uses `SettingsPageLayout`
for consistent gutters and the visible page heading. Profile uses its identity header; Goals & Motives uses compact group labels:
its in-card identity replaces the visible heading; retain an accessible page title
and mobile search. The icon is optional even when the page heading is shown.
Activity keeps its record filter in the page body; settings search does not replace
feature-specific data filters.

Use an Apple-like hierarchy: familiar grouped preferences, clear labels, restrained
semantic surfaces, and progressive disclosure. Use `SettingsSection` (a shared
shadcn Card composition) for distinct decisions, not every individual field.

Use full-width subsection stacks for preferences. SettingsBento now follows the same
stack composition, rather than squeezing a setup group beside a larger editor.
Keep specialized spatial previews (appearance, wallpaper, charts) in their owning
layout when their geometry conveys information. Preserve DOM reading order and let
groups grow with content. Do not force unrelated fields into equal-height columns.

Every persistent content group belongs in a Card, including filters, review queues,
activity history, financial context, and native desktop preferences. Use small secondary labels above cards for section titles and
card headers for optional richer subsection identity. Keep the page introduction above
the cards except for the explicit Profile exception.
Loading, empty, and failure states should stay in their owning group when possible.
Dialogs, toasts, and contextual refresh warnings are not separate bento tiles.

Prefer flat divided rows for compact records inside subsection cards. Use
shadcn `ItemGroup` / `Item variant="secondary"` only when a distinct nested
surface serves an independent grouping purpose:
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

Prefer flat shared settings rows for Goals, Motives, Connections, Sessions, and
Ritual steps. Use secondary Items only when a distinct nested object surface is
needed, not as a substitute for standard rows. Keep summaries compact, reserve
a clear gap before trailing values, and open full record details in a dialog.
Modal actions belong in a full-width footer, not a top-right mutation toolbar.
Goals show circular progress/checkmarks; paused records fade without recoloring
the row. Do not repeat Active or Completed where presentation already explains it.
Date-only values must never shift with time-zone conversion.

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


## Flat settings rows and optional headers

This is the accepted settings standard, developed on Profile and applied through
the shared Settings layout, section, navigation, and control layers to every Settings
route. Feature modules continue to own persistence and workflow semantics. Native-only
settings receive the same composition when rendered in the desktop app.

- Put small, start-aligned secondary section labels above full-width Cards. Cards
  represent subsections, not individual inputs. Divide concise setting rows; keep the
  label at the start and the value or control at the end. Add a short description only
  when the label and value cannot communicate the decision.
- Page headers and their icons are independently optional. When present, the page
  header is a full-width Card with centered title/description and a solid sidebar
  glyph above them in a tinted, borderless frame. Do not require an icon everywhere.
- A subsection may have an identity header inside its Card, start-aligned with an
  avatar or optional framed icon, title, and concise description. Profile omits the
  visible page header and begins with the **Profile** section: the existing avatar,
  name, email, membership date, and quiet brand pattern sit above its setting rows.
- Simple text, numbers, and times are text-like values until activated, then become
  inputs at the same trailing position. No chevron or modal for first/last name,
  email, or simple time entry. Enter or meaningful blur saves; Escape discards the
  draft. Keep a stable label, keyboard activation, focus indication, and normal Tab
  navigation. Do not save unchanged values or issue duplicate writes on Enter/blur.
- Radios, switches, and checkboxes operate directly in their row and show their
  current state. Do not make the person open an editor to use a single control.
- Selectors stay flat and open directly: Home opens its place search, Time zone
  its searchable shadcn Combobox, and Day start/end a shadcn time Combobox in one click.
  Show at most six autocomplete suggestions; accept precise typed times as selectable
  options. Right-align values and place the clock icon before the time. Do not use
  browser-native select/time dropdowns for settings controls.
  Keep control widths proportional to their values, not the full row width.
- Chevrons indicate a modal, never an inline selector. Navigation uses an arrow.
  Home has no clear icon; Time zone has no chevron. Phone has a chevron because
  it opens a modal.
- Phone uses a two-step modal: number, country, and explicit texting consent first,
  then verification code after sending succeeds. Back returns to the first step
  with its draft intact. Keep inputs sensibly sized and preserve verification;
  the existing verified number remains until replacement succeeds.
- Keep dividers between subsection identity headers and settings rows, as well
  as between rows. A complex configuration modal may use Save/Cancel or explicit
  verification actions. Only selected places save; the profile time zone follows
  the chosen location.
- Commit only the edited property. Keep invalid/rejected drafts available, prevent
  duplicate submissions while pending, and use Sonner for failures with field
  correction beside the input. Successful background saves remain silent. Never
  replace unsaved text with a refetch or present a failed write as saved.
- Search reveals the inline editor or complex dialog before focusing the stable
  field target. Workspace and connection rows retain real setup, review, and provider
  health; unavailable reads never look healthy.

### Shared visual rules retained from the refinement

Cards use one continuous surface for header, body, and footer. Nested record Items, when justified by independent grouping,
use the distinct secondary surface in both themes; compact record summaries prefer
flat full-width divided rows with clear separation from trailing values; flat preference rows are Fields
within their subsection, not a stack of secondary record cards. Primary buttons
contrast with the background (dark on light, light on dark); shared buttons are
pill-shaped. Card-header icon actions are ghost; labeled actions are primary.
Selections must visibly distinguish the selected option. Keep optional settings and
rare configuration behind disclosure, and keep form placeholders generic rather
than pretending sample copy is generated from account data.

Ritual presentation remains shared between browser and desktop. See the ritual
sections below for question cards, optional steps, reminders, streaks, completion,
sky animation, and escape controls. Settings-wide control changes must not alter
ritual completion, reminder, or occurrence semantics.

## Accepted navigation revision

[Settings information architecture](settings-architecture.md) supersedes earlier sidebar grouping
and the placement of Reviews in Settings. Use its parent/secondary-page and workspace layout rules.

Settings failures are announced through Sonner, including autosave, validation responses,
queries, native actions, updates, and routine recovery. Keep inline field guidance and retry
controls where useful, preserve edits, and do not automatically retry uncertain writes.
Repeated polling of the same unresolved failure must not repeatedly announce it; recovery
clears its toast. Quiet-hour From and Until controls share a row on larger screens.

## Ritual step configuration

Enabled rituals run automatically over the person's current page while the signed-in browser
app is open. Keep this capability clear in the Ritual view description. The browser uses real
account state; the explicit Show ritual preview remains a separate, non-recording preview.
Browser presentation preserves the underlying page and traps focus until completion, snoozing,
skipping, expiry, or settlement from another client; it does not appear in sign-in or setup. Browser
secondary controls use readable theme foreground over a tinted blurred backdrop; native ambient
chrome remains separate because its wallpaper treatment has different contrast conditions.

The immediate job is to define a realistic morning or evening checklist. Keep the ordered steps
in the existing checklist, with Requirement (Required / Optional) and Include on (Every day /
Weekdays / Weekends / Custom days) beside the step's response configuration. Reveal individual
weekday checkboxes only for Custom days and retain at least one day. Each ritual's schedule group
owns its default reminder time. Changes autosave; failed saves use Sonner and preserve edits.

During a ritual, mark optional steps explicitly and count required progress separately. Show
“Remind me about these later” only in a completion follow-up after Complete is pressed with
unfinished optional steps, with its editable time
beside it and the actual day/time-zone context underneath. Unchecking it must not leave a reminder
request in the completion payload. Preview uses today's scheduled steps and never creates
reminders. History distinguishes optional not done from reminders scheduled or awaiting sync.

Ritual presentations share the same composition across browser delivery, previews, and desktop,
for morning and evening. The raised form card contains the questions and a fixed completion footer; its question area
scrolls only when the available height is exhausted. Streak and seven-day completion progress
form a separate, unboxed group above it. Optional follow-up preferences replace the main form. Snooze and skip confirmations sit outside the
question card. An animated procedural, ordered-dither cloud layer sits behind all content, at very
low opacity in the evening, preserving the existing night sky and opaque question surface.

Ritual progress uses a compact row: a fire glyph and streak number, including zero, at the left, seven
filled/empty completion circles at the right. Omit visible weekday labels and aggregate text;
accessible names and tooltips retain dates, detailed status, and queued provenance. Completion
shows required progress as a translucent left-to-right fill inside the button, with the optional
completion count beneath it. Follow-up controls replace questions until Finish ritual or Go back;
Escape also returns without completing. Show progress and account-sync status only on the main
question screen, hiding both during snooze, skip, and completion follow-ups. Use solid pastel-blue
morning and near-black blue evening skies with dithered clouds, with a subtle radial sun/moon glow fading in over 1.2 seconds. Keep Snooze and Skip for Today at the viewport bottom.

Ritual chrome shares one muted sky-relative tone across streak, completion circles, account status,
brand, and exit actions. Pin the brand to the top and exit actions to the bottom, independently
of form height. Reveal clouds, chrome, card, and staggered questions in a short coordinated
sequence; honor reduced motion without hiding content.

Ritual steps use compact prompt rows with response type, requirement, and scheduled days in
secondary summary text. Expand a row to edit its fields; new steps start expanded. Both rituals
use the profile planning time zone, with a link to Profile instead of a separate time-zone editor.
Existing occurrences retain their original time-zone and answer snapshots when the profile changes.
Ritual answer placeholders describe the input format, without invented personal answer suggestions.
The background can be dragged horizontally to scrub a shared cloud/dither timeline and released
with momentum that settles back to automatic drift. Inputs and card scrolling remain independent.
Skip confirmation places secondary Hold to skip on the left and primary Go back on the right.

Skip and snooze confirmations share a prominent current streak (fire icon, large number,
and days-in-a-row caption), followed by one concise block combining recent action history
and instructions. Both use secondary interruption actions on the left and primary Go back
on the right. Cloud scrolling composites a cached seamless texture once per animation frame;
pointer handlers only update the timeline, and procedural dithering refreshes separately.

Every settings screen begins with a full-width shadcn Card containing its title and description.
A solid icon in a borderless tinted frame sits above the centered title and description,
using the same navigation entry as the sidebar;
workspace settings use their workspace accent. Header actions and mobile search remain available.


Summary rows reuse established identity assets: workspace rows prefix their
titles with the registry glyph in its filled weight and workspace color; connected
accounts use the shared provider BrandMark. Navigation rows use a framed filled icon
matching their destination (Setup, Security & access, Connections). Keep values at
the trailing edge and preserve the distinction between direct selectors and deeper
destination/modal chevrons.


Value icons sit immediately before their text at the same font size (clock for
times, location for Home). Framed and unframed row icons share a centered 32px
slot so their titles align. Use a trailing arrow for navigation to another
settings page; reserve the trailing chevron for a modal.

### Consistent inline input geometry

All scalar Settings editors share `--settings-editor-width` (18rem), constrained
by the available row width. Resting values shrink to their contents and align to
the trailing edge; value icons stay adjacent to the text in that same trailing
unit. On focus, text, email, number, location, time, and time-zone editors expand
to the shared width and use start-aligned editable text. Do not assign widths by
field type or create separate Profile overrides. Narrow rows constrain the editor
and stack only when necessary.

Use shadcn InputGroup addons for leading/trailing icons and actions. Combobox
settings use `settings-value-input` for the same idle/focus presentation. Keep
icons inside the editor with standard padding while editing; do not float them
outside the control. Empty addon slots must not reserve space. Losing focus
restores the compact trailing presentation; visual focus must not change saving,
validation, search, or selection semantics.

### Canonical URLs and subpage Back navigation

Top-level Settings destinations use `/settings?page=profile`. Subpages encode
both their parent and destination: `/settings?page=profile&subpage=setup`.
The `settings-routes` registry owns parent relationships; use `settingsPath`
for links and `settingsRoute` for resolution, including search results. A subpage
must belong to the requested parent. Legacy `section` URLs redirect with replace,
retaining field targets, workspace scope, and hashes. Keep unrelated workspace
query conventions separate.

A subpage places an icon-only Back button at the top-left inside the header Card,
with an accessible “Back to [parent]” label. It links to the canonical parent page,
not browser history. Do not place a second Back row beneath the header.

Inline input geometry is Settings-wide, not Profile-specific. Resting styling
must have lower specificity than focused styling. Only remove padding and add
compact icon gaps while unfocused; selected controls use standard shadcn
InputGroupInput/InputGroupAddon padding. Verify focused location and time controls
in the running browser, not only component tests.

### Compact row rhythm

Simple label/value, input, checkbox, and switch rows share a 48px minimum height
with 8px vertical padding and 32px text-input controls. Do not enlarge checkbox
or switch glyphs to fill the row. Use a 2px title-to-description gap and compact
secondary description text. Center the trailing value/control against the entire
text block, never just its title. Descriptions may grow the row naturally; avoid
fixed heights that clip wrapped text. Inline-edit wrappers must not add another
layer of vertical padding. Apply the same rhythm to Profile and other Settings
pages, with narrow layouts allowed to stack.

Goal summaries use a circular progress indicator with the percentage centered
inside the standard 2rem leading icon footprint. Progress is not repeated as a
trailing value. Goals with completed status appear in Completed Outcomes below
Active Outcomes; the completed section is omitted when empty. This is a Goal
identity treatment, not a requirement for unrelated settings records.

Completed Goal rings show a checkmark instead of a repeated 100% label. Paused
Goals inherit the shared inactive row treatment and retain a Paused cue. Normal
rows omit Active; rows under Completed Outcomes omit Completed. Keep progress
ring edges softly antialiased at the standard icon-frame size.

Goals use explanatory framed subsection headers for Active and Completed Outcomes.
Their descriptions explain user-owned outcomes and context that can be shared with
authorized agents without promising automatic enforcement. Goal dialogs use flat
progress and date controls above full context; clicking the percentage edits an
integer from 0 to 100. Reaching 100 completes the goal; lowering a completed goal
reopens it, while partial edits to a paused goal preserve its paused state.


Settings rows expose shared default, inactive, and danger variants. Inactive
means faded content on the unchanged card surface, with unchanged dividers and
geometry; it does not mean disabled interaction. Retain the Paused label and
keyboard access. Danger uses destructive text and the semantic danger surface
for explicit consequential commands. Do not invent per-record background colors.
In-card subsection headers always end with the same full-width 1px border-token
divider (40% strength) as settings rows. Their icon frames use that same neutral
border and a faint neutral background, never a colored accent fill; page headers
retain their separate styling.


### Modal action standard
Modal actions live in a full-width bottom footer: equal-width buttons in a grid,
or one full-width button. Use explicit text labels; do not hide object mutations
in a top-right icon toolbar. Order actions by promotion from left to right, with
one recommended primary action on the far right. Goal/Motive details use Delete,
Pause/Resume, Close in that order (omit unavailable actions).
Dangerous actions are never promoted: use the quiet destructive treatment on the
left and primary Cancel/Go Back on the right. Focus the safe action when opening
a destructive confirmation, explain the consequence, and preserve Escape and
focus return. This supersedes the earlier top-right object-action trial.
Apply the same promotion ordering throughout the app. The shared DialogFooter
provides equal-width geometry; callers own semantic order and variants.


Goals uses a small external Goals label above the Active Outcomes and Completed
Outcomes sections rather than a duplicate page hero. Goal detail content follows
Success looks like, Target date, Progress; all three share the same heading
typography and foreground. Use spacing to separate modal content and actions,
not incidental horizontal rules. Preserve intentional row/subsection dividers in
settings lists; this is not a global removal of meaningful separators.


Goals and Motives now share one Settings destination at `?page=goals`, labeled
Goals & Motives, with separate Goals and Motives groups. Legacy Motives URLs
redirect here; sidebar totals include both record types. Both dialogs use the
same inline InputGroup editors with standard focused width/padding and commit
behavior. Prose keeps start alignment beneath its heading. Target dates open a
shadcn Calendar in a Popover, persist local date-only values, and allow clearing.


Rituals has a navigation overview and three canonical subpages: Morning,
Evening, History. Keep their URLs, search destinations, parent back actions,
and right-click navigation consistent with the shared settings hierarchy.
Sidebar icons use outline when inactive and filled when active across the app.


### Ritual overview and checklist ownership

The Rituals overview contains separate Morning Ritual and Evening Ritual sections.
Each uses the shared framed subsection header with a short explanation of its purpose,
then compact rows for enabled state, available-from time, and reminder time. The final
row navigates to that routine's Checklist subpage. Delete Data and Preview Morning/Evening
Ritual sit below the respective section, right-aligned with deletion on the left.
The routine subpages contain only editable checklist rows and their step dialogs;
do not duplicate schedule controls or preview actions there. History remains a separate
subpage, and confirmed Export Rituals stays on the overview. This supersedes earlier
placement of schedule and data controls on the routine subpages: everyday configuration
should be visible together, while detailed checklist editing gets its own focused space.


### Binary settings and explicit dependencies

Use the shared Switch for all binary on/off preferences, including permissions,
visibility, enablement, and consent. Checkboxes remain appropriate for completing
tasks or selecting members of a multi-select set (such as specific weekdays).
Keep dependent settings visible and retain their values when their prerequisite
is off. Disable editing, fade the controls and labels, and provide a keyboard-
accessible tooltip naming the prerequisite and how to enable it. Never imply
that a disabled dependency is missing configuration or silently clear it.

Ritual overview headers explain that the ritual covers the screen at its scheduled
time, its morning/evening purpose, and the available snooze/skip escape. Show the
current streak and seven dated completion indicators using the shared domain logic.
Call the editable collection “Steps,” because it includes actions and questions,
not only checkboxes. The bottom navigation row opens the routine's Steps subpage.

Ritual subsection headers include a small decorative sky thumbnail on the right,
using the actual morning/evening sky tokens, procedural clouds, and glow with a
blank miniature card with decorative content and button blocks. The 16:9 thumbnail
is a single accessible button opening the full preview. Hover and keyboard focus blur
the miniature and reveal a centered Preview label; no separate Preview Ritual button
is needed. These blocks are decoration, not real tasks or nested controls.

Ritual header thumbnails align to the top trailing edge. Header progress uses compact
icon summaries (“0-day streak” and “7 days”), with the completed-day count in the
week badge tooltip. Full previews replace the normal completion footer with an
always-available Close Preview button; omit duplicate bottom links and corner X.


All settings separators use the same shared divider token and one-pixel treatment:
subsection header, ordinary row, navigation row, and dependency boundary. Never stack
a row separator with a wrapper border. Disabling content must not fade its divider.
Directly nested dependent rows indent their contents by one extra spacing step while
their separators remain edge-to-edge. Ritual headers use their trailing preview as
the visual anchor and omit the leading icon; the title and description stay in-card.
Thumbnail sky dragging must not accidentally activate preview on pointer release;
an ordinary click or keyboard activation must still open it.

Ritual cards share a morning/evening greeting, current local date and time, and compact
completed/total counts for all steps, required steps, and optional steps. Full previews
allow choosing a weekday from a checked menu, filter steps by its nearest date’s
schedule, and reset local answers when switching dates. Preview exploration never
writes occurrence history or account responses.

Keep ritual card orientation compact: personalize the greeting with the profile’s
first name, align the quiet date/time beside it where space permits, and put
completed/total, required, and optional counts in one secondary summary line.
Allow narrow layouts to wrap naturally rather than crowding the greeting.

Preview weekday selection is a seven-option checked menu, not a calendar: use the
nearest matching weekday to today in the ritual time zone to evaluate step schedules.
Focus the first question when rituals and previews open. Show a short, automatically
dismissing tooltip on preview opening explaining that the date changes the weekday;
keep this instructional hint from taking keyboard focus.

Ritual date and time sit at the trailing edge, date above time, without icons.
Preview hints appear once per opening and cannot reopen on weekday selection;
omit the redundant visible “Preview only” status beneath the card.

Ritual History uses an open search/filter/sort toolbar above a configurable table (stacked records on mobile),
not a separate card of filter settings or nested record cards. Default to the current
Monday–Sunday week in the profile time zone; allow week/month selection and adjacent
period navigation. Each row summarizes ritual, date, completed steps, and status, with
the non-interactive area of each row opening the answer/activity dialog and a full-width Close footer action. Nested controls retain independent actions; the primary button supports keyboard access.
Search (including answers), status filtering, and sorting run on the API before
bounded cursor pagination (ten rows by default). Keep one page in flight rather than fetching the entire
history; All Time is available without a date constraint. Reset pagination when
criteria change, and distinguish an empty period from no matches.

History filter controls use a leading filter icon. Unfiltered values (Both Rituals,
All Statuses, All Time) are dashed, quiet triggers with a plus affordance; selected
constraints become filled chips and move before inactive controls in both visual
and keyboard order. Sorting uses a separate sort icon and does not masquerade as
a filter. Default to This Week while allowing the period filter to be cleared.

Ritual history emphasizes outcomes over interaction telemetry: summarize required
and optional progress separately, count only confirmed/applied snoozes, and preview
a submitted written answer when available. Detail dialogs show the latest answer
or Not done for every scheduled step, including unfinished required steps. Preserve
the complete saved-response/button-press evidence under Interaction Log, closed
initially, so drafts/cancellations do not read as successful actions.

## Flexible data views and filter controls

Use shared `FilterTrigger`, `FilterChip`, `SortTrigger`, `DataChoice`, and `FilterBar`
from `components/data-view-controls`. Dataset filters have a leading filter glyph;
unconstrained defaults are quiet dashed triggers with a plus, applied constraints are
filled secondary chips. Applied filters precede inactive controls in DOM and keyboard
order. Sorting has its own glyph and radio menu; it is not an applied filter. Keep
view switches, grouping, and default-setting editors distinct from dataset filters.
Existing advanced forms retain draft/apply behavior and domain-specific choices.

Bound toolbars rather than adding an unlimited horizontal strip: show a small set
(two on mobile, five on desktop), then a searchable More Filters dialog/drawer.
Retain full accessible names when visible labels truncate. Long option sets need a
searchable combobox; short mutually exclusive lists use shadcn radio menus. This
shared treatment applies to Tasks, Finances, Reviews, Today, workspace search, and
Calendar/Mail account-source filters. Preserve their URL and saved-preference contracts.

Use `components/data-table` for configurable record views. Ritual History is its
first consumer: desktop has shared shadcn table anatomy and full-width row dividers;
mobile has labelled stacked records with the same fields and detail actions. Offer
column visibility/order/width, density, wrapping, and reset through Table Options.
Persist only layout preferences on the device, scoped by account. Table configuration
must not mutate underlying records or reduce audit evidence to editable generic CRUD.

Keep search/filter/sort on the server before cursor pagination. Reset cursors when
criteria or page size changes; request only a bounded page (10/25/50/100 for history).
Do not imply that sorting the loaded page sorts the full dataset. Selection and CSV
export explicitly cover the current page or selected rows on that page, use visible
columns in their chosen order, and escape spreadsheet formula text. Keep history
answers and interaction evidence accessible through row details, with outcome,
required/optional completion, and confirmed snoozes available as separate columns.
Do not promise arbitrary unlimited data in the browser: bounded requests, responsive
filter overflow, and local table scrolling are the scaling contract. Background layout
saves are silent; storage/download failures and download initiation use Sonner.

Keep record-table chrome outside the table surface: a quiet contextual caption and
secondary overflow menu sit above the card; the card begins with column headings.
Put Export and Table Options in that overflow menu rather than exposing parallel
buttons. Selection actions appear only after selection; select-all lives in the
table header (mobile offers Select Page in the menu). Show the result range once
in a compact pagination footer alongside page size. Avoid repeating row counts or
creating a second header band inside the table card.

For compact record toolbars, keep the shrinking search input, one Filters trigger
(with an applied count), and an icon-sized Sort trigger on one row, including mobile.
Use `FilterBar collapsed` to put all criteria in its searchable responsive dialog.
Table Options must fit the dialog width; allow vertical scrolling only, shrink
labels/controls, and never require horizontal scrolling for configuration.

Reorderable lists use the shared `ReorderHandle`: the same leading grip glyph,
ghost button, grab/grabbing cursor, and handle-only pointer/touch drag. Up/Down
arrow keys on the focused handle provide the equivalent reorder action with bounds.
Use Motion Reorder groups/items with quiet shared drag-state treatment, preserve
input/row-action interactions, and avoid separate up/down action-button pairs.
This list pattern does not replace spatial event dragging in the calendar.

Mobile table records need a distinguishing title, not just the desktop first-cell
label. Combine the object name with meaningful identity context such as its date;
keep that title first even when desktop columns are reordered. Avoid repeating
title metadata as a separate field. Ritual History uses “Evening Ritual · date”
above four default details: Status, Required, Optional, Snoozes. Extra configured
columns remain available. Desktop keeps the ritual name and date in separate columns.
Use DataColumn `mobileCell` and `mobileHidden` for this domain-owned presentation.

When dataset actions sit beside a search field, append them inside its shadcn
InputGroup using `SearchDataControls` (inline-end addon and InputGroupButton).
Use icon-only triggers with full accessible names/tooltips, an applied-filter count,
and a secondary selected treatment for a non-default sort. Avoid separate floating
pills, repeated borders, or another toolbar row. Filter dialogs keep readable labels.
This follows the app’s existing Calendar and Settings input-addon action pattern.

Tables default to Compact density. Desktop cells use small consistent vertical
padding and grow for actual wrapped content; never stretch rows to fill the page.
Mobile records keep a distinguishing title above a tight two-column detail grid;
in Compact density, short labels and values share a baseline rather than consuming
two lines per field. Omit duplicated metadata, keep long text bounded with details
accessible, and retain Comfortable spacing and wrapping as explicit user choices.
Density must preserve readable labels, meaningful identifiers, keyboard focus, and
usable touch targets; it does not mean shrinking type or removing necessary context.

Column reordering uses rounded shadcn Item anatomy with a quiet secondary surface
for hover/focus/drag, preserving text color and avoiding bright rectangular inversions.
Never use a foreground/content token as a dragged-row background. Compact mobile
status cells may use `CompactStatus` glyphs, retaining a label on tap/focus and an
accessible name; desktop retains text badges. Counts use `CompletionCount`: the
completed and total use the same normal text size and color.
CSV values remain plain ratios and full status labels.

Treat mobile table rows as composed records, not wrapped desktop columns. Build an
identity block with a prominent name and subordinate distinguishing context (date,
account, or identifier), then cluster related facts in a deliberate reading order.
Keep each short label close to its value; avoid distributing unrelated facts across
a grid solely because they were adjacent columns on desktop. Use `mobileOrder` for
domain-owned grouping while preserving desktop column ordering and visibility.
Ritual history groups Required + Optional completion first, Status + Snoozes second.
Keep the title/date together and omit repeated metadata. In progress ratios, make
completed and total the same normal text, separated by a spaced slash. Compact
density minimizes unnecessary spacing without flattening identity and detail into
one undifferentiated line.

Search action sections and filter forms: keep filter and sort in separate appended
sections divided from the search input and one another. Use standard action-count
badges for active filters/non-default sorting; no inline count text or standalone
floating pills. Filter dialogs use the standard search InputGroup above flat Settings
Field rows with full-width dividers and plain end-aligned values; avoid filter-chip
controls inside the form itself. Mobile metadata uses consistent text size/line height
and a predictable value column per group. Completion ratios are plain “done / total”
text without different sizes, colors, or weights within the ratio. This replaces
earlier experiments with subordinate denominators and undivided search actions.

Search action dividers use the surrounding body/background color. Count badges
are circular and paint above dividers and every button hover/focus/selected surface;
never clip them at input or action boundaries. Keep hover and keyboard focus visible
without covering the badge. Every sort option has a direction/field icon; filter
options get domain icons when meaningful (dates, morning/evening, statuses). Filter
value triggers retain standard horizontal padding in idle, hover, focus, and open
states; plain text styling is not zero-padding button styling.

### Ritual History state treatment

Apply the data-page state/recovery contract in `../system.md`. Search and Filters remain
available when history has no matching rows; omit Sort, table chrome, pagination/page size,
and empty result counts. Distinguish a filtered result, an empty date range, and confirmed
All Time absence. “Show all history” clears only query criteria, not ritual data or saved
layout. All Time absence offers no invented create-history action. Keep a previous-page
escape when a later cursor page is empty.

Loading uses bounded shared skeleton rows. Initial failure shows history availability and
Retry, with the error announced once through Sonner. No duplicate inline error message or
empty-success message. Failed refresh preserves valid last results without inserting a new
row or banner; use Sonner with Retry and retain existing refresh/scope controls. Account-wide
non-authentication read failure uses the shared non-dismissible recovery dialog until confirmed
success, as specified in `../feedback.md`. Recovery keeps the criteria and restores the table; no destructive action is part
of empty/error recovery. Use `DataViewEmpty`, `DataViewLoading`, and `DataViewRecovery`.

Settings collection states now share `data-view-state` across Ritual History, Goals,
Motives, Completed Outcomes, Activity Log, Connections, Calendar Sources, Invitations,
Signed-In Devices, and Connected Agents. Mail account/rule absence uses the same Empty
anatomy. Keep domain-specific creation/navigation and permission gates; do not invent
creation for audit history or devices. All Time history retains a visible scope caption
and This week action. Profile account summaries retain independent query recovery.


### Native subsection information and compound values

Keep general how-it-works guidance in the subsection identity header, with a standard
neutral framed icon and the canonical full-width divider. Actionable OS permission setup
is the first setting row: a concise label, readable current state, and a modal chevron.
Its guided dialog groups permission instructions, presentation checks, native settings,
and test actions. Refresh on opening and returning from macOS, and offer an explicit
recheck. Do not request OS permission just by opening the guide. Tests become available
only after permission is granted; OS acceptance does not prove a banner appeared.
Action results remain Sonner feedback; persistent permission state stays in the row/dialog.

Grouped source records use account identity headers and flat rows, never cards nested
inside a row card. Keep provider identity aligned in the shared icon slot, descriptions
bounded before independent trailing controls, and inactive records faded on the same
surface. Color values use a compact swatch/value trigger and a bounded shared picker
popover with focus restoration. Server selection remains an explicit tested Connect
flow even when its controls are flattened, because changing it signs the user out.


Settings page introductions are omitted globally: breadcrumbs identify the page and
its first section begins the body. Preserve useful section and field descriptions.
Security's Log out is a full-width `ProfileRow` in the danger variant with a trailing
chevron and the existing safe-default confirmation. Keep pending/error feedback in
Sonner and preserve the existing web/native session reset behavior.

Mobile account navigation uses Account, Personal, Workspaces, and App section landing pages. Each reuses the sidebar permission rules, attention indicators, and destination rows; the active child keeps its owning app-bar section selected. There is no generic More drawer.
