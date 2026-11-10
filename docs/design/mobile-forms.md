# Mobile settings-style forms

Parent contract: [Mobile frontend standards](mobile-frontend.md).

This is the shared contract for Expo record editors, preferences, and association controls.
Tasks, Reminders, Lists, and Projects are the first consumers. It supplements the design system;
API contracts and existing ownership/revision rules continue to determine mutation behavior.

## Row anatomy and alignment

A settings row reads as **entity icon (when meaningful) → label → current value → accessory**.
Center all four vertically within the row. Give the label and value bounded, flexible width;
long values truncate in the trigger and remain available in the picker. Labels may wrap without
clipping, and larger accessibility type must grow the row. Use explicit accessible names containing
both the label and current value. Preserve disabled and selected states.

Content cards are a different pattern: their identity icons, task checkboxes and trailing record
actions anchor to the top edge. Do not apply that rule to settings rows. The same entity icon can
therefore be top-aligned on a project card and vertically centered in a Project association field.

## Shared components and geometry

- `TitleField` owns the prominent, growing record name/title input.
- `Field` owns a persistent label and its text input. Stacked labels and multiline notes are one
  field block, not a key/value row; multiline text starts at the top of its input.
- `Choice` owns finite single-selection choices using native popup menus on iOS. `SearchableChoice` owns entity association selection with
  the canonical entity icon, search, selection, cancellation, and a no-results state.
- `ToggleRow` owns label/switch presentation. `DateField` owns the native date/time control.
- `Section`/`Group` own rounded surfaces and inset seams. `FormBody` owns scroll and keyboard insets.
- `styles.settingRow` defines the shared horizontal row geometry: minimum 56 points high,
  16-point padding, 12-point gaps, vertically centered contents. Keep interactive targets at least
  44 points. Use the theme's 4-point spacing scale and 16-point grouped-surface radius.

Icons identify meaningful concepts, not every primitive setting. Resolve entity identities from
`src/product/entities.ts`; List and Project retain their glyph across pages, pickers and editors.
The chevron indicates navigation/selection, not a second action. Do not add overflow menus to fields
that have one clear setting interaction.

## Scan and navigation

Start with identity, then use short named sections grouped by the user's question: due/priority,
scheduling/effort, organization, details, or appearance. Keep related associations together (List
and Project). Optional means the user may leave a field blank; it does not mean the field is hidden.
Do not add Show more, More details, advanced accordions, or collapsed optional-field groups.
A scrollable form is acceptable. Avoid repeated labels, explanatory copy that repeats the control,
and empty sections. Conditionally omit inapplicable fields based on record type or availability.
Searchable picker sheets and overflow action menus remain appropriate for choosing values/actions;
they must not become a way of hiding the form itself.

## State and authority

Preserve drafts while scrolling, opening a picker, or recovering from a conflict. Cancel must not
write. Save waits for authoritative API acceptance and uses existing revision/idempotency rules.
Sonner owns discrete pending/success/error feedback; field labels, permission state, correction
controls, and recovery actions stay in their appropriate sections. Never substitute an inline
success/error banner. Date controls use the account planning timezone; forms have no record-specific
timezone selector.

## Review evidence

Check new/edit variants for each record type; selected and empty associations; long labels/values;
large text; keyboard scrolling; picker search/cancel; disabled/read-only states; and save conflicts.
Visually distinguish row-center alignment from content-card top alignment. Confirm optional fields
are reachable without disclosure and no existing draft or lifecycle action was lost.

## Record identity, tags, and actions

`RecordIdentity` is the common first section for task, reminder, project, and list create/edit.
It presents a growing title and Description together; Description maps to the domain's existing
notes or description property, without duplicating storage. A configurable record icon precedes
the title and opens one appearance sheet for icon and color. Cancel dismisses that sheet without
changing the draft; Done applies to the draft, and the form's Save persists it. Records without
appearance fields use their semantic icon rather than offering unsupported customization.

`TagsField` renders individual removable badges in a wrapping grid with a 44-point plus button.
Adding opens a focused text entry; submit/Add commits a trimmed tag to the draft, Cancel abandons
it. Preserve domain limits (20 tags, 60 characters each), prevent duplicate tags, and allow long
badges to wrap. Do not ask people to enter comma-delimited metadata.

Keep Close/Cancel at the top left and an icon-only floating checkmark Save at the bottom right. Existing-record lifecycle actions
(complete, reopen, cancel record, archive, trash, restore) share the top-right action
control, reachable without scrolling. One action gets its own icon button; multiple actions use
the standard native vertical-ellipsis menu. Header glyphs are centered in their touch target;
content-card action glyphs retain top-right alignment. Record cancellation is distinct from
closing an unsaved draft. Preserve destructive confirmations and API conflict/move previews.

