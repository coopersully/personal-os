# Settings interaction standards

Detailed rules moved from the `personal-os-frontend` skill. Every rule here is binding.

## Meaningful icons, clear commands, and ongoing standards work

Update the settings standard and frontend skill as accepted refinements emerge;
the user should not need to request documentation each time. Capture the intent
(reduce scanning effort, avoid misleading affordances, keep consequences clear),
not only the latest pixel adjustment. Keep inferred motivations separate from
unapproved design proposals. Challenge proposals when they obscure meaning,
accessibility, authority, or consequences.

Ordinary scalar settings and commands do not need decorative icons. Reserve
leading icons for meaningful identity or special destinations; a framed leading
icon means navigation to a subpage or another page. Provider artwork remains
unframed with the shared optical footprint. This rule concerns row-leading
icons, not page-header artwork or useful input addons such as a clock.

Use concise, explicit labels. A command says what clicking it will do: “Logout”,
not “Session”. Add a short description only when scope or consequences need
explanation. Standard setting labels use foreground, including labels nested
inside FieldContent; descriptions and values use their secondary tokens.

Disruptive/destructive commands use the semantic destructive Button treatment
(red text plus distinct surface/hover), with no decorative leading icon.
Use the shared useConfirmAction flow for dangerous commands: an explicit action
title, concise consequence/scope, Cancel initially focused, a clearly named
destructive confirmation, and focus restored on dismissal. Opening/canceling
must never execute the operation. Use Sonner for outcomes. Match friction to
consequence: logout is reversible; permanent deletion is not. Do not add long
holds or typed confirmations to every disruptive action.

## Settings flatness and summary spacing

Prefer full-width divided rows over nested cards for compact settings records.
Do not add a secondary item surface solely because data is a record. Keep title
and description separate from the trailing value with deliberate whitespace;
truncate previews before they crowd values, and expose full text in details.
See the settings standard for the Goals/Motives trial; do not generalize its
exact preview width to all controls without checking narrow layouts.

Reuse ProfileRow and the existing settings divider treatment for compact record
rows. Detail dialogs place object mutation actions in the bottom full-width footer and keep
read-only metadata separate. Preserve object identity without requiring ornamental
icons or artwork; text-heavy Goals and Motives are valid.

Inactive is not disabled: apply shared reduced emphasis while preserving interaction,
focus visibility, and a textual state cue. Omit default/redundant statuses when the
row appearance or section already explains them. Use labeled shadcn progress in
Goal details; favor labeled footer buttons over unexplained icon controls.

Explanatory subsection headers may use framed icons, titles, and concise purpose
copy above their flat rows. Agent-related copy must distinguish available context
from autonomous behavior or granted authority. Dialogs use the shared elevated
surface/border/shadow. Prefer direct inline numeric editing over arbitrary increment
buttons, using InputGroup with units and commit/cancel validation behavior.


Settings rows expose shared default, inactive, and danger variants. Inactive
means faded content on the unchanged card surface, with unchanged dividers and
geometry; it does not mean disabled interaction. Retain the Paused label and
keyboard access. Danger uses destructive text and the semantic danger surface
for explicit consequential commands. Do not invent per-record background colors.
In-card subsection headers always end with the same full-width 1px border-token
divider (40% strength) as settings rows. Their icon frames use that same neutral
border and a faint neutral background, never a colored accent fill; page headers
retain their separate styling.


## Modal action standard
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


State-changing buttons whose labels switch (such as Pause/Resume) pair their
visible action label with the matching semantic icon. The icon describes the next
action, is decorative to assistive technology, and supplements rather than replaces
the label. Keep compact progress editors to a single label/value row and slim bar;
place layout/control-scope wrappers outside that row so inherited grid rules
cannot accidentally stack the label and value.


Goals uses a small external Goals label above the Active Outcomes and Completed
Outcomes sections rather than a duplicate page hero. Goal detail content follows
Success looks like, Target date, Progress; all three share the same heading
typography and foreground. Use spacing to separate modal content and actions,
not incidental horizontal rules. Preserve intentional row/subsection dividers in
settings lists; this is not a global removal of meaningful separators.

