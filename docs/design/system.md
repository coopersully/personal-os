# ilo design system

## Purpose

ilo helps one person see, decide, and act across their commitments
without hiding where information came from or asking them to surrender control
to an agent. The interface should feel like a well-made personal instrument:
quiet by default, direct when needed, and detailed only at the point of use.

The visual character is soft neutral paper, soft charcoal, modest elevation, and a
monochrome primary scale. It is not a generic dashboard, a collection of
unrelated cards, or an AI chat surface.

Read [`foundations.md`](foundations.md) for the brand and experience principles
that govern this expression, and [`governance.md`](governance.md) for the method
used to diagnose feedback and admit new rules. This document owns the reusable
interface contract, not the complete design rationale.

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

## Decision ownership

Diagnose a visible issue from user outcome through information hierarchy,
pattern, primitive, token, composition, and defect. Fix the earliest stable
layer responsible for the failure; do not automatically choose either the most
global or the most local layer. Use the full diagnosis ladder and rule-maturity
model in [`governance.md`](governance.md).

New cross-product rules must name the user or system cost, scope, shared owner,
applicable states, and verification. A single preference remains a trial or a
page-specific decision until evidence establishes a wider contract.

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

The app frame owns page-wide orientation, search, filters, freshness actions,
and the primary create action. When those controls are present in the frame,
the page body begins with its primary material and never repeats a title,
eyebrow, search field, or action bar.

### Blocks

A block is a named product pattern with a stable purpose, not merely a rounded
rectangle. Use one of these forms before creating a new container.

| Block | Use for | Default visibility | Surface |
| --- | --- | --- | --- |
| `moment` | The single time-bound thing happening or next | Always open | Raised card, highest contrast |
| `sequence` | Ordered events or material that follows the moment | Always open when non-empty | Open page surface with compact material rows |
| `queue` | A bounded list of choices or commitments | Always open when actionable | Quiet rail with separators |
| `summary` | Capacity, count, freshness, or contextual fact | Inline with its owning block | Text or badge; never a dashboard tile by itself |
| `attention` | A persistent blocker, capability, or safety condition | Open while relevant | Semantic `Alert` beside its affected work |
| `detail` | Infrequent controls, provenance, scope, or raw metadata | Closed until requested | `Collapsible`, Popover, or inspector |
| `history` | Completed, revoked, or past material | Closed by default | Labelled `Collapsible` with a count |
| `choice` | A small set of mutually exclusive, previewable preferences | Always open | Shared `ChoiceCardGroup`; the entire card selects the option |
| `connection` | A bounded provider handoff that adds a real source | Open only when setup or recovery is the immediate job | Card with source context, existing material, and one connection action |

Rules:

- Reserve the selection-indicator space in every state so choosing an option never changes its layout. Anchor information at the block start; when present, place the preview at the inline end and let it occupy the card's available height.

- A page may have one `moment` block. A second elevated primary card is a design
  error unless the page has two genuinely simultaneous primary jobs.
- Do not wrap an entire page section in a card just to create spacing. A block
  earns a surface when it has a bounded action, a state boundary, or needs to
  separate live material from its surroundings.
- A `summary` belongs inside the block that gives it meaning. Counts and badges
  do not become standalone metrics.
- `detail` is progressive disclosure, not a dumping ground. Its trigger names
  the content it reveals, and its closed state still exposes the resulting
  setting or count when that affects the person.
- Preserve source, freshness, capability, and policy as compact metadata on the
  material row or inspector. Do not put provider mechanics in the default scan.
- A `choice` card is one accessible radio button, not a card beside a radio
  button. Its whole surface is the hit target, and its preview shows the result
  rather than repeating the label in prose.
- A multi-select choice card follows the same geometry with one nested
  checkbox. The complete card is its label and hit target; selected, hover, and
  focus states remain consistent anywhere this pattern appears.
- A `connection` never substitutes a demonstration or skeleton for provider
  state. Existing accounts are material rows, and the action launches the same
  production connection used elsewhere in the product.

### Readiness overviews and diagnostic disclosure

When four or more comparable checks answer one readiness question, do not make
the checks a dashboard grid. Use the shared `ReadinessPanel`, composed from
`Item`, `Badge`, `Progress`, and `Dialog`, as the default bounded overview:

- identify the affected product or object with its established icon and label;
- show one honest aggregate state: **Checking**, **Unavailable**, **Needs
  attention**, or **Ready**;
- after every required read settles, pair a visible **N of N checks ready** label
  with a determinate progress bar. Never show a percentage or progress bar for
  loading, unavailable, or partial evidence;
- promote the highest-priority actionable unresolved check as **Next step** and
  place it on the first row in place of the normal description. When no user
  action can resolve the first failed diagnostic, label it **Current
  constraint** instead of inventing a next step. Clamp this focus to one line;
- keep the closed overview to exactly two compact rows: identity, status, and
  focus on row one; completed-check count, progress, and **View checks** on row
  two. Never add a focus callout, nested `Item`, recovery action, or any other
  third row. Working per-check actions belong inside the evidence dialog;
