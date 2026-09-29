# nohmi brand system design

**Status:** Approved direction; shared-component migration approved 2026-08-30

**Date:** 2026-08-28

**Product brand:** nohmi

**Internal system identity:** personal-os

## Summary

Rename the product from **ilo** to **nohmi** and establish one enforceable brand
system for the web app, desktop app, product copy, documentation, and future UI
work. The system keeps shadcn/ui's neutral, component-led grammar and removes
decorative borders, shadows, gradients, blur, and glass. The experience gains
identity through proportion, whitespace, typography, tonal grouping, concise
language, and a balanced material palette whose colors appear only when the
person's data or a semantic state gives them a job. nohmi itself owns no accent
color.

The intended feeling is effortless, soft, inviting, and deeply calm. Workspaces
should feel comfortable enough to inhabit for long periods while retaining the
precision required for calendars, money, mail, and agent-visible state.

## Decisions

1. The public product name is always lowercase **nohmi**, pronounced “know me.”
2. The core promise is **know what matters.**
3. `personal-os` remains the internal identity for packages, protocols,
   infrastructure, and compatibility-sensitive identifiers.
4. The visual direction is a flattened shadcn neutral theme: no decorative
   borders, shadows, gradients, backdrop blur, or glass.
5. Product chrome and hierarchy are grayscale. Color belongs to material,
   relationships, people, categories, and semantic states; no hue is the brand
   default or carries more visual authority than another.
6. Geist is the product typeface. Reicon remains the interface icon library.
7. shadcn/ui primitives and their documented composition are the component
   grammar. Product code composes them instead of creating parallel primitives.

## Brand foundation

### Positioning

nohmi is a private personal workspace that helps one person see their life in
context, decide what matters, and safely share bounded context with trusted
agents. It is not a generic dashboard, a productivity scorekeeper, or an AI
persona that claims to know more than the person has shared.

### Promise

> **know what matters.**

The promise has two readings: nohmi gradually knows the person's material, and
the person can more easily know what matters now. The product must earn this
promise through honest state, useful context, and calm prioritization rather
than anthropomorphic copy.

### Personality

| Attribute | Meaning in the product | Not this |
| --- | --- | --- |
| Calm | One clear job and enough room to understand it | Empty for appearance's sake |
| Knowing | Context appears where it changes a decision | Claims of omniscience |
| Warm | Direct language and soft, comfortable geometry | Cute, chatty, or sentimental |
| Precise | Time, money, source, freshness, and policy remain exact | Dense technical chrome |
| Private | User agency and bounded access are visible | Surveillance language or hidden automation |

### Brand principles

1. **Start with what matters.** Reading order, space, and type establish the
   primary job before color or containers are considered.
2. **Remove until the structure is obvious.** Simplicity means fewer concepts
   and clearer relationships, not merely fewer visible pixels.
3. **Let material shape the interface.** Calendar, mail, finance, and reflection
   retain the density and controls their work requires. Consistency is a shared
   grammar, not identical layouts.
4. **Make care visible through restraint.** Alignment, copy, states, and
   responsive behavior receive more attention than decoration.
5. **Neutral in posture, open to color.** Grayscale establishes hierarchy.
   Color comes from material, relationship, source, personal choice, or
   semantic state, and every available hue enters at comparable visual weight.
6. **Make the system feel inevitable.** Common actions use familiar shadcn
   composition and platform conventions so the interface does not require
   explanation.

## Verbal identity

### Naming

- Write **nohmi** in lowercase in product UI, documentation, emails, provider
  descriptions, release notes, and marketing copy.
- Start a sentence with lowercase **nohmi** when practical. Rewrite awkward
  sentences rather than capitalizing the brand.
- Do not write “the nohmi.” Use “nohmi,” “the app,” or the specific workspace.
- Pronounce the name “know me.” Use the pronunciation only in brand or press
  context; normal product copy does not explain the pun.
- `personal-os` is an implementation name and never appears as customer-facing
  brand copy.

### Voice

nohmi is direct, warm, and unperformed.

- Use short clauses, concrete nouns, and ordinary verbs.
- State what is true now and what the person can do next.
- Prefer “You have room for one more thing today” to “Optimize your productivity
  with smart capacity insights.”
