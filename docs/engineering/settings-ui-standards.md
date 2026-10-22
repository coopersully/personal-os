# Settings UI Standards

Settings is a control surface for a person’s persistent preferences, access, and connected capabilities. Keep each screen calm: show the decision that matters now, explain a constraint where it occurs, and keep rare tuning out of the initial scan.

Use the accepted [settings architecture](../design/pages/settings-architecture.md) for navigation
and parent/secondary-page placement.


## Accepted motivations and review rubric

These rules capture the iterative design decisions with Cooper. Apply them while
implementing; update this contract and the frontend skill whenever a durable
decision changes. Resolve superseded guidance rather than preserving contradictory
instructions. The latest explicit user decision governs.

- **Density without obscurity:** settings take the space they need. Single-row
  preferences, text values, and commands share a 48px row. Descriptions sit close
  to their titles; trailing controls center against the whole label block.
  Use short, specific titles, title-case page/section names, and descriptions only
  to explain a consequence or constraint. Never use a description as a subsection.
- **One continuous surface:** card headers, bodies, and footers match. Standard
  rows and in-card subsection headers share full-width 1px semantic dividers.
  Subsection icons have neutral bordered frames. Modal sections use consistent
  headings and spacing instead of incidental rules. Nested cards are not the default.
- **Predictable editing:** flatten simple values until focused; reuse shadcn
  InputGroup/Combobox/Calendar, standard 18rem focused width and addon padding.
  Resting values and their icons hug the trailing edge; prose editors can retain
  start alignment under a heading. Search large option sets; show a bounded list.
  Save meaningful changes immediately, cancel with Escape, retain failed drafts,
  and never hide unrelated dependent settings. Multi-step decisions belong in
  a focused modal, not a sudden expansion of the page.
- **Meaningful symbols:** plain settings need no decorative icon. Framed leading
  icons identify destinations; provider marks reserve the same optical footprint.
  Workspace identity uses the actual registry glyph/color. Sidebar glyphs are
  outline until selected, then filled. Modal chevrons and page-navigation arrows
  remain distinct. State-changing buttons pair their action label with an icon.
- **Safe action hierarchy:** actions are labeled buttons in an equal-width modal
  footer (one action fills the width). Promotion increases left to right. Dangerous
  actions stay quiet/red on the left, with primary Cancel/Go Back on the right and
  initially focused. Neutral confirmations such as export put Cancel left and
  the explicit confirmed action right. Never execute on opening or cancelling.
- **Progress without noise:** inactive rows fade without changing their background
  or divider. Paused remains inspectable/resumable, not disabled. Dangerous,
  inactive, and default are shared variants, not per-screen styling inventions.
  Compact summaries must not collide with values; full prose belongs in details.
- **Stable navigation:** use `page=parent&subpage=child`, a top-left header back
  control, and a parent icon with a smaller child icon. Right-click menus carry
  the parent label and list subpages. Keep search, aliases, and sidebar counts in sync.
- **Evidence and scope:** inspect resting, focused, open, paused, and narrow states
  proportionately. Automated checks do not prove visual quality. Record unresolved
  design questions separately; do not invent broader product rules from an untested
  local treatment. Preserve platform behavior and real persistence authority.
- **Ritual ownership:** profile owns time zone; routine pages omit the read-only
  duplicate. Morning/Evening own their Delete Data confirmation, immediately left
  of the preview action. Overview owns confirmed export; History owns entries.
  Explain that deleting routine data deletes the definition, answers, and history.

## Ownership and placement

- Give every setting one canonical editing surface.
- Edit account-wide identity, security, privacy ceilings, review bypass, shared notification policy,
  channel connections/defaults, connected-agent credentials/scopes, and User Knowledge controls
  in centralized Settings. Reviews is domain-owned operational work in the
  [workspace Reviews flow](../design/pages/reviews.md), opened from the workspace attention alert
  or its Settings header, and also reachable from workspace search; it is not an account
  preference or a separate Today queue.
