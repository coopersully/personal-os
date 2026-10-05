# nohmi design system

## Purpose

nohmi helps one person see, decide, and act across their commitments
without hiding where information came from or asking them to surrender control
to an agent. The interface should feel like a well-made personal instrument:
quiet by default, direct when needed, and detailed only at the point of use.

The visual character is soft neutral paper, soft charcoal, flat tonal grouping, and a
monochrome product-chrome scale. It is not a generic dashboard, a collection of
unrelated cards, or an AI chat surface.

## Brand foundation

- **Name:** `nohmi`, always lowercase in product and prose.
- **Pronunciation:** “know me.” This is meaning, not a visual gimmick; never split,
  capitalize, or decorate the name to explain the wordplay.
- **Promise:** “know what matters.” Use it sparingly at brand entry points, not as
  a repeated page subtitle.
- **Posture:** neutral, capable, soft, and direct. nohmi is unafraid of color but
  unopinionated in its use: the product has no signature hue.
- **Wordmark:** the lowercase text wordmark is primary. The compact `n` mark is
  for constrained app-icon and navigation contexts. Neither uses a gradient,
  glow, outline, or decorative symbol.
- **Auth decoration:** the desktop-only neutral card may tile the static favicon
  glyph at low opacity. Tiles pulse independently with stable randomized delays
  and slow durations; no hover behavior, orbit, glow, or rapid flashing. Reduced
  motion shows a still pattern. A small static logo and wordmark may sit in the
  auth page header, separate from form content. This is a
  contained decorative-opacity exception, not a general product motion pattern.
- **Voice:** use plain verbs, short clauses, and concrete nouns. Sound calm and
  useful, never cute, breathless, mystical, or artificially intimate.
- **Full-page errors:** use the default canvas with a centered short,
  large title, description, and recovery actions, without a foreground logo. The shared fading tile
  pattern may fill the background at subdued opacity; omit navigation branding
  and the dashed border used for in-page empty states. See
  [error pages](pages/errors.md).
- **Password fields:** use the shared input-group control with an end-aligned,
  accessible visibility toggle. Recovery belongs in the label row as a concise
  action, not beneath the form or inside the input.
- **Field labels:** use the secondary foreground token and a consistent 6 px
  vertical gap before the control. Inline label actions must not increase that
  row's height. Validation keeps its semantic error color.
- **Placeholders:** use the shared `input-placeholder` token, quieter than labels
  and entered values. Hover and focus restore secondary text contrast against
  the stronger control surface; placeholders never replace persistent labels.
- **Input surfaces:** shared Input, Textarea, and InputGroup use the same opaque
  semantic fill in empty, typed, and autofilled states. The group owns its fill;
  its inner control stays transparent, including on hover. Browser autofill may
  use a flat inset repaint to mask the browser's forced color—never elevation
  or a focus shadow. Clip autofill to text only inside a filled InputGroup.

## Working principles

1. **Start with the material.** Design against the actual records, states,
   constraints, and responsive layout. Do not approve a speculative mock while
   the implemented state is unknown.
2. **One page, one immediate job.** A page declares the decision or action it
   helps the person make. Every visible block must serve that job.
3. **Reveal the next useful layer.** The default view contains the current
   decision, its consequence, and a clear route to detail. Configuration,
   history, provenance, and rare controls are available on demand, never lost.
4. **Visibility is not maximal exposure.** Persistent orientation, source
   identity, capability, freshness, policy, and state remain discoverable.
   Their raw detail does not compete with the person’s immediate work.
5. **Autonomy is visible.** The person can directly manipulate material, see
   what an agent or provider did, and understand when an action is constrained.
   Agents propose and explain; they never turn ambiguity into hidden behavior.
6. **Use fewer, stronger forms.** When a surface contains many independent
   visual treatments, remove structure before adding decoration.
7. **Turn review feedback into a system rule.** A repeated visual observation
   is evidence of a missing constraint. Capture the underlying rule, its
   intended component, and its acceptance check—not merely the local patch.