## Examples, compact settings, and action grouping

Use plausible, non-personal sample values as text placeholders, not instructions such as
“What needs doing?” or “Add a description.” Pair examples coherently: “Plan meals for the week”
and “Choose three dinners and make a grocery list.” Keep persistent accessible labels; examples
are never defaults or saved data. Search examples demonstrate a meaningful query.

Setting fields rest in one vertically centered row with the label leading and the value trailing.
Simple short text and numeric values edit directly in the trailing value area without expanding
the row (for example Estimate in minutes). Use an appropriate keyboard. Expand only controls
that need more space; Done returns to the compact row without losing draft changes. Title/description are content fields
and remain visible. Allow rows to grow for accessibility rather than forcing clipping.

Action menus show semantic icons. Put ordinary actions first, then a separated destructive
group at the bottom in red. Cancelling a record and deleting/trashing are destructive; dismissing
a picker or cancelling an unsaved editor is not a destructive record action. Preserve confirmations
and disabled states. Native menus own their section separators and destructive rendering.

## Form session state and Save

Use the shared FormSave floating 56-point glass button, inset from the bottom-right safe area,
with a plain checkmark and accessible “Save changes” label. Reserve scroll space below the final
field; keep the button reachable around the keyboard. Record actions stay top-right.

An untouched form says Close and dismisses without a discard prompt; Save is disabled. Explicit
field edits switch Close to Cancel, require discard confirmation, and enable Save subject to
validation, permissions, pending requests, and conflict safeguards. Merely opening a picker or
loading asynchronous defaults is not an edit. Once edited, the session stays edited even if a
value is changed back. Successful persistence closes the editor; failed saves preserve its draft.

## Tasks view shortcuts

The mobile Browse page promotes Upcoming and History as a horizontal card row above the remaining
view links, using the same visual hierarchy as pinned containers. Do not duplicate these shortcuts
in the list below. Inbox lives under Lists as the default destination for unorganized tasks; omit it from Browse.
Browse exposes Tasks and Reminders independently, plus History, Trash and Archive directly.

Primary page capture actions use a floating plus button with an accessible action name, rather
than a small Add text action in the heading or count row. Hide capture on History and Trash.
Completed task checkboxes use a plain check glyph inside their existing circular container.

Upcoming includes tasks/reminders due or reserved after today. Scheduled filters tasks with a
reserved time regardless of date. Keep these distinct, with short card descriptions explaining
the scope; History shares Upcoming’s prominent row and is not duplicated below.

The Tasks utility tab is named Browse. Keep Upcoming/History prominent, Scheduled in Task views,
Archive/Trash in Storage with distinct glyphs, and Task preferences in Preferences. Omit Add here.
History excludes archived containers; Archive excludes merely completed/cancelled projects.

## Filters and view configuration

Keep one top-right view-options control across list projections and container task pages. Use
Filters to open a focused sheet with compact labeled choices, followed by dates/tags. Do not
insert configuration fields into the result list. Changes preview immediately; Done dismisses
the sheet. Preserve list/project and fixed Tasks/Reminders scope; omit inapplicable type choices.

Sort by and Group by are presentation choices, separate from matching filters. On iOS use native
menu pickers with system selection marks, not check characters prefixed to option text. Describe
choices in user language (Open & completed, Due date, Newest first), never raw enum values. Show
the effective sort/group summary next to the result count, including inherited defaults.

Active overrides/search use removable 44-point chips with readable values and explicit accessible
remove labels. Dates are formatted for people. Reset filters preserves presentation and search;
Reset view returns to the destination's scope and saved defaults. Saving sort/group defaults is
a distinct explicit action with Sonner feedback and existing revision safeguards.


## Selection menus and dates

Finite single-selection settings such as Priority, Mail conversation layout and list density use
one compact label/value row that opens Apple's native popup menu on iOS. Compose the shared
`EnumChoice` (also exported as `Choice`); SwiftUI Menu and Picker own Liquid Glass, placement,
dismissal and adaptive selection marks. Do not expand enum options below the row or recreate the
system popup with a custom glass sheet. Selection updates the visible value through the existing
draft/autosave callback; do not change a screen's persistence or confirmation semantics.

Vertically center the semantic field icon, leading label, trailing current value and accessory.
Use neutral value foreground across workspaces and explicit field metadata for semantic icons;
entity identities still come from the dictionary. Option labels start-align. Native iOS menus use
the platform’s leading selection mark; non-iOS selection dialogs keep checks trailing. Preserve
disabled states and accessible label/current-value names. Non-iOS uses an accessible bounded
selection dialog. Page/view navigation retains its navigation controls;
multiselect, date/time and long searchable entity associations retain their appropriate editors.
This popup contract supersedes the earlier inline-enum expansion guidance.