- Prefer “Saved” to “Your changes have been successfully saved.”
- Name agents and providers when their identity affects trust or capability.
- Never imply that nohmi has feelings, intentions, or knowledge it has not been
  given.
- Avoid productivity theater: optimize, crush, hustle, streak, score, maximize,
  supercharge, and unlock.
- Avoid AI theater: magical, intelligent, revolutionary, copilot, and “knows you
  better than you know yourself.”
- Avoid filler helper copy. A sentence remains only when it explains a change,
  constraint, consequence, source, freshness state, or next action.

### Copy patterns

| Situation | Pattern | Example |
| --- | --- | --- |
| Orientation | Concrete area name | “Today” |
| Capacity | Plain observation | “You have room for one more thing today.” |
| Empty state | State, then useful next action | “Nothing scheduled. Add time only if it needs protecting.” |
| Success | Result only | “Saved” |
| Failure | What failed, effect, recovery | “Calendar did not sync. Your local changes are still here.” |
| Agent action | Actor, action, scope | “Codex proposed changes to 3 tasks.” |
| Privacy | Specific access | “This connection can read events from Work.” |

## Public brand and internal identity

### Rename publicly

The following become **nohmi**:

- Web document titles, accessible labels, authentication copy, loading, empty,
  error, and availability messages.
- Desktop product name, window title, visible bundle metadata, and copyright.
- User-visible API and MCP descriptions, OAuth/provider client display names,
  email sender names, calendar producer identity, exports, and downloads.
- Current product, design, onboarding, deployment, support, contributor, and
  release documentation.
- Tests and fixtures that assert user-visible copy.

Historical records may retain **ilo** when rewriting them would misrepresent a
past decision. A short note can identify nohmi as the current name.

### Preserve internally

The following remain stable unless a separate compatibility migration is
approved:

- Repository name and directory names containing `personal-os`.
- Workspace packages under `@personal-os/*`.
- Internal binaries, Docker image names, Compose project names, and log prefixes.
- Environment variables, secret names, internal HTTP headers, and storage keys.
- `personal-os://` MCP resource URIs and internal API identifiers.
- Database names, schema identifiers, migration history, audit identifiers, and
  desktop bundle identifier `app.personal-os.desktop`.

Code may expose a small `brand` module for public constants such as `name`,
`promise`, and accessible product labels. It must not become a bag of unrelated
copy or replace specific domain language.

### Name-clearance note

A preliminary search found the long-established Nohmi Bosai brand and a live
U.S. `NOHMI` registration in International Class 9. This design does not make a
legal availability conclusion. Obtain trademark counsel and relevant domain and
app-store clearance before a public launch. Product implementation may proceed
with **nohmi** as the approved working brand.

## Visual identity

### Wordmark and compact mark

- The primary wordmark is the lowercase text **nohmi** in Geist, semibold, with
  tight but legible tracking. It is not an all-caps technical logo.
- The wordmark appears without a separate emblem when space allows.
- The compact app mark is a lowercase `n` on a flat ink tile with the shared
  control radius. It is used only where the full wordmark cannot fit: app icon,
  favicon, compact sidebar, and small loading surfaces.
- The wordmark and compact mark are always neutral ink and canvas. nohmi has no
  permanent colored signal point, signature pastel, or branded hue.
- The mark has no gradient, shadow, outline, glass, or pseudo-3D treatment.
- Clear space is at least the height of the `n` around the wordmark and one
  quarter of the tile width around the compact mark.

### Typography

Use one primary type family and one narrowly scoped data treatment.

| Role | Typeface | Default treatment |
| --- | --- | --- |
| Product UI | Geist Sans | 14 px / 1.5, regular |
| Labels and controls | Geist Sans | 12–14 px, medium or semibold |
| Page title | Geist Sans | 14–16 px, semibold, compact |
| Section title | Geist Sans | 18–24 px, semibold, tight tracking |
| Brand/display | Geist Sans | 32–64 px, medium or semibold, tight tracking |
| Time, counts, and identifiers | Geist Mono | 10–13 px, only where alignment or data identity helps |

- Use regular, medium, semibold, and bold. Do not use thin or light weights.
- Do not use monospace merely to make a label look technical.
- Maintain the same information hierarchy under text scaling and narrow layouts.