Goals and Motives use matching quiet page labels, framed sections, and editable
detail dialogs. Inline title/context/date edits save on blur or Enter, allow
Escape cancellation, and preserve failed drafts. Keep domain labels meaningful:
"Success looks like" for Goals, "Why it matters" for Motives.


Goals and Motives now share one Settings destination at `?page=goals`, labeled
Goals & Motives, with separate Goals and Motives groups. Legacy Motives URLs
redirect here; sidebar totals include both record types. Both dialogs use the
same inline InputGroup editors with standard focused width/padding and commit
behavior. Prose keeps start alignment beneath its heading. Target dates open a
shadcn Calendar in a Popover, persist local date-only values, and allow clearing.


Completed outcomes live at `?page=goals&subpage=completed-outcomes`.
Keep a quiet, end-aligned navigation button below the Goals card, with the
standard parent back action and sidebar context-menu entry on the subpage.
Settings sidebar glyphs use outline weight when unselected and filled weight
when selected, matching navigation throughout the app.


Rituals is a navigation overview with Morning, Evening, and History subpages
under `page=rituals`, using the shared back action and sidebar context menu.
Export Rituals belongs on the overview and requires confirmation. Each routine
places Delete Data to the left of Preview Morning Ritual/Preview Evening Ritual
below its settings. There is no separate Data subpage.


Ritual checklists use compact flat rows with full-width shared dividers, a
drag handle, concise summary, and a row trigger for the step editor. Do not nest
record cards inside the checklist card. Routine previews are end-aligned buttons
directly below routine settings, not dedicated sections. Omit the read-only
profile time zone from routine settings; scheduling still uses the profile zone.


Ritual step editors reuse compact shared settings fields within the modal,
with destructive Delete at the footer’s left and primary Done at the right.
Deletion uses the shared safe-default confirmation and remains unavailable for
the final step. Sortable rows highlight as one full-width surface using semantic
hover/focus tokens; their text trigger must not add a second pill highlight.
Dragging uses a neutral raised row surface and retains keyboard reordering.


Before settings refinements, apply the accepted motivations/rubric in
`docs/engineering/settings-ui-standards.md`, not just the newest appended example.
Carry durable user decisions into that contract and the page spec automatically;
remove superseded rules. Preserve user intent: flat, compact, predictable,
clearly labeled, safe by default, and visually verified in the relevant states.
Export Rituals requires an explicit neutral confirmation. Routine Delete Data
requires destructive confirmation and sits left of its Preview action.


## Ritual overview and checklist ownership

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


## Binary settings and explicit dependencies

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

Ritual previews focus the first question on opening. Their date trigger offers
seven weekdays via the shared checked menu and evaluates the nearest matching date
in the ritual time zone; do not use a calendar for weekday preview. A brief initial
tooltip explains this trigger without taking focus and dismisses automatically.

Shared Card slots own their padding; do not add a root gap that doubles Header/Content
or Content/Footer spacing. Content removes top padding beside a Header and bottom
padding beside a Footer. Ritual headers place the icon-free date above time at the
trailing edge. Preview weekday hints dismiss once and cannot reopen on selection;
previews omit redundant status copy below the card.

Ritual History uses a compact open search/filter/sort toolbar, bounded week/month
navigation (default this week), flat standard settings rows, and ten-row pagination.
Search/filter/sort on the server before paginating; keep one cursor page in flight,
including for All Time. Lead detail dialogs with latest answers and unfinished steps;
keep individual interaction evidence behind a closed Interaction Log.

Preserve the shared Button size padding on textual menu/popover triggers; do not
strip padding to imitate a text link, since this also collapses hover/expanded/focus
surfaces. Lower-priority utility navigation changes semantic foreground, not hit-area
geometry. Public documents remain accessible while authenticated; root/auth entry
routes send existing sessions to Today, preserving validated protected-link targets.

History filters show filter glyphs: inactive/unfiltered controls use dashed outlines
and plus affordances; active constraints become filled chips ordered before inactive
ones in DOM order as well as visually. Sorting uses its own sort glyph. Summarize
ritual outcomes with required/optional progress and applied snoozes, not raw presses.
