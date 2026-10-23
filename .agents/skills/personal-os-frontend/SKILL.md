---
name: personal-os-frontend
description: Build and refine accessible, domain-owned nohmi React PWA experiences. Use when changing `apps/web`, critiquing or refining a screen, translating UX feedback into shared rules, adding a feature page or view state, composing shadcn primitives, changing API queries, or refactoring the application shell.
---

# nohmi frontend

Follow `docs/design/foundations.md`, `docs/design/governance.md`,
`docs/design/system.md`, the relevant page specification in
`docs/design/pages`, `apps/web/src/features/README.md`, and
`docs/engineering/feature-ownership.md`. Apply the installed `shadcn` skill for
component lifecycle and the available React best-practices guidance for
performance work.

Read `docs/product/workspaces.md` before changing a core workspace. Mail is a mail client, Tasks a
task manager, Calendar a calendar, and Finances a budgeting and net-worth application; nohmi
intelligence simplifies those familiar models rather than replacing them with a generic dashboard
or chat surface.

## Diagnose refinement before editing

For settings refinements, check rejected autocomplete drafts through blur/refocus and keep
validation on the visible input. Search must reveal existing editors without creating data.
Check compound choices against their actual column width, including internal overflow;
page containment alone can miss clipped options. Decorative ritual canvases stay within
their viewport; independently verify card/footer bounds after entrance animations settle.

- Record the visible symptom, conditions, and user or system cost without
  embedding the requested fix.
- Walk the governance diagnosis ladder: user outcome → information hierarchy →
  pattern → primitive → token → composition → defect.
- Fix the earliest stable layer responsible for the failure. Do not turn one
  preference into a global invariant or hide a shared cause behind a page-only
  override.
- State the proposed invariant or trial hypothesis, maturity, owner, affected
  surfaces/states, and verification. Keep exceptions explicit and contained.
- Treat implementation and automated tests as behavior evidence, not as proof
  of comprehension, visual quality, or user validation.

## Structure feature work

- Place a vertical feature under `apps/web/src/features/<domain>`.
- Keep its page composition, query hooks, local state, and feature-only
  components together.
- Use `@personal-os/api-client` and domain contracts; do not call providers or
  invent page-only representations of provider material.
- Compose `src/components/ui` primitives. Do not create replacement primitives
  or bypass shared theme tokens.
- Compose dense contextual navigation with the shared Sidebar, Collapsible,
  and sub-menu primitives. Keep account disclosures and child destinations as
  separate bounded rows; truncate identity text and align counts independently
  so live provider data cannot collapse into a text block.
- Do not repeat a workspace name between the switcher and its contextual
  navigation, and do not mark internal routes with external-link glyphs.
- Let the app shell own routing, global navigation, Today, the generic Add menu,
  and modal composition. Keep new domain behavior out of `app.tsx` unless it is
  necessary composition wiring.
- Keep page-wide orientation, search, filters, freshness actions, and the
  primary create action in the app frame. When the frame exposes them, begin
  the feature body with primary material instead of repeating a title, eyebrow,
  search field, or action bar.

## Apply the design system deterministically

- State the page's immediate user job and classify each visible group using the
  design-system block grammar before adding layout.
- Compose existing shadcn primitives. Do not add feature-specific replacements
  for Card, Item, Alert, Collapsible, Empty, or Sonner.
- Compose the shared compound `EventCard` for non-spatial event summaries and
  previews. Fill or omit its named slots instead of creating page-specific
  event-card markup. Calendar grid blocks remain a separate spatial pattern
  because their position and size encode time.
- Use one raised primary block at most. Do not wrap every page group in a card;
  use an open sequence or a quiet queue for ordered material.
- When four or more diagnostic rows answer one readiness question, show one
  product/object overview with the shared `ReadinessPanel`, an honest aggregate
  state, and the next unresolved check. Show determinate progress only after all
  required reads settle. The closed overview has a hard two-row maximum: put
  identity, status, and a one-line focus on row one, then count, progress, and
  evidence access on row two. The focus replaces the normal description; never
  add a focus callout, nested `Item`, action, or third row. Open the complete
  vertical `ItemGroup`, including per-check actions, in a labelled dialog;
  diagnostic review must never expand the overview. Promote an actionable
  failure as **Next step**, but call a non-actionable failure **Current
  constraint**. Do not make diagnostics a default dashboard grid.