### Color model

The palette begins with shadcn's neutral theme roles. Components consume
semantic roles rather than palette values.

#### Neutral roles

| Role | Purpose |
| --- | --- |
| `canvas` | App and workspace background |
| `surface` | Default content surface, usually the same plane as canvas |
| `surface-subtle` | Sidebar, grouped settings, passive controls |
| `surface-strong` | Selected neutral item and emphasized tonal grouping |
| `content-primary` | Essential content and neutral primary actions |
| `content-secondary` | Supporting content needed to act |
| `content-tertiary` | Nonessential metadata and disabled content |

Light mode is a warm near-white canvas with soft neutral groups and ink primary
content. Dark mode uses the same role ladder with flat charcoal tones. Neither
mode uses a simulated elevation gradient.

#### Material color

nohmi provides a balanced spectrum rather than a brand palette. Rose, coral,
amber, green, teal, blue, indigo, and violet are available at comparable
lightness, saturation, area, and contrast. None is the default, none represents
nohmi, and none establishes interface hierarchy.

Material may supply a color when it identifies a calendar, label, person,
provider relationship, user category, or other meaningful source attribute. A
material color may fill a small marker, badge, icon background, or bounded data
preview. It does not become product chrome, active navigation, a global focus
ring, the default primary action, a page background, or the fill of several
adjacent controls.

The system never hard-codes a hue to a product domain merely to make that domain
look distinctive. Preserve a provider or user-selected color when one exists;
otherwise use a neutral treatment. When the product must offer choices, present
the whole balanced spectrum without a pre-emphasized swatch.

Status danger, warning, success, and info remain separate conventional semantic
families. Material colors never replace status semantics. Color is never the
only carrier of meaning.

### Shape

- One 12 px root radius drives the shadcn radius scale.
- Controls use the medium radius, compact tiles and icon buttons use the medium
  or large radius, and bounded groups use the large or extra-large radius.
- Pills are reserved for short badges, tags, and binary segmented controls.
- Do not turn ordinary cards, inputs, and navigation rows into pills.
- Nested radii decrease with the nesting level so grouped surfaces feel
  concentric and deliberate.

### Flat material contract

The system has hierarchy without simulated depth.

- No decorative borders or separator lines.
- No box shadows, drop shadows, text shadows, or inset shadows.
- No gradients, including decorative status or weather gradients.
- No `backdrop-filter`, blur, frosted glass, translucency-as-material, or glass
  highlights.
- Grouping uses whitespace, alignment, and flat tonal fills.
- Overlays use a flat scrim and an opaque tonal surface. They do not float via a
  shadow.
- Focus indicators and increased-contrast outlines are accessibility signals,
  not decorative borders, and are always allowed.
- A data visualization may use a line or rule when the line is the data itself.
- Print, table, and calendar grid rules require an explicit functional need and
  use the quietest contrast that remains legible.

#### Border exception model

Background tone is the default separator. A visible border is an exception that
must communicate interaction, state, or data structure rather than decorate a
surface.

| Surface | Resting treatment | Allowed visible border |
| --- | --- | --- |
| Cards, items, panels, sidebars, app bars | Opaque tonal fill or open canvas | None |
| Inputs, textareas, selects, input groups | Filled neutral control surface | Focus, invalid, or increased-contrast state only |
| Primary, secondary, ghost, and legacy `outline` buttons | Filled or transparent tonal state | Focus, invalid, or increased-contrast state only |
| Menus, popovers, dialogs, sheets, and drawers | Opaque tonal overlay over a flat scrim | Only when adjacent tones cannot preserve a 3:1 control boundary |
| Badges and alerts | Neutral or semantic fill | Only when required by increased contrast or a semantic state contract |
| Tables, calendar grids, charts, and ordered separators | Open or tonal data surface | Functional rules that encode row, time, or data relationships |

Components reserve stable border geometry when focus or validation requires it,
so state changes never move content. A transparent resting border is an
implementation detail, not a visible separator. Hover, pressed, expanded,
selected, and disabled states change semantic tone first. Focus remains a
two-pixel-equivalent high-contrast indicator; the flat treatment never weakens
keyboard orientation.

## Layout and workspace comfort