- keep **View checks** beside the progress bar so evidence access does not add a
  separate row. Open the complete vertical `ItemGroup` in a labelled dialog;
  reviewing evidence must never expand or change the height of the overview;
- keep loading, unavailable, incomplete, empty, and complete distinct. A
  partial read never becomes a successful zero or a confident readiness score.

Keep product selection outside the overview. A small mutually exclusive set
uses one icon-labelled control family; selection changes which overview is
shown. When setup phase helps selection, each option may add one stable phase:
**Checking**, **Not set up**, **Needs review**, **Set up**, or **Unavailable**.
Setup phase is not readiness progress and must not use a percentage. Product
identity comes from the established icon, label, and material, not a feature
color. This pattern is established for Agent access and should be reused only
when several checks genuinely support one decision.

### Event summary cards

Use the shared compound `EventCard` for an event presented as a summary in a
moment, sequence, preview, or related-material surface. It composes the Shadcn
`Card` and exposes stable time, indicator, primary action, body, title,
description, aside, and footer slots.

- Preserve the anatomy when details vary. Omit an unused slot instead of
  recreating a smaller event card for one surface.
- The primary action opens event detail and owns the title/description. Keep
  independent actions such as **Join meeting** in the aside or footer so the
  card never contains nested interactive controls.
- Put source identity, state, and supporting actions in their named slots. They
  must not displace or merge with the event title.
- Keep the time label atomic and the card inline-size contained. Long titles
  truncate within the body slot; they must never widen the page or compromise
  adjacent navigation hit targets.
- Use the default semantic surface in the application and the documented
  inverse tone on a true inverse surface. Do not introduce page-specific event
  colors or restyle slot typography from a consumer.
- A calendar grid event is not an event summary card. Its position and size
  encode schedule information, so day/week/month blocks retain their compact
  spatial pattern while sharing the same event data and semantic tokens.

### Guided setup

Use a guided setup only when several dependencies must be established before a
feature can become useful. It is progressive configuration, not a carousel of
marketing slides.

- Ask one consequential question per step and save it before advancing.
- Conditional steps follow the person’s choices; do not make them skip
  irrelevant providers one by one.
- Keep a visible exit on every step. Exiting must persist before entering the
  app so an explicit choice cannot become a redirect loop.
- Resume from durable account state after refresh, sign-in, or provider OAuth.
  Browser storage is not the source of truth.
- Use the real production connector in setup, including its permission scope,
  pending state, error treatment, and resulting account data.
- Connected material precedes the add-another action. Repeating a connection is
  a short loop within the same step, not a new wizard branch.
- Let a person finish with zero external connections. Local capabilities remain
  useful and Settings retains the same connection controls later.
- Existing users do not enter a new-account setup automatically. A migration
  defaults established accounts to dismissed unless a deliberate re-onboarding
  campaign has its own product contract.

### Stable choices and controls

Use this contract whenever a setting presents a small, mutually exclusive set
of visual options:

- Focus, hover, and selection use the same flat semantic surface and border
  language. Do not use rings, outlines, or box shadows to indicate interaction
  state. Keyboard focus must remain visible through the same background and
  border changes used by the control family.
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

Use the semantic tokens in `apps/web/src/styles.css`; do not introduce raw color
utilities, page-local feature colors, or a second spacing scale. The four
approved workspace identity palettes are the only feature-level exception.

| Concern | Contract |
| --- | --- |
| Type | Plus Jakarta Sans is UI text. DM Mono is only compact time, date, count, identifier, or source metadata. |
| Text | Default UI text is 14 px. Secondary metadata is 12 px or smaller only when it is not required to complete the primary task. |
| Spacing | Use a 4 px base rhythm. Block gaps are 24–32 px; row gaps are 8–12 px; dense metadata gaps are 4–8 px. Repeated relationships need a shared role; legacy off-scale values are not precedent. |
| Shape | Shared `--radius` owns component roundness. Use cards and controls from `src/components/ui`; do not invent parallel primitives. |
| Color | Primary actions, selection, and current context use the monochrome ink scale. Warning, destructive, info, and success use semantic status tokens only. Workspace color is high-chroma, identity-only, and stays inside `WorkspaceIcon`. |
| Icons | Icons clarify an existing label or stand in only when the action has a familiar, accessible name. Icon-only actions require an accessible label and tooltip. |
| Navigation | Active navigation keeps the same geometry as inactive navigation. Ordinary destinations use solid/outline icon weight for state; framed workspace icons keep stable geometry and rely on the navigation surface for selection. |
| Motion | Motion confirms a spatial change and stays brief. It never conveys the only signal of urgency, completion, or error. Respect reduced motion. |

### Motion, loading, and perceived performance

Use the shared motion tokens in `apps/web/src/styles.css` instead of choosing
durations page by page.