- Apply the interface-copy contract: delete helper text that restates an
  obvious label, and use a preview when the result can be shown more clearly
  than it can be explained.
- Keep labels persistent. When a placeholder is useful, demonstrate the
  expected shape with obviously fictional reserved material such as
  `sam@example.com`; never use personal data, production identifiers, or
  plausible credentials.
- Keep interaction treatment flat. Shared controls use semantic background and
  border changes for hover, focus, and selection; do not add rings, outlines,
  or box shadows as interaction indicators.
- Separate ordinary surfaces and controls with opaque semantic tone rather than
  a visible resting border. Shared primitives may reserve transparent border
  geometry for focus, invalid, increased-contrast, or functional data states;
  a legacy `outline` variant does not require a drawn outline.
- Keep semantic foreground tokens intact on interactive controls. Never add a
  global color override that can defeat a component's `text-*` contrast class.
- Keep navigation icon geometry stable across states: use the regular and
  filled weights of the same icon, with fill reserved for the active
  destination.
- Treat Calendar, Tasks, Mail, and Finances as the only colored workspace
  identities. Read their label, route, and glyph from the shared workspace
  registry and render the framed `WorkspaceIcon` whenever representing the
  whole workspace. Keep its frame and palette stable across selection; use the
  control surface for active state. Keep every palette high-chroma and distinct
  at peripheral glance in both themes; do not mute workspace identity toward
  gray in the name of calmness. Never copy workspace palette values into a
  feature, apply them to a whole page, or use them as status. Today stays
  neutral, Reminders stays inside Tasks, and ordinary actions, records, views,
  and providers use unframed functional icons.
- Treat Today, Calendar, Tasks, Mail, and Finances as the complete workspace
  set. The navigation-owner manifest, rather than a leaf route, determines the
  active workspace sidebar: Today has no contextual sidebar; Tasks owns
  Reminders. Goals, Motives, Reviews, and Activity belong to the account utility
  in Settings. Account configuration is a tenant of the shell: it uses the
  shared frame and sidebar column, with a Settings page heading instead of an
  app bar (see `docs/design/pages/settings.md`), but must not become a workspace,
  take a workspace identity, or enter the switcher. Only a standalone flow such
  as setup may replace the shell.
- Combine only attributes that answer the same user question into one compact
  trigger and detail surface. Keep a neighbouring control when it represents a
  distinct action—for example, weather icon + temperature combine, while the
  location remains a separate map control. Use connected-service marks instead
  of raw provider identifiers.
- Weather detail uses a time-of-day sky header with the condition, temperature,
  and no more than two supporting facts. A location trigger opens an in-app map
  preview; clicking that preview is the explicit external action, never the
  trigger's direct behavior.
- Use `ChoiceCardGroup` for a small, mutually exclusive set of previewable
  preferences. The full card must be the radio hit target; do not place a
  disconnected radio beside a clickable-looking card. Always reserve the
  selection-marker space so selection does not shift content; anchor card
  information at the top/start and stretch any preview at the inline end.
- Treat review feedback as a system input: convert it into a named invariant in
  `docs/design/system.md` when governance criteria justify cross-product scope,
  assign it to the responsible shared layer, and add focused coverage plus live
  QA before closing the work. Keep page-specific rules in the page spec and
  unproven preferences as trial hypotheses.
- Keep source, freshness, capability, policy, and action result visible at the
  smallest useful level. Keep raw metadata, history, rare controls, and verbose
  configuration behind labelled disclosure.
- Update the page specification when a change establishes or revises a reusable
  interaction rule. UI and its specification must land together.

## Settings composition and inline editing