Use the shared DateField for due dates, reserved time, project targets and date filters. On iPhone,
expand an Apple native inline calendar and, for timestamps, a native time wheel below the row;
Clear removes the value and Done collapses it. Date-only values remain date-only. Use the account
planning timezone for display and conversion, never a record timezone selector. Preserve locale
ordering and system accessibility. Do not add another custom calendar or raw timestamp editor on iOS.

## Undo feedback

Confirmed reversible task/reminder lifecycle actions offer a ten-second Sonner Undo action,
including successful members of a batch. Name the confirmed action; never offer Undo for an
unconfirmed write. Each Undo is consumed once, uses the returned revision/updatedAt, reports its
own pending/result through Sonner, and refreshes results and notification scheduling. A newer
change must cause a conflict, never be silently overwritten; the original API session bounds the
callback. Failed batch members remain selected. No inline action-result messages.

Container transitions can move/archive/complete children: do not advertise a false inverse.
Until the API supports transactional reversal of that whole operation, retain the explicit
confirmation and recovery flow instead of offering Undo. This is a bounded implementation gap,
not an exception to the goal of reversible actions.

References: Apple's [Pickers](https://developer.apple.com/design/human-interface-guidelines/pickers)
guidance favors contextual, predictably ordered selection and provides inline date and time
styles. [Undo and redo](https://developer.apple.com/design/human-interface-guidelines/undo-and-redo)
asks for predictable reversal and visible results. Our native popup choices and Sonner actions
are nohmi's application of those principles, not claims of native UIKit menu or undo-manager behavior.

## Native Settings contracts

Settings uses the account utility navigation tree in [mobile frontend standards](mobile-frontend.md#settings-navigation-target).
Keep root search non-mutating: matching a preference opens its existing destination; it never saves,
creates or grants access. Profile, Security & Access, Connections, Activity Log, Goals & Motives,
Rituals, workspace configuration, Agents and app settings remain separate native-stack children.

Independent preference writes use partial updates and the revision the person reviewed. Serialize
writes shared by sibling editors; a rejection or uncertain result blocks further writes until an
explicit reload/review. Keep the attempted value visible. Do not adopt a remote revision and replay
an unreviewed draft. Dependent Profile, guidance, personal-record, ritual and financial-profile
forms use explicit Save. Preserve their immutable editing baseline and untouched server fields.
The existing Tasks preferences editor also retains one reviewed draft and explicit Save for its
capture, sorting, grouping, row-detail and search controls. This native editor choice does not change
the independent autosave contract of the other workspace preference rows.
Close becomes Cancel after edits; confirm discard and block dismissal during pending writes.
All dismissal paths, including system modal dismissal, use the same guard. Confirmation and a
separate Save reconcile text-policy conflicts; an already-committed result must not produce a
duplicate write. Current implementation gaps belong in the parity matrix rather than being
reclassified as platform exceptions.

Use searchable native sheets for timezone/place choices, the complete bundled timezone catalog
filtered through available DateTimeFormat support, and native time/date controls. Keep the one
account planning timezone; record editors do not create their own. A selected home place retains
its coordinates and adopts its returned timezone. Credentials use secure inputs and remain only
in their pending form; never persist an app-specific password, phone verification code or one-time
agent token in a receipt. Failed writes retain safe drafts; accepted or discarded credential forms
clear their secrets.

Provider setup is an explicit browser handoff when no registered native return exists. Browser
launch is not provider authorization; refresh authoritative connection state on return. Activity
states its latest-100 contract and filters only that loaded history; detail omits private before/after
payloads. iPhone due-alert permission/scheduling and server text-message policy are distinct
capabilities. Sonner owns every discrete action and error, including explicit refresh; successful
background autosaves stay silent. Configuration state and correction controls are allowed inline,
not action-result messages. Device acceptance never proves a visible banner, provider grant,
SMS delivery or background execution.

### Settings hierarchy and color ownership

General Settings uses a neutral ink accent. A workspace's Settings subtree uses that workspace's
accent, including child editors and guidance; Tasks color must not leak through reused controls.
Root workspace destinations have framed identity icons tinted with their own workspace color.
Labels stay leading and values trailing in compact centered rows. Long email addresses, timezone
names and identifiers must remain inspectable through wrapping or the focused editor; missing
artwork reserves its normal icon slot with a semantic fallback, never replacing the label.

Peer views such as Goals, Completed and Motives use a compact horizontal view switcher rather
than a vertical list of form choices. Activity separates compact filters from readable event rows;
metadata and identifiers are disclosed on demand. Connections leads with account identity,
services and actual status, then discloses sync details and consequential account actions.