These principles draw on Ryo Lu’s argument for keeping builders close to the
material and its feedback, rather than becoming passive approvers of opaque AI
output, and on Jony Ive’s emphasis on care, focus, and letting a material’s
properties inform the finished form. See [Ryo Lu’s Compile 2026 session](https://cursor.com/compile),
[his discussion of designing close to code](https://dialectic.fm/ryo-lu), and
[Ive’s discussion of creative process and material form](https://www.mckinsey.com/capabilities/tech-and-ai/our-insights/the-creative-process-is-fabulously-unpredictable-a-great-idea-cannot-be-predicted).

## System grammar

### Page frame

See the [workspace layout architecture](workspace-layout-architecture.md) for
the ownership hierarchy, intrinsic frame sizing, responsive slots, and scroll
contract. Domain content keeps its own spatial or collection layout.

Every product page has these layers, in order:

| Layer | Question answered | Rule |
| --- | --- | --- |
| Orientation | Where am I and what time/context applies? | Keep the page title and current context visible in the app frame. |
| Primary material | What deserves attention now? | Give one primary block the strongest visual weight. |
| Working sequence | What comes before or after it? | Use a linear list, timeline, or queue—not a second dashboard. |
| Detail | What do I need to inspect or change? | Open an inspector, sheet, popover, or a labelled disclosure from the affected item. |
| History | What happened before? | Collapse by default unless it changes the immediate decision. |

The shell owns one responsive inline page inset. Standard app-bar content and
ordinary route bodies use that same inset so their leading and trailing edges
align across navigation and material. Spatial workspaces that intentionally run
edge to edge, such as Calendar and Mail, may opt out at their workspace frame;
individual pages must not recreate the shell inset with local padding. Settings
uses a centered reading surface with its own page introduction, without a workspace
app bar; see the [Settings layout contract](pages/settings.md).

Primary and secondary top navigation use `--background`, matching the default
page canvas in both themes. Sidebars retain their independent sidebar tone.

`WorkspaceLayout` owns an optional secondary-navigation slot directly below
the primary app bar. Features compose `WorkspaceSecondaryAppBar` with its
`Leading`, `Content`, and `Actions` slots; React context and a portal keep the
controls owned by the feature while placing them in the shared frame. Omit the
bar or set `enabled={false}` to leave no empty row. Its default layout placement
stays pinned below the primary bar and shares the body inset. Spatial Calendar
headers may use `placement="inline"` to retain their own scroll/column alignment.
Controls that govern multiple workspace panes, such as Mail count, density, and
reader actions, use the default shared full-width slot.

### Blocks

A block is a named product pattern with a stable purpose, not merely a rounded
rectangle. Use one of these forms before creating a new container.

| Block | Use for | Default visibility | Surface |
| --- | --- | --- | --- |
| `moment` | The single time-bound thing happening or next | Always open | Flat tonal field, highest contrast |
| `sequence` | Ordered events or material that follows the moment | Always open when non-empty | Open page surface with compact material rows |
| `queue` | A bounded list of choices or commitments | Always open when actionable | Quiet rail with separators |
| `summary` | Capacity, count, freshness, or contextual fact | Inline with its owning block | Text or badge; never a dashboard tile by itself |
| `attention` | A persistent blocker, capability, or safety condition | Open while relevant | Semantic `Alert` beside its affected work |
| `empty` | The deliberate absence of expected material | Only while the owning collection or schedule has no material | Transparent container with one quiet, widely spaced dashed semantic border; never a tonal fill |
| `detail` | Infrequent controls, provenance, scope, or raw metadata | Closed until requested | `Collapsible`, Popover, or inspector |
| `history` | Completed, revoked, or past material | Closed by default | Labelled `Collapsible` with a count |
| `choice` | A small set of mutually exclusive, previewable preferences | Always open | Shared `ChoiceCardGroup`; the entire card selects the option |

Rules:

- Reserve the selection-indicator space in every state so choosing an option never changes its layout. Anchor information at the block start; when present, place the preview at the inline end and let it occupy the card's available height.

- A page may have one `moment` block. A second elevated primary card is a design
  error unless the page has two genuinely simultaneous primary jobs.
- Do not wrap an entire page section in a card just to create spacing. A block
  earns a surface when it has a bounded action, a state boundary, or needs to
  separate live material from its surroundings.
- A `summary` belongs inside the block that gives it meaning. Counts and badges
  do not become standalone metrics.
- An `empty` block uses the shared shadcn `Empty` composition whenever its
  content fits that structure. Its transparent, dashed container is the stable
  visual signal for absence across the app. A reflective `QuoteCard` may carry
  the same treatment when it replaces an empty schedule; populated cards never
  inherit it.
- `detail` is progressive disclosure, not a dumping ground. Its trigger names
  the content it reveals, and its closed state still exposes the resulting
  setting or count when that affects the person.
- Preserve source, freshness, capability, and policy as compact metadata on the
  material row or inspector. Do not put provider mechanics in the default scan.
- A `choice` card is one accessible radio button, not a card beside a radio
  button. Its whole surface is the hit target, and its preview shows the result
  rather than repeating the label in prose.

### Shrinking material content

Material-card compositions must let their flex content shrink to the available
inline space before truncating text. Long provider titles must not widen the
mobile layout viewport or displace shell navigation. Preserve the full name in
the accessible label and detail surface. `OccasionCard` owns this constraint for
all-day Calendar previews; verify overflow against the configured device width,
not only `innerWidth`, which mobile browsers may expand with overflowing content.

### Stable choices and controls

Use this contract whenever a setting presents a small, mutually exclusive set
of visual options:

- Anchor control information at the top/start. Do not center it inside a large
  card merely to fill space.
- Reserve the marker, border, and padding geometry for every state. Selection,
  hover, focus, pending, and disabled states may change tone but must not move
  content or resize the control.
- Put the selection marker beside the label at the start edge. Do not float a
  decorative dot in unused card space.
- Treat the card as a two-part composition: **information | preview**. The
  preview sits at the end, spans the available inner height, and communicates
  the outcome without duplicating instructional copy.
- Use the same control family for choices of the same kind. Do not mix pills,
  radios, and cards for equivalent preference decisions on one surface.

### Responsive modal disclosure

Use the shared `ResponsiveDialog` composition for a modal task that must remain
comfortable across app widths. It presents the same content as a centered
shadcn Dialog at desktop widths and a bottom shadcn Drawer below 768 px. Do not
build feature-level media-query branches or maintain separate mobile and
desktop modal content.

Compose its named slots in document order: `Trigger`, `Content`, `Header`,
`Title` and optional `Description`, `Body`, `Footer`, and `Actions`. `Close` may
wrap a secondary action anywhere inside the content. The body owns overflow;
the header, footer, actions, accessible title, focus behavior, dismissal, and
mobile safe-area spacing remain stable. A feature may adjust layout through
slot `className` values, but must not replace the responsive presentation,
overlay behavior, or semantic anatomy.

### Honest capability and feedback states

- Do not surface a navigation item or settings surface to a person who cannot
  act there because of role or capability. If awareness is necessary, show a
  minimal, non-interactive availability state at the affected feature instead.
- A platform-only feature on the web gets a concise availability placeholder;
  it does not expose controls that cannot take effect there.
- Persistent blockers use a semantic inline `Alert` with clear visual severity
  and an action only when that action works in the current environment.
- Transient results—saved, refreshed, copied, or safely retryable failed
  actions—prefer Sonner. Field validation stays beside the input; unresolved
  blockers and essential recovery stay visible beside the affected work.
  Follow the [feedback and validation rubric](feedback.md) to classify the
  cause, choose the surface, and check timing and accessibility.

### Reference surfaces

Settings and Today are the reference surfaces for shared interface rules. Test
every new standard in both before applying it broadly: Settings proves a calm,
deliberate choice; Today proves that the same hierarchy remains useful under
live, time-sensitive density.

## Tokens and composition

Use the semantic tokens in `apps/web/src/styles.css`; do not introduce feature
colors, raw color utilities, or a second spacing scale.

| Concern | Contract |
| --- | --- |
| Type | Geist is the single product typeface, including compact time, date, count, identifier, and source metadata. |
| Text | Default UI text is 14 px. Secondary metadata is 12 px or smaller only when it is not required to complete the primary task. |
| Spacing | Use the shared 4 px rhythm. Block gaps are 24–32 px; row gaps are 8–12 px; dense metadata gaps are 4–8 px. |
| Shape | Shared `--radius` owns component roundness. Use cards and controls from `src/components/ui`; do not invent parallel primitives. |
| Color | Primary actions, selection, and current context use the monochrome ink scale. Warning, destructive, info, and success use semantic status tokens only. |
| Effects | No decorative gradients, borders, elevation shadows, blur, glass, or translucent product surfaces. Hierarchy comes from spacing, type, and opaque tonal fields. A surface-colored edge fade with bounded backdrop blur is allowed only when it separates fixed navigation from scrolling content, as in Setup and Calendar. |
| Icons | Icons clarify an existing label or stand in only when the action has a familiar, accessible name. Icon-only actions require an accessible label and tooltip. |
| Navigation | Active navigation keeps the same geometry as inactive navigation and uses the solid form of its icon; inactive items use the outline form. |
| Motion | Motion confirms a spatial change and stays brief. It never conveys the only signal of urgency, completion, or error. Respect reduced motion. |

Calendar grids use one-pixel `--line` separators owned by the grid container. A
day cell must not add a second coincident border, and current or selected-day
color may not replace the grid surface or obscure its time rules.

### Tonal separation

Ordinary surfaces and controls separate through opaque semantic tone, not a
visible resting border. Shared primitives may reserve transparent border
geometry so focus, invalid, increased-contrast, or functional data boundaries
can become visible without layout shift. A legacy `outline` variant names an
interaction hierarchy, not a requirement to draw an outline.

Portalled contextual overlays (menus, popovers, hover cards, and comboboxes) use
`popover` / `popover-foreground`, backed by the dedicated opaque `surface-overlay`
tone. Do not override these with canvas, card, sidebar, or a feature-local border.
Modal dialogs, drawers, and sheets instead use `background` / `foreground`, matching the page canvas. Their headers, bodies, and footers share one continuous surface; do not tint header or footer bands. The scrim supplies separation, and internal cards may use the normal card tone.

`surface-raised` is an in-flow supporting tone, not the overlay token. Contextual app-bar controls retain a quiet opaque
resting fill, and interactive highlights use `control-hover-background` so an
open or hovered control cannot collapse into its parent surface. Avatar
fallbacks use nested neutral tones so the identity boundary remains legible on
canvas, selected, and highlighted surfaces without a decorative border or
shadow.

### Interface copy

Copy earns its space by changing a decision. Apply these rules mechanically:

- A page title names the area; it does not need a subtitle unless the subtitle
  establishes scope, live state, or a consequence the title cannot carry.
- A control label names the option. Do not restate its obvious behavior in a
  helper sentence (for example, “Light” does not need “Use light at all times”).
- Helper copy must answer exactly one useful question: what changes, what is
  constrained, or what consequence follows. If it answers none, delete it.
- Prefer the visible outcome to explanatory prose. A preview is better than a
  sentence when the person can understand the result by looking.
- Use direct verbs, concrete nouns, and short clauses. Avoid filler such as
  “choose whether,” “at all times,” “quiet,” “current,” and the product name
  unless omitting it creates ambiguity.
- The app-frame title is orientation, not a hero. It stays compact; the block
  that owns the immediate task carries the strongest page-level emphasis.
- Workspace-switcher triggers show the workspace glyph without its frame,
  including the compact mobile header trigger. Picker items use unframed outline glyphs; the
  current workspace uses a filled glyph and its colored selected surface.
  in the desktop rail, inactive destinations use neutral outline glyphs and only
  the selected destination uses a filled glyph on its colored control surface, without an icon frame. Preserve the same glyph
  across states; color is reserved for the selected rail destination.
- Desktop account-management actions live in Settings, reached from the bottom of the workspace rail. A
  workspace may use compact account avatars in its app bar only as a source-visibility filter; that
  filter must surface health and link to Settings for repair rather than duplicating management.
- App-bar source filters use the shared `AccountSelectionTrigger`: show compact provider identities,
  expose the full scope in its accessible name, and use plain inherited typography for the concise
  visible label (`selected/total accounts`). When a source needs attention, place the shared
  disconnected glyph immediately before the avatar stack without a badge, border, or shadow; do not
  recolor or outline the complete trigger. Popovers use `AccountSelectionPopoverContent` action
  slots, with reconnection rendered as the primary action and labeled with the affected source count.
- Unified workspaces keep destination navigation separate from source filters: destinations belong
  in the sidebar, while the less-prominent source filter defaults to all connected sources.
- Connection management uses the shared `ConnectionCard` slots for identity, status, health
  summary, capabilities, and actions. Keep account identity separate from operational status; state
  the user impact and whether action is required in the summary; keep capabilities grouped; and use
  title-aligned icon actions with accessible labels and hover/focus tooltips for sync, reconnect,
  and removal. ConnectionCard composes the same SettingsRecordContent anatomy as other Settings records.
- Device-local density controls change presentation only. Keep the comfortable view as the
  information-rich default, preserve essential identity and time in compact views, and do not let a
  density choice change query scope or stored domain data.
- Settings uses task-sized Card tiles in the shared `SettingsBento` or `settings-stack`
  layout. Records inside those cards use `Item variant="secondary"` with paired
  secondary surface/text tokens. See [Settings](pages/settings.md) for the full layout contract.
- Settings forms compose shared `FieldGroup`, `Field`, and `FieldLabel`
  primitives. Consent uses a horizontal checkbox field with a separate label
  and description; availability and errors use shared alerts.
- Connected providers use their recognizable service mark when one exists. Do
  not substitute a raw provider identifier; any necessary fallback name uses
  the provider's correct capitalization.
- Combine attributes that answer the same question into one control—for
  example, weather icon + temperature answer “what are conditions now?” Keep
  a neighbouring control when it represents a different action or question:
  location remains its own map control. One contextual popover owns the shared
  detail; do not create duplicate popovers for the combined attributes.
- A live environmental detail surface may use an informative visual header
  when the material itself benefits from it. Weather uses a time-of-day sky
  flat tonal field with condition, temperature, and at most two live facts overlaid;
  the simple explanation stays below. This is a material treatment, not a
  decorative hero applied to ordinary settings.
- A compact location control opens an in-app map preview first. The map’s
  preview itself is the explicit external-map action; never redirect a person
  away from their current work when they only asked to inspect the location.
- Queue labels state the actual scheduling condition (“No due date”), not an
  internally convenient or vague category name (“Anytime”).

### Feedback-to-rule protocol

When a review identifies friction, record it as a reusable rule before closing
the work:

1. Name the observed failure in plain language (for example, “selected cards
   shift”).
2. State the invariant that prevents it (“all choice states reserve identical
   geometry”).
3. Assign the invariant to the shared primitive or token layer, not a page-only
   exception.
4. Add the smallest focused test or live QA check that can detect regression.
5. Update this document and the relevant frontend skill in the same change.

The comments that established the current system therefore remain durable:
selection does not move layout; information starts at the top/start; previews
carry visual explanation; helper copy must earn its place; unavailable actions
are not offered; and permanent alerts are reserved for persistent, actionable
conditions.

### Visual entrypoint truthfulness

Advertising a visual entrypoint promises a designed, task-specific view. Ordinary
reads stay in chat; raw structured output is never the default user-facing visual.
Every advertised MCP App has a typed presentation contract, a useful text fallback,
an explicit malformed-result fallback, and focused narrow-width, theme, keyboard,
and lifecycle coverage. Removing visual metadata is the correct incomplete state;
a generic JSON inspector is not a product preview.

### Agent-owned setup invariant

Once an agent has authenticated, the product must stop treating the person as
an instruction transport. A server-owned plan exposes the current semantic
step, observed evidence, exact authority, required tools, and approval boundary.
The agent performs discovery and draft work, then re-reads the plan after every
state change. The person sees and performs only connection, unresolved choices,
and consequential approval. Hosted skills, copied prompts, and documentation
may explain the protocol, but they never become required setup steps or a
parallel source of completion state.
### Theme equivalence contract

Light and dark are two calibrated expressions of the same interface—not a
light palette with a separate set of dark overrides. `apps/web/src/styles.css`
defines the roles below in both themes. Components consume roles; they do not
choose a color because it happens to look acceptable on their current page.
Dark mode uses lifted charcoal fields rather than near-black planes so tonal
separation remains visible without borders or decorative elevation.

| Role | Purpose | Contrast band |
| --- | --- | --- |
| `canvas`, `surface`, `surface-subtle` | Three distinct neutral flat fields. Their relative luminance may invert by theme. | Separation, not text contrast |
| `content-primary` | Essential reading and active controls | At least 12:1 against `canvas` |
| `content-secondary` | Supporting explanation and metadata needed to act | At least 4.5:1 against `surface` |
| `content-tertiary` | Decorative, disabled, or nonessential metadata | Never the only way to convey state |
| `status-{danger,info,success,warning}-{surface,border,foreground}` | Persistent semantic state | At least 4.5:1 foreground/surface |
| `primary` + `primary-foreground` | The selected primary path and current context | At least 4.5:1 in both modes |

The two modes must stay within one contrast-ratio point for supporting content,
sidebar content, and status labels (two points for primary content). That
allows the material to remain calm while preserving the same reading hierarchy.
`scripts/check-theme-token-contract.mjs` enforces these requirements in
`pnpm lint`. It also rejects raw hex and `rgba()` colors outside the two theme
blocks, so feature work must name a semantic role before introducing a color.

`accentColor` remains a stored compatibility field, but it does not tint product
chrome. The legacy `accent` aliases resolve to the monochrome primary scale so
existing components remain coherent. Color belongs to semantic state or to
user/provider-owned material. The equal-weight material spectrum—rose, coral,
amber, green, teal, blue, indigo, and violet—may distinguish that material, but
no hue becomes nohmi's brand accent. Do not set `--accent`, `--primary`, or
`--ring` independently in feature code.

## Deterministic agent protocol

Agents changing UI follow this sequence before writing code:

1. Read this document, the relevant page specification in `docs/design/pages`,
   `apps/web/src/features/README.md`, and the domain ownership guide.
2. State the page’s immediate user job in the PR/change description. If it cannot
   be stated in one sentence, split the work or choose an explicit sub-flow.
3. Classify each visible group as one of the block types above. Reuse an existing
   block; introduce a new block only with a name, purpose, default visibility,
   state behavior, and documentation update.
4. Compose existing shadcn primitives. Use `Card` with its header/content/footer
   anatomy, `Item` for repeated material rows, `Alert` for callouts,
   `Collapsible` for history/detail, and Sonner only for transient results.
5. Implement all applicable states: loading, empty, unavailable, stale or
   reconnectable provider data, permission/capability restriction, mutation
   pending/failure, and success feedback.
6. Verify keyboard navigation, focus treatment, text truncation, 320 px narrow
   layout, and the normal desktop layout. Test the public behavior, not markup
   internals.
7. Capture the implementation decision in the page spec when it establishes a
   reusable rule. If the implementation contradicts the spec, update one before
   handoff—never leave them divergent.

### Mechanical acceptance checklist

A page change is not ready when any applicable answer is “no.”

- Does the default scan expose one immediate job and no more than one primary
  action?
- Can a person tell what is current, what is next, and whether data is current
  without opening a detail view?
- Are controls that cannot work absent or plainly explained at the affected
  material, rather than enabled and failing later?
- Does feedback follow the [feedback and validation rubric](feedback.md)? Are
  transient results handled with Sonner, field corrections beside their inputs,
  and ongoing blockers or essential recovery persistently discoverable?
- Does disclosure keep the result/status visible and hide only configuration,
  raw detail, or history?
- Can a keyboard user reach, operate, and dismiss every interactive element?
- Does the narrow layout preserve priority rather than simply compress desktop
  columns?

## Design review practice

Review the actual product at realistic data density, not only a clean empty
state. Treat implementation as a prototype: inspect it, identify a concrete
friction, make the smallest change that expresses the intended rule, and verify
the changed state plus its empty/error counterpart. This keeps design close to
the material while preventing local fixes from becoming undocumented patterns.

### Neutral surface and shape contract

The shared theme owns these invariants in both light and dark mode. Canvas/card
separation has a measured contrast floor of 1.16:1; this is a visual hierarchy
budget, not a WCAG text threshold. Overlay/card, overlay/canvas, and overlay/sidebar
separation must each reach 1.10:1. Rail/sidebar tones can stay close. Foreground
text must still meet 4.5:1 on its actual surface, including highlighted results.
Opaque overlay tone, rather than a local border or shadow, provides separation.
Modal dialogs, drawers, and sheets use the shared inverse `overlay` scrim; it
dims the page in both themes instead of becoming a white wash in dark mode.

Primary actions pair `primary` with `primary-foreground`. Quiet hover, focus, and
selection pair `selection` with `selection-foreground`; Tailwind's `accent` pair
maps to this same quiet treatment, including raw CSS `--accent`. Legacy primary
action consumers use `primary` explicitly. Browser text selection also uses the
quiet pair.

Radius is a length in rem, not a percentage of an element. With the 0.75rem base,
small details use 4px (`sm`), compact controls/menu items 6px (`md`), regular
controls 8px (`lg`), floating menus 12px (base), and cards/dialogs 16px (`xl`).
All scale from the same base; intentionally circular avatars, radio controls,
switches, and floating dock shapes remain round. A small button should not become
a capsule merely because it shares a panel's radius. Page CSS must use these same
named radius tokens for legacy inputs, badges, segmented controls, events, panels,
and sheets. Do not add fixed pixel corners or local radius arithmetic; `999px`
and `50%` are reserved for intentional circular marks, progress tracks, and docks.

The frontend theme owns this contract. Verify Settings search hover/keyboard
focus, cards, and Mail/Calendar account popovers in both themes when changing it.

### Neutral palette direction

Use a neutral grayscale inspired by [Radix Gray](https://www.radix-ui.com/colors/docs/palette-composition/composing-a-palette),
with semantic roles following its [scale guidance](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale).
This keeps chrome from competing with the four workspace colors. The selected
nohmi values are calibrated to our borderless surface and text contrast budgets;
they are not an unmodified Radix theme or a claim of automatic accessibility.

Light mode uses a soft gray canvas (`#e8e8e8`), off-white cards (`#f9f9f9`),
and charcoal text (`#202020`). Dark mode uses charcoal canvas (`#202020`),
neutral raised cards (`#2d2d2d`), and soft light text (`#eeeeee`). Navigation and
overlays follow the same achromatic scale. Never use pure white or pure black
for app-owned theme surfaces, text, or controls. The theme contract validator
rejects those endpoints. Provider artwork and user-authored material are content,
not sources for theme tokens.

### Floating workspace actions

Calendar's bottom-center action group and Mail's bottom-right compose action share
`FloatingActions` and `FloatingActionButton` (`components/floating-actions.tsx`).
On mobile, Calendar’s closed action group stays bottom-center; other closed action groups
align to the bottom end, with a shared safe-area
inset and 52px surface height. Page navigation uses the same floating action
primitives beside creation actions. The compact workspace switcher always lives
in the top header, never in the bottom dock. Workspace review alerts also live
in the mobile header as a glyph and compact count, keeping the full accessible label.
Unknown counts show an ellipsis and unavailable counts show an exclamation mark, never zero.
Contextual search and filters can occupy a second row. Mobile page sheets contain
page navigation only: account, password, and sign-out controls belong in Settings.
Rows preserve leading icons, truncated labels, and end-aligned metadata with 44px
touch targets.
Desktop placement remains workspace-specific.

The feature owns positioning, safe-area/mobile-dock clearance, and the opened
workflow; the shared block owns appearance and targets. Do not move either action
location merely to standardize its styling.

- Use a 44px square button target, 16px glyph, 4px surface padding, and 2px group
  gap. Both closed surfaces are 52px tall. A single action is circular; multiple
  actions form a capsule. Expanded content uses the shared panel radius token.
- Closed actions use the `primary` / `primary-foreground` pair in both themes,
  without workspace-specific hues or resting borders. Hover and keyboard focus
  use the same foreground-tinted fill; focus also has an inset outline.
- Every icon has an action-oriented accessible name and a delayed tooltip shown
  above the control. Tooltips supplement labels; they are not required to operate
  the action. Preserve normal Tab order, Escape dismissal, and return focus.
- Group styling does not imply ARIA `toolbar`: that role requires the toolbar
  keyboard contract, including arrow navigation. These small action groups retain
  their existing labeled navigation and ordinary button tab stops.
- Calendar retains its date/create/search surfaces; Mail retains its responsive
  compose dialog and draft-preservation behavior. Shared chrome must not absorb
  domain data, submission, validation, or dismissal logic.

The 44px target adopts [WCAG's enhanced target-size recommendation](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)
(a deliberate usability target, not a claim of whole-app AAA conformance).
Semantics follow the [WAI toolbar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/),
and tooltips compose the installed [shadcn Tooltip](https://ui.shadcn.com/docs/components/radix/tooltip).
Verify target geometry, surface/foreground pairing, focus return, and constrained
viewport clearance in both features when changing this block.

### Segmented selection controls

Use `SegmentedControl` / `SegmentedControlItem` from `components/segmented-control.tsx`
for compact, mutually exclusive view/filter/setting choices. This is one shared
composition of the installed shadcn Radix ToggleGroup, not a custom radio implementation.
It owns small control sizing, a quiet secondary track, selection/foreground pairing,
radius, spacing, horizontal layout, and rejection of empty deselection. Feature code
supplies a controlled value, accessible group label, options, and change handler.
Keep options in one row; allow horizontal scrolling when constrained rather than
turning the group into a grid or wrapping it into ambiguous rows. Do not restyle
individual instances or add parallel segmented-button CSS.

Current consumers: Today commitment filters; Calendar Day/Week/Month; Reviews work
type; Rituals Morning/Evening/History; Finances budget period; wallpaper layout,
image-fit and backdrop; agent permission presets. Calendar may hide visible labels
at narrow widths while keeping accessible names and tooltips.

Distinct semantics remain distinct: Cash Flow uses shadcn Tabs for associated
panels; ordinary form questions use RadioGroup; menu choices use DropdownMenuRadioGroup;
agent workspace cards retain their richer ToggleGroup composition; bucket and calendar
pickers select domain records rather than fixed view modes. Do not replace these solely
because they also allow one selection.

References: [shadcn Toggle Group](https://ui.shadcn.com/docs/components/radix/toggle-group),
[Radix single selection and keyboard contract](https://www.radix-ui.com/primitives/docs/components/toggle-group),
and [WAI Tabs semantics](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).

### Sidebar attention and counts

Compose `SidebarItemMeta` beside the standard shadcn SidebarMenuButton and reserve
its trailing space with `sidebar-item-with-meta`. Use its inline mode in the mobile
section sheet. Attention and count are independent: a semantic attention dot,
plus optional muted, normal-weight tabular count. Keep destination labels readable
and truncate them before metadata. Display compact counts from 1,000 upward (1.2k,
1.2m); retain the full comma-grouped value in the accessible description. Show no
count for unknown data, and do not infer urgency from an unread count. Mail,
Finances, and Settings share this composition. This follows the
[shadcn Sidebar badge slot](https://ui.shadcn.com/docs/components/radix/sidebar).

Shared form compositions live in `components/date-input.tsx` and
`components/currency-input.tsx`; Settings owns their value/formatting contract in
[its page specification](pages/settings.md). The date popover follows
[shadcn Date Picker](https://ui.shadcn.com/docs/components/radix/date-picker), and
currency uses [Input Group](https://ui.shadcn.com/docs/components/radix/input-group).

### Searchable entity selection

Use `SearchableSelect` for choosing one existing value from a long list, including Finance categories. It composes the shared shadcn Combobox and accepts value/label options; callers own fetching and entity permissions. The control is an inline editable text field, not a button opening a separate search box. Focusing it opens suggestions beneath the field; filtering highlights the first match, arrows change the highlight, and Enter or forward Tab commits it. Tab moves to the next available control; Shift+Tab leaves without committing, Escape cancels, and unmatched text never creates a value. Mount the popup inside its containing modal focus scope. Keep contextual popup colors distinct from the surrounding page-colored dialog.

### Workspace discovery

Every primary workspace header uses `WorkspaceFinder`: `Search Calendar`, `Search Tasks`,
`Search Mail`, or `Search Finances`. Search spans the workspace, independently of the current
view's filters, selected mailbox/list, visible calendars, and displayed date range. Desktop
uses an icon button that opens an anchored popover with an autofocus search field; mobile uses
the same icon button and the shared responsive drawer
with inline results. Do not nest a second floating search popup above the mobile drawer.

Group content, dates, settings, navigation, actions, and reviews. Show a useful preview and explicit
archived/completed/hidden context. Support keyboard selection, result-type filtering, bounded
pagination, honest loading/errors, and cancellation. Settings matches reuse `settingsFields` and
focus the field at their destination. Commands only open existing editors or review flows; typing
or selecting a search action never submits a mutation. Search covers synced records without
contacting providers. Keep search text separate from page-list filters and out of telemetry.

Workspace preferences live in four account-owned, revisioned tables. They hold UI preferences,
not duplicate domain records: Calendar default view/weekends and each workspace's archive-search
preference. Account time zone and day hours remain shared; calendars, mail rules, finance policy,
and connection settings remain with their owning domains. Add controls and their searchable field
metadata together. See [workspace search contract](plans/workspace-search.md).

Calendar keeps its view selector collapsed at every width. Calendar and Mail account triggers
show one avatar, a visible/total count, and an overlaid attention or synced marker. Calendar counts
calendars; Mail counts accounts. Use a green circular check when every enabled account is connected and ready or syncing;
use an X when attention is needed or health is unknown. Counts use secondary text. Full identities and recovery actions live in the popover.

Header utility actions align to the inline end with shared icon-button sizing. Calendar keeps Reviews
with its title; view and accounts precede Today, Previous, and Next at the far end. The view menu
contains only Day, Week, and Month. Below 600px the period buttons yield to the compact header;
the existing floating date control provides date navigation.

Calendar week columns flex above an 80px readable minimum, with the time gutter accounted for;
only narrower viewports scroll horizontally. Week tiles use a very subtle alternating tone; Day keeps the page background and Month
reserves muted fill for dates outside the current month. Shared grid rules carry day boundaries
and a solid-hour/dotted-subdivision hierarchy; fills must not overpower those rules or events.
The current-day highlight remains distinct. ScrollArea and native scroll owners share the scrollbar
thumb tokens, thin geometry, transparent tracks, and rounded thumbs. Keep native scroll ownership
where Calendar follow, sticky axes, and drag geometry depend on it; do not wrap those in a second
scroll viewport merely to change scrollbar appearance.

Calendar headers stay borderless; day boundaries begin in the timed grid. Follow today exposes
its active state with `aria-pressed` and the Today highlight token. In Day/Week, a user scroll
that settles near the reachable follow position for 180ms snaps there and resumes Follow when
Snap back to Follow is enabled. Capture ranges are Precise (6px), Balanced (24px), and Generous
(96px); release is at least 96px and always at least 48px beyond the capture range. Use clamped targets on both axes, ignore programmatic
scrolls, and never resume for a displayed period that excludes Today.

Calendar remembers explicit Day/Week/Month selections in account-owned workspace preferences.
Normal entry uses that view and today; automatic Follow defaults on. When disabled, normal entry
starts at midnight without following. Explicit date/view/follow links preserve their navigation
intent. Settings exposes Preferred view, Automatically follow today, Snap back to Follow, and
Follow snap sensitivity; these fields are also searchable. Defaults preserve existing behavior.

Review navigation entry points (workspace headers, sidebar footers, and settings actions) are omitted when the successfully loaded review count is zero. Unavailable counts retain an honest recovery entry. A one-action overflow should be a directly labeled icon button; use an overflow menu only when there is a choice of actions.

### Tasks menus and retained work

Tasks History, Trash, and Archive share the workspace header and content gutters.
Archive uses the collection grid, search, status filter, and recent-update sorting;
scoped retained tasks retain their existing lifecycle actions. History uses a history
arrow icon, Archive a storage box, and Trash a bin.

### Menus and selection controls (all workspaces)

This is an established frontend standard across workspace headers, sidebars, item
menus, settings, and responsive layouts. The shared shadcn DropdownMenu primitives
own layout and selection indicators; features own labels, grouping, and behavior.

| Row intent | Component | Trailing affordance |
| --- | --- | --- |
| Perform an action or navigate to a destination | `DropdownMenuItem` | No selection control |
| Choose exactly one value, such as grouping, sorting, or current view | `DropdownMenuRadioGroup` + `DropdownMenuRadioItem` | Always-visible circular radio; filled dot when selected |
| Toggle an independent option, such as visible row details | `DropdownMenuCheckboxItem` | Always-visible square checkbox; check when selected, dash for mixed state |

Do not implement selectable options as action rows with a manually appended check
icon. Both selected and unselected options show their control shape so the choice
model is understandable before interaction. Use the same semantic control tokens
as shadcn form radios and checkboxes. The menu row remains the sole focusable control
with its native `menuitemradio`/`menuitemcheckbox` and `aria-checked` semantics; never
nest a second interactive input inside it. Independent toggles should keep the menu
open for repeated adjustments; a single choice can close it after selection.

Menus size to their contents within the viewport, scroll vertically when necessary,
and reserve a separate, non-shrinking trailing indicator slot. Leading icons, text,
shortcuts, and selection indicators must not overlap or shift when selected. Long
labels wrap within the available space. Preserve arrow-key navigation, Space/Enter
activation, disabled states, Escape dismissal, and focus return to the trigger.

Use semantic icons for actions and entity choices where they improve recognition.
Separate destructive actions into their own final group with a menu separator and
the destructive variant; do not rely on color alone. Use concise labels without
incidental ellipses, such as “Archive list”; confirmation belongs in the ensuing
dialog. A single action uses a directly labeled icon button with an accessible name
and tooltip rather than an overflow menu. Keep ordinary actions free of radios and
checkboxes.

When changing menus, verify selected, unselected, mixed, disabled, long-label, and
narrow-viewport states, plus keyboard operation. Regression checks belong at shared
composition boundaries so each workspace inherits the same behavior.

Tasks stores explicit sort, grouping, row-detail visibility, and collection-sort choices in the
account-owned `tasks_workspace_settings` table. Returning to Tasks restores these defaults;
explicit URL options take precedence without silently overwriting saved preferences. Save only
user changes, serialize rapid preference writes, preserve unrelated fields, and expose save
failures through shared mutation feedback. An empty row-details selection is a persisted choice.

Tasks Settings exposes the same sort, group, row-details, and collection-sort preferences
as its workspace menus. Mail Settings exposes conversation density and desktop list width.
Both settings catalogs index these controls. Mail stores these layout values in
`mail_workspace_settings`, not device storage; resize events persist the desktop split
without applying it to the mobile single-pane layout. Conversation lists use the page
background and selected rows use the lighter `card` surface token.

Mail conversation readers open at the newest message, with chronological history above.
Use proximity scroll snapping at message starts; allow uninterrupted scrolling inside long
messages and respect the reader's position during background refreshes. Identify outgoing
mail by the user's connected account addresses and label it “You · Sent”; do not infer
ownership from a display name. Incoming/outgoing surfaces use semantic tokens and textual
labels, not color alone. Shared message attachment tiles remain inside their owning message
and show filename, file type, and size without implying unavailable download actions.

Mail message cards use the `card` surface for both incoming and outgoing mail; direction
remains explicit through sender labels. Message bodies use the full card content width.
The sticky title occupies the same top position for single-message and multi-message threads. A sticky upper-right older-message
control counts messages above the current position and moves to the nearest earlier message.
Hide the control at the beginning of the conversation and respect reduced-motion preferences.

Mail defaults to a resizable split view on desktop and a full-width list/reader flow on
mobile. The saved conversation-layout preference can select the full-width flow on desktop
as well, with Back to conversations returning to the same mailbox and filters. Expose it
in the Mail layout menu and searchable Mail settings. Message cards retain the shared card
radius; small theme-rounded tails align with the sender header on the incoming/start or
outgoing/end edge.

Mail inbox rows adapt to their pane width: wide panes place sender, subject with preview,
message metadata, and date on one scan line; narrow panes stack these for legibility.
Keep compact/comfortable/expanded density preferences and suppress empty metadata rows.

Collapsed sidebar review entries follow the shared icon-only menu-button geometry: hide
both text and inline count, center the review icon, preserve its attention surface, and
expose the complete review count/status through the shared tooltip and accessible label.