Read [the settings page contract](../../../docs/design/pages/settings.md#flat-settings-rows-and-optional-headers)
and [engineering standards](../../../docs/engineering/settings-ui-standards.md) before
changing settings. This is the accepted standard across every Settings route.
Use the shared Settings layout/control context; do not create page-local imitations
or change workspace forms outside Settings as a side effect.

- Small secondary labels sit above subsection Cards. Short setting labels sit
  at the start of divided rows; values and controls sit at the end.
- Simple values edit where the text was, without chevrons or dialogs. Commit
  on Enter/meaningful blur, cancel on Escape, preserve rejected drafts, and
  suppress unchanged/duplicate writes. Radios, switches, and checkboxes are direct.
- Complex configuration opens a dialog. Phone uses two steps: number, country, and
  consent first, then verification. Chevrons indicate modals; arrows indicate page navigation, not
  direct selectors; Home has no clear icon. A typed draft is not a verified number.
- Settings choices use compact checked menus for up to six options; larger sets
  and time entry use searchable shadcn Combobox controls with at most six suggestions.
  Keep values right-aligned, with a leading clock for times.
  Keep value icons adjacent at text size, and reserve equal 32px leading slots for
  framed and unframed icons. Summary rows reuse workspace glyphs/colors, provider BrandMark artwork, and framed
  destination icons; never invent substitute logos or mismatch the destination.
- Settings inline editors share an 18rem editing width (constrained on small screens).
  Resting values and adjacent icons shrink together against the trailing edge.
  Focus uses standard InputGroup addon padding and start-aligned text. Reuse
  `settings-value-input`; never add field-specific width overrides.
- Page headers remain visible by default; Profile uses its in-card identity,
  and Goals uses a small label above its outcome sections.
  Header/icon APIs remain optional. Page headers center the solid
  icon above the title in a borderless frame. Subsection identity headers are
  start-aligned and may use an avatar instead. Use title case for Settings titles and
  section labels. Do not add generic description-only subsection headers.
- Cards have one continuous surface; nested record Items use a distinct secondary
  surface. Buttons are pill-shaped, primary actions contrast with the background,
  and card-header icon actions are ghost.
- Preserve search reveal paths, accessible labels, focus, error delivery through
  Sonner, and the existing persistence/verification authority.

Before choosing a control, classify the content as a preference, read-only state,
record, navigation, or command using the [decision table](../../../docs/design/pages/settings.md#platform-agnostic-settings-model).
Keep scope, effective value/source, availability, and commit policy explicit. Small
choice sets can use direct radios/groups; larger sets use searchable Comboboxes.
Do not hide dependent settings just to reduce visual density. Keep resting icons
adjacent to end-aligned values; test long text and larger text without clipping.
Use bounded modals for related decisions and actual dependent steps, routes for
persistent detail pages, and shared domain adapters for all writes. The
[System Settings study](../../../docs/design/references/system-settings/README.md)
is evidence, not a mandate to copy Apple styling or private architecture.

## Menus and selection semantics

Apply the app-wide [menu standards](../../../docs/design/system.md#menus-and-selection-controls-all-workspaces).
Use `DropdownMenuItem` for commands/navigation, `DropdownMenuRadioGroup` and
`DropdownMenuRadioItem` for mutually exclusive values, and `DropdownMenuCheckboxItem`
for independent toggles. Shared trailing radio/checkbox indicators must remain visible
when unchecked; do not append ad hoc checkmarks or nest interactive inputs in menu rows.
Keep multi-select menus open while adjusting options. Reserve indicator space, constrain
menus to the viewport, and separate destructive actions with a separator and destructive
variant. Replace one-action overflow menus with accessible direct icon buttons.
Verify keyboard navigation, selected/unselected/mixed/disabled states, and narrow layouts.
These rules apply to every workspace and Settings, not only Tasks.

## Make user state honest

Represent loading, empty, error, stale, reconnect, and capability states.
For provider-backed material, expose freshness and failure instead of silently
presenting a projection as current. Make destructive actions deliberate and
surface API policy or permission failures clearly.

For agent-driven setup, render the authenticated server plan as the source of
truth for current, blocked, and complete state. Ask the person only for the
connection, preference decisions, or approvals nohmi cannot perform. Keep hosted
skills and procedural prompts as optional compatibility references; never make
the person copy setup instructions between nohmi and an agent after the agent can
call nohmi.

For User Knowledge, read `docs/product/user-knowledge.md`. Present it as About you or Your context:
show what nohmi believes, whether the person stated it or nohmi inferred it, its source, confidence,
scope, and allowed purposes, with direct promotion, correction, restriction, dispute, export, and
deletion controls. Do not expose vector similarity, raw embeddings, or an unbounded memory dump as
the primary experience.

## Apply feedback consistently

**Settings feedback invariant:** all settings errors and discrete action feedback MUST use
Sonner. Never add inline pending/success/failure paragraphs, status rows, Alerts, banners, or
cards for notification tests, connection tests, refreshes, permission requests, or native actions.
Use one loading toast and update it on actual completion, with diagnostic next steps in its
description. Do not replay cached success on page mount. Keep autosave success silent. Field
corrections and actual permission/configuration state may remain inline but cannot replace the
Sonner error. Test both the toast and the absence of inline action-result text. This overrides
any generic inline-error guidance below; the canonical rule is `docs/design/feedback.md`.


Follow `docs/design/feedback.md`. Use `useFeedbackMutation` with an explicit
user-facing action and safe-retry classification. Render `MutationFeedback` for
persistent failures; edit forms use `FeedbackForm`, named inputs, and field-name
mapping instead of a second error banner. Prefer Sonner for transient action
results. Preserve drafts, one-time secrets, and cached data after failed refresh;
keep query recovery and stale status beside the affected work. Validate on
submit/meaningful blur, never on the first keystroke. Confirm irreversible actions
with `useConfirmAction`; keep feedback and focus reachable after menus close.

## Verify interaction behavior

Add focused Testing Library coverage for feature behavior. Use Playwright when
the change crosses routing, responsive layout, or a user-visible flow. Keep
the generated shadcn sources as vendor primitives; test product composition.

Target WCAG 2.2 AA across the complete flow. Prefer native HTML and established
shared primitives; follow WAI-ARIA APG keyboard conventions for composite
widgets. Automated checks do not replace keyboard, focus, zoom, reduced-motion,
responsive, realistic-state, and assistive-technology inspection appropriate
to the change.

Settings routes use `settingsPath` / `settingsRoute`: `?page=<page>` or
`?page=<parent>&subpage=<child>`. Register parent relationships centrally; retain
legacy redirects and deep-link parameters. Subpage Back is an accessible icon
button at the header Card's top-left, linking to the parent. Focused inline
editors retain standard shadcn InputGroup padding; compact padding applies only
to unfocused values across every Settings page.

Settings scalar rows use a 48px minimum height and 8px vertical padding, with
32px input controls and native-sized checkbox/switch glyphs. Keep descriptions
2px below their title. Center the trailing control across the combined title
and description, allow wrapping to grow the row, and avoid padding twice in
inline-edit wrappers. This applies to Profile and every other Settings page.

Use SettingsIconSlot for leading artwork: a transparent 32px footprint with a
centered 16px glyph when there is no visible frame. Subpage headers combine the
parent icon with a smaller bottom-right subpage badge. Settings sidebar context
menus list authorized direct subpages; collection counts reflect saved records.

For a Settings-wide visual pass, inspect every accessible route and its lower
sections, then record permission/platform coverage gaps explicitly. Apply the
visual-audit rubric in settings-ui-standards.md. Preserve record and preview
exceptions as explicit design questions; do not silently classify them as scalar
preferences. Never fit a settings row grid inside a second multi-column grid.

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

### Settings flatness and summary spacing

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

## Data views

For dataset filters/sorting, compose `components/data-view-controls` rather than
page-local trigger styles. Follow the Flexible data views contract in
`docs/design/system.md`: dashed-plus defaults, filled applied filters first, distinct
sort glyphs, bounded responsive overflow, preserved domain query semantics. Compose
`components/data-table` for configurable tabular records with labelled mobile records,
account-scoped device layout preferences, bounded server pagination, and honest
current-page selection/export scope. Keep audit records read-only and action feedback
in Sonner. View switches and setting preferences are not dataset filters.

Keep table toolbars outside their card surface. Put Export and Table Options in
one overflow menu, expose selection actions contextually, and consolidate counts
and page size in the pagination footer rather than repeating table chrome.

Use `FilterBar collapsed` for compact record toolbars: search, Filters, and compact
Sort share one row. Reorderable lists use `components/reorder-handle` with Motion
Reorder, handle-only touch/pointer dragging, bounded Up/Down keyboard movement,
and the shared quiet drag state. Configuration dialogs must not scroll sideways.

Mobile table titles must distinguish records using meaningful context (for example,
ritual + date), stay first regardless of desktop ordering, and avoid repeating that
context in the detail grid. Preserve separate desktop columns and configured details.

Append adjacent search filters/sort with `SearchDataControls` inside InputGroup;
use icon actions, applied counts, accessible labels/tooltips, and selected non-default
sort state. Compact tables grow only for content, with inline mobile label/value
pairs and a distinguishing title. Preserve Comfortable/wrap controls and touch access.

Use rounded Item anatomy and a subtle secondary surface for reordered rows. Compact
mobile statuses retain tap/focus labels and accessible names. Compose CompletionCount
for progress ratios: current and total use the same normal text treatment.

Compose mobile records by meaning: name + subordinate identifying context, then
related label/value pairs in deliberate mobileOrder. Do not wrap desktop columns
blindly. Keep facts close to their labels; completion ratios use plain current / total text.

Search action sections and filter forms: keep filter and sort in separate appended
sections divided from the search input and one another. Use standard action-count
badges for active filters/non-default sorting; no inline count text or standalone
floating pills. Filter dialogs use the standard search InputGroup above flat Settings
Field rows with full-width dividers and plain end-aligned values; avoid filter-chip
controls inside the form itself. Mobile metadata uses consistent text size/line height
and a predictable value column per group. Completion ratios are plain “done / total”
text without different sizes, colors, or weights within the ratio. This replaces
earlier experiments with subordinate denominators and undivided search actions.

Search actions use quiet, inset semantic dividers independent of state surfaces; circular count badges layer above all
button states and borders. Sort options always have icons; filter options use domain
glyphs when useful. Keep normal padding on settings/filter value triggers.

- For joined search/filter/sort controls, keep separators stable across hover/open/focus states and badges above surfaces. Inherit the search group’s end corners and clip action fills there, retaining whole inset counters and portalled menus; check one-action and multiple-action compositions. Expand record pointer targets without stealing nested controls or adding duplicate keyboard stops. History details should distinguish summary, answers, and chronological evidence; use shared calendar-relative date formatting.

For table/data-page states, apply the state matrix in
`docs/design/system.md#data-page-state-and-recovery-contract`; compose
`components/data-view-state` instead of custom absence/loading markup. Distinguish
successful empty scope from failure and stale data. With no rows, omit irrelevant
table chrome while keeping editable criteria and a safe way to broaden/return.
Verify recovery transitions, not just a populated screenshot. Keep settings errors
in Sonner; initial unavailability retains bounded recovery in its own content area. Cached
refresh errors never insert rows/banners into workspace chrome, sidebars, navigation, or bento
layout. Initial navigation/sidebar failures also use `toastOnly`; an initial Empty recovery
region belongs to data content. Retry the missing blocking read when other sources have stale
retained data. Use toast retry plus existing refresh controls. Only account-wide non-authentication
verification failure gates the app with the shared non-dismissible recovery dialog, through
pending retry until confirmed query success. Keep 401/private-cache and public/auth flows intact.
Never duplicate failure prose or turn recovery into a record mutation.

Exercise empty → broaden → populated → default-scope round trips for data pages.
No recovery action may permanently remove scope/navigation or leave an initial-error
region blank behind a toast. Use the development-only Settings collection previews
in `docs/engineering/qa-fixtures.md` for non-mutating desktop/mobile visual audits;
keep permission gates intact and distinguish simulated UI evidence from live failures.

When auditing Settings data views, check populated rows and real permissioned/native
consumers, not only loading/empty/error primitives. Use a separate local native QA
identity and the actual desktop bridge. In compact mobile metadata pairs, constrain
the value track (`minmax(0, 1fr)`) and truncate long text; an unconstrained `auto`
value track can overlap the adjacent pair despite no document-level overflow.

- In native settings audits, keep general capability guidance in the identity header;
  actionable OS permissions use a leading state-summary row and a guided modal that
  groups instructions, checks, native settings, and tests. Refresh checks on open/return;
  never request OS permission merely by opening the guide. Inspect populated account/record groups,
  not only recovery states. Flat presentation must preserve authority boundaries:
  server changes require the existing tested Connect flow; color edits retain live
  preview/coalesced saves inside a bounded popover.