### Page structure

Retain the existing page grammar: orientation, one primary material block,
working sequence, detail, and history. Apply these refinements:

- The canvas stays open. Containers do not wrap whole page sections solely to
  create margins.
- Use 24–32 px between major blocks, 12–16 px within groups, and 6–10 px for
  related metadata.
- Default content measures remain comfortable for reading. Dense domains may
  use wider layouts when the material requires it.
- Place the most important content toward the top and leading edge.
- Align titles, controls, and repeated values to make scanning effortless.
- On narrow screens, preserve reading order and priority rather than shrinking
  desktop columns.

### Shell

- The sidebar is a flat `surface-subtle` plane without a dividing border.
- Active navigation uses `surface-strong` and a neutral icon treatment.
- The top navigation shares the canvas and is separated by spacing, not a line
  or glass material.
- The main workspace uses the widest practical area while keeping the immediate
  task comfortably readable.
- Desktop window rounding may follow the shared radius. The app shell has no
  frame shadow or translucent background.

### Density

Hyperminimal does not mean low-information.

- Today and Settings are calm reference surfaces.
- Calendar, finance, and mail retain appropriate information density and precise
  interaction targets.
- Density changes through row height, measure, and disclosure—not by inventing
  new component styling per workspace.
- Touch targets remain at least 24 by 24 CSS pixels with adequate spacing; core
  actions target 36–40 px when space permits.

## shadcn component standards

shadcn/ui is the source component grammar. Local source ownership permits brand
customization, but anatomy, accessibility, variants, and composition remain
recognizable and updatable.

### Primitive rules

- Use existing components before custom markup. Search the installed shadcn
  registry before introducing a new primitive.
- Use semantic theme utilities such as `bg-background`, `bg-muted`,
  `text-foreground`, and `text-muted-foreground`; feature code never uses raw
  material colors.
- `className` in product code handles layout and responsive placement, not
  primitive color or typography overrides.
- Preserve `data-slot` attributes and upstream component anatomy.
- Keep interactive state, keyboard behavior, names, roles, and values provided
  by Radix and shadcn.

### Hierarchy and use cases

| Need | shadcn composition | nohmi treatment |
| --- | --- | --- |
| Primary bounded moment | `Card` with full header/content/footer anatomy | `surface-subtle`, no border or shadow |
| Repeated material | `ItemGroup` + `Item` + optional `ItemSeparator` only when functional | Open rows, tonal hover/selection |
| Settings and forms | `FieldSet` + `FieldLegend` + `FieldGroup` + `Field` | Filled controls, no outline at rest |
| Empty state | `Empty` + `EmptyHeader` + optional `EmptyContent` | Quiet copy, one useful action at most |
| Persistent condition | `Alert` | Flat semantic fill, concise action |
| History or rare detail | `Collapsible`, `Popover`, or `Sheet` | Opaque tonal overlay, no shadow |
| Transient result | Sonner | Brief, direct result copy |
| Navigation | Full `SidebarProvider` / `Sidebar` composition | Flat neutral plane and tonal active row |
| Small exclusive options | `ToggleGroup` or existing `ChoiceCardGroup` when a preview is necessary | Identical geometry in every state |
| Status or metadata | `Badge` | Neutral or semantic flat fill |

### Component-specific standards

- **Button:** neutral ink primary, filled neutral secondary, transparent ghost,
  semantic destructive. Do not use a material hue as the global primary action.
- **Card:** use only for bounded material or state. Never add a border or shadow
  to make a generic section visible.
- **Item:** related items live in `ItemGroup`; row actions remain at the inline
  end and do not create a second toolbar.
- **Field:** related controls use `FieldGroup`; validation uses `data-invalid`
  and `aria-invalid`; helper copy must earn its place.
- **Sidebar:** use the documented provider, header, content, group, menu, footer,
  inset, and trigger hierarchy. Branding belongs in `SidebarHeader`; account and
  settings belong in `SidebarFooter`.
- **Empty:** replace parallel `EmptyState` markup with shadcn `Empty` composition
  as affected surfaces are migrated.
- **Overlays:** Dialog, Sheet, and Drawer always have accessible titles. Popover
  and menu items remain grouped using their documented group components.