- A micro transition, such as a menu highlight moving between adjacent choices,
  uses `--motion-duration-fast` (140 ms). A page-level spatial transition uses
  `--motion-duration-spatial` (220 ms). Both use
  `--motion-ease-spatial`.
- Animate only compositor-friendly `transform` and `opacity` for page movement.
  Never delay navigation, focus, or data display until an animation completes.
- Direction carries spatial continuity. Moving to a later item in an ordered
  switcher brings the destination up from below; moving to an earlier item
  brings it down from above. The menu indicator and destination use the same
  order and direction.
- Hover and keyboard focus are equivalent intent signals. A preview available
  on hover must also appear as a person arrows through the menu.
- A destination's own skeleton preserves its major geometry without inventing
  records, values, or status. An intent preview mounts the production route so
  an unresolved request naturally shows that exact pending state. Compose the
  shared shadcn `Skeleton`; do not hand-roll pulse animation or build a
  preview-only substitute.
- Opening a bounded workspace switcher may warm each destination's default-route
  queries in parallel. A hovered or focused destination renders the same route
  component used after selection, made inert and assistive-technology-hidden
  until navigation. Never maintain a second simplified reconstruction of the
  page. Reuse cached data immediately, then allow the destination's normal
  query to refresh stale material in the background. A speculative failure
  stays silent until the person navigates and the destination can present its
  normal error state.
- Flat shell chrome uses surface color, spacing, and hierarchy rather than
  divider borders between the sidebar, top navigation, and body. A workspace
  selector may use the semantic secondary surface to remain discoverable
  without reintroducing a hard seam.
- Contextual navigation rails compose the shared Sidebar group, menu,
  collapsible, and sub-menu primitives. Account identities are bounded
  disclosure rows; their child destinations are separate, indented rows with
  stable height, truncation, and independently aligned counts. Provider,
  account, destination, and count text must never collapse into one unbroken
  line when data is dense.
- A contextual sidebar does not repeat the workspace name already shown by its
  switcher or its first navigation group. Internal destinations never carry an
  external-link glyph; reserve that affordance for actions that actually open
  a new browsing context.
- Represent Calendar, Tasks, Mail, and Finances as whole workspaces with the
  shared `WorkspaceIcon`. Its registry owns label, route, and glyph; theme
  blocks own its semantic accent tokens. Do not reproduce workspace maps or
  palette values in a page. Use unframed functional icons below workspace level.
- When a shared moving selection surface already makes keyboard focus
  unmistakable, do not add a duplicate per-item treatment. Focus must remain at
  least as clear as hover and current-page selection.
- `prefers-reduced-motion` removes spatial travel and animated pulsing without
  removing the preview, selection, loading, or navigation state.

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
- A placeholder demonstrates the expected shape with useful, obviously
  fictional material. Use reserved examples such as `sam@example.com`; never
  place real people, production identifiers, plausible credentials, or
  placeholder-only instructions in a field. Labels remain present because a
  placeholder is not a label.
- Readiness copy names its evidence boundary. Loading and failed reads never
  become zero, empty, or absent claims; platform capability never becomes
  connected-agent authority without an active host carrying the required
  scope.
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
  gradient with condition, temperature, and at most two live facts overlaid;
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

| Role | Purpose | Contrast band |
| --- | --- | --- |
| `canvas` → `surface` → `surface-raised` | The three-step material ladder. Each step is lighter than the previous step in both themes. | Separation, not text contrast |
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

`accentColor` remains a stored compatibility field, but it has no visible effect
and is not exposed as a setting during the monochrome phase. The legacy
`accent` aliases resolve to the monochrome primary scale so existing components
remain coherent. Reintroduce user color only with a documented token contract,
an explicit setting, and contrast coverage for every primary role. Do not set
`--accent`, `--primary`, or `--ring` independently in feature code.

## Deterministic agent protocol

Agents changing UI follow this sequence before writing code:

1. Read `foundations.md`, `governance.md`, this document, the relevant page
   specification in `docs/design/pages`, `apps/web/src/features/README.md`, and
   the domain ownership guide.
2. State the page’s immediate user job in the PR/change description. If it cannot
   be stated in one sentence, split the work or choose an explicit sub-flow.
3. For refinement work, record the symptom, conditions, user/system cost,
   root-cause layer, proposed invariant or hypothesis, owner, and verification.
4. Classify each visible group as one of the block types above. Reuse an existing
   block; introduce a new block only with a name, purpose, default visibility,
   state behavior, and documentation update.
5. Compose existing shadcn primitives. Use `Card` with its header/content/footer
   anatomy, `Item` for repeated material rows, `Alert` for callouts,
   `Collapsible` for history/detail, and Sonner only for transient results.
6. Implement all applicable states: loading, empty, unavailable, stale or
   reconnectable provider data, permission/capability restriction, mutation
   pending/failure, and success feedback.
7. Verify keyboard navigation, focus treatment, text truncation, 320 px narrow
   layout, and the normal desktop layout. Test the public behavior, not markup
   internals.
8. Capture the implementation decision in the page spec when it establishes a
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
