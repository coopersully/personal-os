# Settings composition, routing, and geometry

Detailed rules moved from the `personal-os-frontend` skill. Every rule here is binding.

## Settings composition and inline editing

Read [the settings page contract](../../../../docs/design/pages/settings.md#flat-settings-rows-and-optional-headers)
and [engineering standards](../../../../docs/engineering/settings-ui-standards.md) before
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
record, navigation, or command using the [decision table](../../../../docs/design/pages/settings.md#platform-agnostic-settings-model).
Keep scope, effective value/source, availability, and commit policy explicit. Small
choice sets can use direct radios/groups; larger sets use searchable Comboboxes.
Do not hide dependent settings just to reduce visual density. Keep resting icons
adjacent to end-aligned values; test long text and larger text without clipping.
Use bounded modals for related decisions and actual dependent steps, routes for
persistent detail pages, and shared domain adapters for all writes. The
[System Settings study](../../../../docs/design/references/system-settings/README.md)
is evidence, not a mandate to copy Apple styling or private architecture.

## Settings routes, row geometry, and visual audits

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