- **Icons:** use reicon objects from the shared registry, `data-icon` inside buttons, and accessible names
  for icon-only actions. Components own icon sizing.

## Accessibility

- Meet WCAG 2.2 AA for all product surfaces.
- Normal text has at least 4.5:1 contrast; large text has at least 3:1.
- Essential control boundaries, icons, and states have at least 3:1 non-text
  contrast against adjacent colors.
- Focus is visible with a two-pixel-equivalent indicator and sufficient contrast.
  Flat styling never removes focus visibility.
- Increased-contrast mode may add explicit outlines and stronger tonal steps.
- Color always has a text, icon, shape, or position counterpart.
- Text scales to 200% without losing content or function.
- Respect reduced motion and never use motion as the only state signal.

## Motion

- Motion confirms a spatial or state change; it does not decorate rest states.
- Use 120–180 ms for hover and control feedback and 180–240 ms for spatial
  transitions such as a sheet or sidebar.
- Prefer opacity and small transforms. Avoid bounce, spring overshoot, parallax,
  looping ambient motion, and shimmer outside a true loading skeleton.
- Reduced-motion mode removes nonessential transforms and shortens transitions.

## Implementation architecture

### Canonical sources

- This specification owns brand identity, voice, and the nonnegotiable visual
  direction.
- `docs/design/system.md` owns day-to-day product composition and interaction
  rules and must reference this specification.
- `apps/web/src/styles.css` owns runtime semantic tokens and the Tailwind v4
  `@theme inline` mapping.
- `apps/web/src/components/ui` owns customized shadcn primitives.
- A small shared web brand module owns public name and promise constants used by
  runtime composition.

### Migration sequence

1. Align the semantic neutral ladder and shadcn token aliases so canvas,
   ordinary surface, passive control, and selected surface remain distinct in
   both themes.
2. Update shared primitives before feature composition: Button, Card, Item,
   Input, Textarea, NativeSelect, InputGroup, Toggle, Tabs, Badge, Alert,
   Popover, Dialog, Sheet, ContextMenu, and Sidebar.
3. Audit feature CSS for visible borders that bypass primitives. Remove
   decorative lines and retain only documented control, state, grid, or data
   boundaries.
4. Verify Today and Settings as calm reference surfaces, then Calendar, Mail,
   Tasks, and Finances as dense stress tests. Correct shared ownership before
   adding a feature-level exception.
5. Extend deterministic checks and tests so later component updates cannot
   silently restore decorative borders, shadows, gradients, or glass.

### Token layers

1. **Foundation:** neutral and balanced-spectrum values defined only in the
   light and dark theme blocks.
2. **Semantic:** canvas, surface, content, action, material, and status roles.
3. **Component:** shadcn tokens such as `background`, `card`, `popover`,
   `primary`, `secondary`, `muted`, `accent`, `border`, `input`, `ring`, and
   sidebar roles mapped to the semantic layer.

Components consume layer three. Feature composition may consume documented
semantic material and status utilities. Feature code never consumes foundation
values directly.

### Enforcement

Extend deterministic checks to reject new brand drift:

- Raw color literals outside approved theme blocks.
- `shadow-*`, `drop-shadow-*`, `bg-gradient-*`, gradient functions,
  `backdrop-blur-*`, `backdrop-filter`, and decorative blur in product UI.
- Feature-level overrides of `primary`, `accent`, `ring`, or sidebar theme roles.
- Parallel primitives for Card, Item, Alert, Empty, Field, Sidebar, overlay, or
  toast behavior.
- Public user-facing uses of **ilo** after the rebrand allowlist is applied.

The checks allow documented functional exceptions such as chart data, a flat
modal scrim, focus indicators, high-contrast outlines, and historical records.

## States and feedback

The brand system must remain coherent in loading, empty, error, offline, stale,
reconnect, capability, permission, pending, success, and destructive-confirmation
states.

- Loading uses shadcn `Skeleton` or a labelled spinner without shimmer-heavy
  decoration.
- Empty states are specific, quiet, and action-oriented.
- Persistent problems use a flat semantic `Alert`; transient results use Sonner.
- Offline and stale states explain whether material can still be read or edited.
- Destructive actions use explicit language and confirmation; danger color does
  not substitute for a clear consequence.
