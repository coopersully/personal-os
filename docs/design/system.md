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
- **Auth mark:** authentication may place the favicon glyph inside one opaque
  tonal tile. It has no resting effect or supporting label. Hovering the centered
  crest alone reveals the promise twice on one closed circular path, with equal
  spacing and two opposing star delimiters. The complete ring begins from a fixed
  position before it rotates subtly; reduced-motion mode reveals it without
  rotation. This is the only decorative glow-like motion in product chrome.
- **Voice:** use plain verbs, short clauses, and concrete nouns. Sound calm and
  useful, never cute, breathless, mystical, or artificially intimate.
- **Password fields:** use the shared input-group control with an end-aligned,
  accessible visibility toggle. Recovery belongs in the label row as a concise
  action, not beneath the form or inside the input.

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
individual pages must not recreate the shell inset with local padding.

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
- Transient results—saved, refreshed, copied, or failed mutations—use Sonner.
  They do not remain as stacked inline messages after their moment has passed.

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
| Effects | No decorative gradients, borders, elevation shadows, blur, glass, or translucent product surfaces. Hierarchy comes from spacing, type, and opaque tonal fields. A canvas-colored edge fade is allowed only when it keeps fixed navigation legible over scrolling content, as in Setup. |
| Icons | Icons clarify an existing label or stand in only when the action has a familiar, accessible name. Icon-only actions require an accessible label and tooltip. |
| Navigation | Active navigation keeps the same geometry as inactive navigation and uses the solid form of its icon; inactive items use the outline form. |
| Motion | Motion confirms a spatial change and stays brief. It never conveys the only signal of urgency, completion, or error. Respect reduced motion. |

### Tonal separation

Ordinary surfaces and controls separate through opaque semantic tone, not a
visible resting border. Shared primitives may reserve transparent border
geometry so focus, invalid, increased-contrast, or functional data boundaries
can become visible without layout shift. A legacy `outline` variant names an
interaction hierarchy, not a requirement to draw an outline.

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
- Is every persistent warning semantic and actionable? Is every transient result
  a toast rather than a permanent inline message?
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
