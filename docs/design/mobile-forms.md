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
- `Choice` owns short finite choices. `SearchableChoice` owns entity association selection with
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
Long values truncate in the resting preview. Tapping expands the editing control; blur or Done
returns to the compact row without losing draft changes. Title/description are content fields
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