- Edit sources, source meanings, maintenance behavior, notification overrides, rules, learning,
  recovery, data controls, and domain access posture inside the owning workspace.
- Let centralized Settings summarize cross-workspace health, readiness, effective policy, override
  presence, and outstanding review counts, then deep-link to the exact workspace control.
- Never render a second editable copy of workspace-owned configuration. A summary may refresh after
  returning from the workspace, but it does not maintain parallel form state.

## Flat rows and progressive editing

Follow [Flat settings rows and optional headers](../design/pages/settings.md#flat-settings-rows-and-optional-headers).
This direction is shared by every Settings route through SettingsPageLayout, SettingsSection,
RelatedSettings, and the scoped settings controls.
Use small secondary labels above subsection Cards, compact divided rows, and trailing values.
Simple values edit in place without chevrons; radio/switch/checkbox controls operate directly.
Use dialogs for complex configuration, not a single primitive input. Phone opens a stepped modal: phone, country, and consent first, then code verification.
Chevrons indicate modals; arrows indicate page navigation. Inline selectors have neither. Home has no clear icon. Make page headers and icons independently
optional in the component API; keep page headers visible by default. Profile
uses its identity header inside the first Card instead.

Keep stable field IDs and Settings search reveal paths. Preserve drafts on failure, suppress
unchanged/duplicate saves, support Enter/blur commit and Escape cancellation, and keep keyboard
focus and normal Tab behavior intact. Update the page contract and frontend skill together when
this pattern changes; do not duplicate a new competing design specification.

## Feedback

All settings errors and discrete action results use Sonner, including query errors and
autosave failures. Use one loading toast updated to the confirmed result for asynchronous actions.
Successful background saves are silent. Keep correction text and retry controls beside fields,
but never duplicate action results in an inline Alert, paragraph, banner, or status row.
Actual configuration, permission state, and consent requirements may remain inline.
See [Feedback](../design/feedback.md), which takes precedence over generic Alert advice.

## Forms & choice sets

- Use `FieldGroup` and `Field` for forms; use `FieldSet`, `FieldLegend`, and `FieldDescription` for related choices.
- Give every logical group a visible label and keep peer groups separated with a consistent 16 px divider or gap.
- Use a consistent selection treatment within a decision: radio cards for choices that need explanatory copy, and `ToggleGroup` for compact 2–7 option choices.
- Use the same card treatment for appearance choices that carry equal weight. Do not mix a card selector with an unframed row selector without a clear complexity reason.
- Persist only on an explicit save when multiple fields form one decision. For a single immediate setting, commit in place, retain the draft on failure, and announce the error through Sonner.

## Disclosure & availability

- Keep the default view to the core setup, the primary action, and the preview or outcome.
- Put infrequent tuning, verbose scope checklists, and historical records in a labelled `Collapsible`.
- Do not render an action that cannot work on the current platform. Show an informational capability callout only when the user can still complete useful preparatory work.
- Do not render restricted navigation or settings to users without the corresponding capability. Redirect a deep link to a safe, available settings section.
- Setup sequences use labelled disclosures with a persistent status summary.
  Derive completion from durable or externally observed product state; never
  use a manual checkbox for a step that the product can verify. State the
  evidence boundary when the product can observe a successful check-in but
  cannot inspect a third-party host directly.
- After an agent has authenticated, the server-owned setup plan determines the
  current, blocked, and complete step. Ask the person only for unavoidable
  connection, unresolved preferences, and consequential approval. Skill
  installation instructions and procedural prompts are optional compatibility
  details, not required steps or a second source of setup state.

## Connected-account health

- Browser authorization returns render one allowlisted Sonner outcome from an authenticated attempt
  lookup. Remove only `connection_attempt` and `connection_result` from the URL after lookup, keep
  the active Settings section, and offer at most one recovery action. Cancellation, expiry,
  incomplete permission, provider failure, and unknown state never render provider text or a JSON
  response.
- Render only the structured account health state: **Ready**, **Syncing**, **Retrying
  automatically**, **Reconnect required**, or **nohmi is resolving this**. Never render a raw
  provider exception or response.
- A manual sync result is a toast; the durable account row remains the persistent truth. Always
  refresh account and material queries after the attempt, including failure.
- Show a reconnect action only for the `reconnect` state. Google restarts OAuth for that account;
  iCloud opens the app-specific-password form with the account email already selected.
- Retry and service-attention states explain ownership and timing without blaming credentials.
  Mail and Calendar use a warning callout only when a person must reconnect.
- Refresh health every 30 seconds while a relevant view is mounted and visible. Browsers never
  initiate provider sync on a polling interval.
- X follows the same rule: persisted and displayed synchronization failures use nohmi-authored copy,
  never an exception message from the provider or SDK.

## Security & agent access

- Start an access-token flow with a named preset and selected-scope count.
- Keep detailed scopes collapsed until the user chooses to refine them.
- Keep active credentials visible; collapse revoked credential history by default.
- Secrets that are shown once stay inline until dismissed, because a toast is too transient for copy-once material.

## Sources

These choices follow the W3C guidance to reserve alerts for important, non-interrupting status changes and to avoid automatically dismissing critical content, plus progressive disclosure guidance for hiding advanced controls until needed. See the [WAI-ARIA alert pattern](https://www.w3.org/WAI/ARIA/apg/patterns/alert/), [WCAG status messages](https://www.w3.org/WAI/WCAG21/Understanding/status-messages.html), [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/), and [shadcn’s Alert and Sonner documentation](https://ui.shadcn.com/docs/components/radix/alert).

## Shared page composition

Use the [Settings page contract](../design/pages/settings.md) for layout and search.
`features/settings/settings-layout.tsx` owns the page introduction, section card,
and responsive subsection stack. The shell mounts no workspace app bar on `/settings`.
Search lives in the sidebar header (page heading on narrow layouts), covers all
available sections and individual fields, and shares navigation visibility rules.
Add field labels, aliases, and stable destinations to `settings-fields.ts` with each
new preference. Search may reveal UI and focus controls, never mutate their values.
Domain modules retain
ownership of their fields and save behavior.

## Typed composition and ownership model

Use the [platform-agnostic decision table](../design/pages/settings.md#platform-agnostic-settings-model)
and [reference observations](../design/references/system-settings/README.md). This is an
architecture direction for extending the existing React/shadcn implementation, not a
claim that a new schema renderer has shipped, or that Apple internals were inspected.

1. **Navigation shell:** owns sidebar grouping, selected route, parent/Back, page
   identity, platform/permission visibility, and search reveal/focus. Stable setting
   IDs and aliases connect search to the canonical domain surface.
2. **Page and group composition:** owns spacing, title/identity, divided surfaces,
   responsive reflow, and label/value alignment. Layout must not infer persistence
   from DOM selectors or a CSS class.
3. **Typed row composition:** explicitly distinguishes value, choice, switch, status,
   record, navigation, and action. Reuse shadcn primitives and semantic slots for
   label, optional help, value/control, identity, and actions. Do not turn generated
   UI primitives into feature-specific persistence controllers.
4. **Editor/workflow:** owns temporary drafts, validation, focus, commit/cancel,
   step transitions, and pending/retry behavior. A modal boundary alone does not
   determine whether writes are immediate or transactional.
5. **Domain adapter:** owns reading/writing canonical state, validation contracts,
   authority, capabilities, consent, versioning, server errors, and cache refresh.
   Presentation cannot turn a permission change or rule approval into an ordinary
   autosaved boolean. Browser and desktop use the same domain semantics; platform
   adapters expose genuine native capabilities instead of duplicating settings.

For each setting, identify its stable ID, scope, saved value, effective value/source
(if different), editor kind, commit policy, validation, availability/reason, and domain
owner. These are design questions and typed component contracts, not a requirement
for one giant JSON configuration or a new global settings store. Extend existing
owners incrementally. Prefer explicit composition over CSS that guesses behavior
from arbitrary descendant input types.

Use a predictable edit lifecycle: saved → editing → validating → saving → saved or
recoverable error. Cancel restores the prior draft/value only where cancellation is
supported. Prevent duplicate commits on Enter/blur, stale responses overwriting newer
edits, and cache refresh erasing dirty drafts. Multi-field atomic decisions need one
explicit commit. All actual writes remain authorized by the domain/API.

Focused acceptance includes long values and 12-hour suffixes, narrow layouts and
larger text, icon/value alignment at rest and in edit mode, keyboard and focus return,
exact option values, unchanged/canceled edits, disabled/inherited states, failed saves,
search reveal, and platform limits. Exercise the changed cases; do not rerun a release
suite for each spacing refinement.

### Shared implementation

Settings pages opt into `SettingsControlsContext`. Settings-owned forms import
`Field` from `components/settings-field`, which explicitly marks preference rows;
layout must not infer setting semantics from descendants or input types. Use
`layout="stack"` for a deliberately composed editor. Dialog content retains its
normal form layout. Keep this presentation wrapper outside generated shadcn Field.

The Settings select adapter preserves the existing change/form contract: up to
six options use a checked menu, larger lists use searchable Combobox suggestions.
Opening or searching never persists a change. Time inputs use the shared time
picker. Controls outside Settings keep their existing behavior. Preserve domain
save boundaries, revision handling, disabled states, and Sonner delivery.

Ritual steps are compact sortable records with bounded modal editors; their
reordering and autosave semantics remain domain-owned. Goals and Motives retain
record lists and creation dialogs. Appearance previews, connector identities,
permissions, and credential workflows retain their purpose-built content inside
the shared page/section hierarchy rather than being coerced into scalar rows.

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

Leading settings icons use `SettingsIconSlot`: a transparent, nonshrinking 32px
footprint. Direct unframed artwork is centered at 16px, matching the glyph inside
a framed destination icon. The invisible footprint is required even for provider
logos; do not use the artwork's intrinsic width to position the title. Visible
frames remain optional and brand artwork stays unmodified.

Subpage header artwork preserves the parent page icon and appends a smaller
subpage glyph at its bottom-right. Keep the title specific to the subpage. The
sidebar's context menu exposes available direct subpages, using the same parent
registry, canonical links, and permission filtering as normal navigation.
Collection pages such as Goals and Motives show saved-record counts; omit counts
while unavailable rather than presenting an invented zero.

Security actions follow the same compact row anatomy. Password and Session rows
open bounded dialogs for reset-link delivery and logout, respectively. Opening a
row must not send email or end a session. Keep mutation outcomes in Sonner.

### Row-card composition and alignment

- Use `SettingsSection layout="rows"` for settings and navigation row collections.
  The Card and CardContent have zero padding and zero gap; each row owns its 16px
  horizontal inset and 8px vertical inset. Dividers reach both card edges. Never
  put a padded card around an already padded row. One single-line row is 48px,
  whether it contains text, a checkbox, an input, or a navigation action.
- Use the content layout only for rich previews, record editors, and explanatory
  content, not to wrap ordinary preference rows.
- Every leading icon uses the same 32px SettingsIconSlot, including provider
  artwork without a visible frame. Navigation row padding must not change when a
  nested status badge has an inline icon. Check actual icon centers and label
  positions, not only nominal icon dimensions.
- Settings navigation context menus begin with the parent page title using
  ContextMenuLabel and ContextMenuSeparator.
- Independent choices persist on change, without a Save button or success toast.
  Disable a pending choice group to prevent overlapping writes; preserve the
  draft and surface failures through Sonner with a retry path.

### Visual audit rubric

Inspect populated, empty, unchecked, long-label, and lower-page states. Do not
place a full-width settings row inside a multi-column field grid: either stack
the rows or use an explicitly stacked form within a bounded editor. Check the
actual bounds of checkbox and switch glyphs; generic row CSS must not override
their intrinsic width. Compact select triggers align themselves to the end of
the reserved value column. Empty editable scalar values must remain discoverable.

Record coverage by route and distinguish inaccessible/native-only states from
verified pages. The October 2026 [visual audit and open questions](../design/settings-visual-audit.md)
separates adopted corrections from design proposals still awaiting discussion.

### Meaningful icons, clear commands, and ongoing standards work

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

### Flat record summaries and value separation

Prefer flat, full-width divided rows within a subsection, including compact
record summaries. A record does not need a nested secondary card just because
it is a record. Use a distinct nested surface only when independent grouping
actually helps scanning. The motivation is less visual nesting and less wasted
space while preserving recognizable records and clear actions.

Keep a deliberate gap between the title/description region and the trailing
value/action region. Values must never compete with long descriptions for space.
Compact previews truncate before that gap; full text remains available in the
detail dialog. Titles may wrap when needed. Goals and Motives are the current
trial: 32px separation, a reserved trailing value region, and one-line context
previews capped at 52 characters of typographic width. These dimensions are trial
values, not a universal fixed width for every settings control.

Record details reuse existing settings-row and Dialog composition rather than
recreating divider colors and row geometry. Place direct object mutation actions
in the bottom full-width action grid beside Close; keep descriptive content and
read-only metadata separate from actions. Preserve recognizable object identity
through consistent naming and layout. Decorative treatment must help identify
or understand the object, not add arbitrary artwork: Goals and Motives may remain
text-heavy, with a quiet type label and readable full context.

Inactive settings use a shared reduced-emphasis state, distinct from destructive
styling and from disabled controls. They remain clickable and keyboard accessible
so users can inspect or resume them; restore emphasis on hover/focus. Retain a
concise Paused label when needed so opacity is not the only indication. Avoid
repeating Active on normal rows or Completed under a Completed section heading.
Goal details use a labeled shadcn Progress bar, percentage, target date, and a
separate success-description block. Footer mutations should have clear labels
when an icon alone makes their meaning ambiguous.

Use an optional framed-icon subsection header when a group needs a concise
explanation of purpose or agent relevance. Put it inside the continuous card,
start-aligned above its rows. Describe context available to authorized agents
without promising automatic enforcement or authority the setting does not grant.

Dialogs need a distinguishable elevated surface: use the shared popover surface,
semantic border and shadow against the overlay in both themes. Keep goal details
flat: title, success context, target date, compact inline progress, then footer actions.
Numeric progress edits accept whole percentages from 0 to 100, commit on blur or
Enter, and allow Escape to cancel. Completing/reopening updates the goal status;
editing partial progress preserves a paused state. Validation stays beside the
field; save failures use Sonner.


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

Goals and Motives share a quiet page label, framed explanatory subsection, and
text-first detail dialog with bottom actions. Titles and descriptive context edit
in place; Goals additionally exposes an editable target date and progress.
Save changed values on blur/Enter (Cmd/Ctrl+Enter for multiline), cancel with
Escape, validate required titles, and retain drafts on failed saves with Sonner
feedback. Motives uses "Why it matters" where Goals uses "Success looks like";
consistent composition must preserve the meaning of each record type.


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

Card spacing belongs to the shared Card slots: Header, Content, and Footer use
the same padding token, with no additional root gap or vertical padding. Content
omits top padding when a header exists and bottom padding when a footer exists,
so adjoining slots provide one spacing interval rather than doubling it.

Ritual History uses an open search/filter/sort toolbar above a configurable table (stacked records on mobile),
not a separate card of filter settings or nested record cards. Default to the current
Monday–Sunday week in the profile time zone; allow week/month selection and adjacent
period navigation. Each row summarizes ritual, date, completed steps, and status, with
a chevron opening the answer/activity dialog and a full-width Close footer action.
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

Settings value columns reserve up to the standard editor width, capped at 60%
of the row on narrow surfaces. Keep editor-width tokens as lengths and constrain
the row track, so nested controls do not repeatedly shrink a percentage width.

Search action dividers use the surrounding body/background color. Count badges
are circular and paint above dividers and every button hover/focus/selected surface;
never clip them at input or action boundaries. Keep hover and keyboard focus visible
without covering the badge. Every sort option has a direction/field icon; filter
options get domain icons when meaningful (dates, morning/evening, statuses). Filter
value triggers retain standard horizontal padding in idle, hover, focus, and open
states; plain text styling is not zero-padding button styling.

- Joined search actions use stable inset separators independent of hover/open backgrounds, consistent hit areas and inset keyboard focus. Count badges stay above state surfaces. Rows open from their non-interactive area; checkboxes and other embedded controls retain independent actions, with a primary keyboard-accessible opener.
- Historical detail views separate a compact outcome summary, numbered question/answer pairs, and a single chronological activity log. Retain draft and action-outcome evidence; align timestamps separately from content. Nearby calendar dates use Today, Yesterday, or Tomorrow in the relevant time zone, with explicit dates farther away.

### Data-page states and verification

Follow the full state matrix in `../design/system.md#data-page-state-and-recovery-contract`.
Compose shared `data-view-state` with domain query state; never infer global absence from
one filtered/cursor page. Remove meaningless table controls for zero rows, retaining every
escape from active criteria. Error details belong to Sonner in Settings; persistent neutral
availability/freshness and retry controls keep recovery discoverable without duplicate error
copy. Test initial load, filtered/period emptiness, global emptiness, stale data, failure/retry,
and restoration. Verify no data mutation, lost filters, lost preferences, or keyboard trap.

All Time must retain scope context and a direct return to the default period. Successful
recovery restores data-dependent controls; no one-way UI hiding flags. Test the complete
Show All/return round trip on real records. Inventory absence requires every contributing
read to succeed, and cached zero results after refresh failure do not establish current
absence. Empty states should offer one clear create path, not duplicate header/body buttons.

Visual QA uses the local development collection-state preview described in
`qa-fixtures.md`. Audit each owning collection on desktop/mobile and inspect lower regions,
not only page headers. Keep admin gates unchanged and report permission coverage gaps;
UI simulations are not evidence that an upstream failure was reproduced in production.

### Populated records and native configuration

The 2026-10-22 audit used the local owner fixture and a current-worktree Tauri QA
bundle. Shared loading/absence/recovery coverage is not complete layout adoption:
inspect populated records and actual native controls too.

- A subsection's permission state, capability guidance, and related test/settings
  actions belong in its identity header, separated from editable rows by the same
  full-width divider. Notification action outcomes still use Sonner; the persistent
  macOS permission is configuration state, not action feedback.
- Compact rows retain leading label/trailing control placement on narrow screens;
  do not move a switch to another line simply because the viewport is small. Let
  labels wrap within their track; use an explicit stacked composition only for a
  compound editor that actually needs it.
- Calendar Sources uses account identity headers followed by flat calendar rows;
  account and calendar separators share the canonical divider. Keep switches at the
  end and deletion independently labelled. Mail account summaries navigate to their
  configuration; rule summaries use compact rows with bounded condition text and
  independent status/actions. Do not nest record cards inside these row sections.
- A color setting rests as a swatch and value. Open the shared color picker in a
  bounded, end-aligned popover; preserve keyboard editing, live preview, coalesced
  persistence, and focus restoration. Related workspace switches get ordinary rows.
- Server choices stay visible as flat rows. Switching an API origin is an explicit
  Connect action because it crosses a session boundary; ordinary preference autosave
  must not silently switch it. Preserve tested-origin checks, fresh settings identity,
  and sign-out/reset semantics. Keep Connect on the right of secondary test actions.

Native UI inspection does not certify signed widget installation, OS permission
delivery, login registration, or production/provider operation.