- Provider and agent state preserves source, freshness, capability, policy, and
  action result at the smallest useful level.

## Validation

### Automated

- Unit-test the brand constants and public-name contract.
- Extend the theme-token contract to validate light/dark contrast, equivalent
  neutral hierarchy, and material foreground/surface pairs.
- Add a style-contract check for forbidden shadows, gradients, blur, glass, raw
  feature colors, and unapproved public **ilo** copy.
- Add focused Testing Library coverage for the branded shell, authentication,
  sidebar, reference components, and accessible names.
- Update existing tests that intentionally assert user-visible product naming.
- Add Playwright acceptance for authentication, Today, Settings, desktop shell,
  and 320 px navigation behavior.

### Manual and visual

- Review light, dark, increased-contrast, and reduced-motion modes.
- Verify 320 px, tablet, normal desktop, and wide desktop layouts.
- Review Today and Settings first, then realistic dense Calendar, Mail, and
  Finance data.
- Confirm that removing borders and shadows does not erase control boundaries or
  reading order.
- Confirm that every colored instance comes from material or a documented
  semantic state and that no hue has become product chrome.
- Confirm that the app still feels precise under dense professional work.

### Acceptance criteria

The brand implementation is ready when:

1. Every current user-facing product name is **nohmi** and internal compatibility
   identifiers remain unchanged.
2. The runtime contains no decorative borders, shadows, gradients, glass, or
   backdrop blur outside the documented exception allowlist.
3. Today, Settings, authentication, and the shell demonstrate the approved flat
   direction in light and dark mode.
4. Core component families use documented shadcn composition and semantic tokens.
5. Material colors have equivalent visual weight, come from meaningful data or
   choice, and pass foreground contrast where they carry text.
6. Loading, empty, error, offline, stale, and success states remain clear.
7. Keyboard, focus, 200% text scaling, 320 px layout, and reduced motion pass.
8. Deterministic checks prevent raw colors, forbidden effects, parallel
   primitives, and public-name regression.
9. Focused tests and `pnpm verify` pass.

## Research basis

The system adapts principles rather than copying another product's appearance:

- Ryo Lu's work and discussion of staying close to the material, designing the
  underlying concepts, and preferring consistency over uniformity:
  <https://ryo.lu/> and <https://dialectic.fm/ryo-lu>.
- Jony Ive on care, iteration, tools, and understanding material rather than
  approving surface-only representations:
  <https://www.mckinsey.com/capabilities/tech-and-ai/our-insights/the-creative-process-is-fabulously-unpredictable-a-great-idea-cannot-be-predicted>.
- Apple's guidance on hierarchy, alignment, semantic color, typography, and
  adaptable layout:
  <https://developer.apple.com/design/human-interface-guidelines/layout>,
  <https://developer.apple.com/design/human-interface-guidelines/color>, and
  <https://developer.apple.com/design/human-interface-guidelines/typography>.
- OpenAI's balance of technological precision and human warmth, and its use of
  fixed wordmark proportion for consistency:
  <https://openai.com/brand/>.
- Notion's content-first workspace model and design-system guidance:
  <https://www.notion.com/blog/how-to-create-a-design-system>.
- shadcn/ui's semantic CSS-variable theming and documented component anatomy:
  <https://ui.shadcn.com/docs/theming>,
  <https://ui.shadcn.com/docs/components/radix/sidebar>,
  <https://ui.shadcn.com/docs/components/radix/item>, and
  <https://ui.shadcn.com/docs/components/radix/field>.
- The Design Tokens Community Group's stable token exchange model, used as
  vocabulary rather than as an additional runtime dependency:
  <https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/>.
- WCAG 2.2 contrast, resize, focus, and non-text requirements:
  <https://www.w3.org/TR/WCAG22/>.

## Out of scope

- Renaming `personal-os` packages, protocols, infrastructure, storage, or database
  identifiers.
- A marketing website, launch campaign, social templates, or merch system.
- Claims of legal clearance or trademark availability.
- A second component library, theme builder, global user accent picker, or
  feature-specific visual language. User- and provider-owned material colors
  remain allowed because they do not recolor product chrome.
- Glass, depth effects, ornamental illustration, or animated brand mascots.
