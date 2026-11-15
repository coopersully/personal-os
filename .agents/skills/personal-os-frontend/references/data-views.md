# Data views, data-page states, and recovery

Detailed rules moved from the `personal-os-frontend` skill. Every rule here is binding.

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
retained data. Use the shared recovery queue for signed-in read failures. Account verification has priority;
active dataset failures share its responsive surface and remain gated through pending retry until
confirmed success. Non-retryable access/correction responses keep their own flows. Keep
401/private-cache and public/auth flows intact.
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
