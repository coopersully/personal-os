# ilo brand and experience foundations

- Status: Working foundation
- Audience: Product, design, engineering, and agents contributing to ilo
- Scope: The product experience and its expression; not company or campaign branding

## Brand idea

**Calm agency.** ilo makes a person's real commitments tangible and gives them
clear control over what happens next, including work proposed or performed by an
agent.

This is a working articulation of the existing product promise, not a claim
validated by brand research. Keep it only while it continues to explain the
product better than the alternatives.

## Product promise

At any moment, ilo shows what matters next, what is actively happening, what is
realistically possible, and what a person or authorized agent changed or
proposes to change.

The promise has four parts:

| Part | Experience consequence |
| --- | --- |
| Orientation | Current context, time, source, and state are easy to find. |
| Judgment | The interface distinguishes what matters now from what can wait. |
| Agency | Direct actions remain available and automation boundaries are visible. |
| Accountability | Proposals, changes, failures, and recovery retain evidence. |

## Character

Use these traits as paired constraints. The second term names the failure mode,
not an opposite style to be eliminated at any cost.

| ilo is | ilo is not | What this changes |
| --- | --- | --- |
| Calm | Passive | Reduce competition while keeping consequential state visible. |
| Direct | Abrupt | Name the action and consequence without filler or blame. |
| Capable | Theatrical | Let useful behavior demonstrate intelligence; avoid AI spectacle. |
| Personal | Cute | Respect one person's context without mascots, gamification, or forced intimacy. |
| Accountable | Institutional | Show source, authority, freshness, and recovery in plain language. |
| Focused | Sparse at any cost | Preserve the material and controls needed to make the immediate decision. |

## Experience principles

1. **Make reality tangible.** Design from actual records, constraints, density,
   time, permissions, and failure states. Do not make the product look calmer by
   hiding facts the person needs.
2. **Earn attention.** Visual weight, color, motion, interruption, and copy are
   limited resources. Spend them in proportion to consequence.
3. **Keep agency at the boundary.** A person can see what will happen before a
   consequential change, act directly, and understand how to stop or recover
   automated work.
4. **Put evidence near consequence.** Source, freshness, capability, confidence,
   and policy appear at the smallest level where they change a decision.
5. **Reveal depth on demand.** The first scan supports the immediate job;
   inspectors and labelled disclosure preserve configuration, provenance, and
   history.
6. **Prefer one coherent grammar.** Reuse shared page, block, control, and copy
   patterns. A new visual treatment must represent a new meaning, not a new
   author.
7. **Accessibility is product quality.** Keyboard, screen-reader, zoom,
   contrast, reduced-motion, touch, narrow layout, and cognitive clarity are
   normal acceptance conditions.

## Voice and language

ilo speaks like a clear, observant collaborator. It does not impersonate a
person, hide uncertainty, or narrate ordinary interface mechanics.

### Voice rules

- Use sentence case, direct verbs, concrete nouns, and short clauses.
- Address the person as “you” only when it makes the consequence clearer. Avoid
  repeated second-person phrasing in labels and navigation.
- Name the object and outcome: **Save budget**, **Reconnect calendar**, **Move 3
  messages**. Avoid generic actions such as **Continue** when the next action is
  known.
- State limits honestly: **Calendar data is 2 hours old** is better than a vague
  warning. Never turn loading, missing authority, or a failed read into a claim
  that nothing exists.
- Use helper copy only for a constraint, consequence, unfamiliar concept, or
  recovery step. A visible preview should replace explanatory prose when it
  communicates the result more directly.
- Avoid celebratory filler, urgency inflation, blame, and anthropomorphic AI
  language. Reserve praise for meaningful progress and warnings for material
  risk.
- Let domain language remain precise, then explain it where precision alone is
  not useful. Never expose provider enum codes or internal implementation names.

### Agent language

- Say what the agent inspected, proposes, changed, could not change, and why.
- Distinguish a suggestion, preview, approval, accepted handoff, completed
  effect, and failed effect. “Done” is reserved for a confirmed terminal result.
- Do not use “AI-powered” as a value proposition or “the AI decided” as an
  explanation. Name the evidence and policy that produced the result.

## Visual expression

The interface resembles a well-made personal instrument: neutral material,
soft charcoal, modest elevation, stable geometry, and precise information. It
is not a generic dashboard, a pile of cards, or a chat surface wrapped around
unrelated tools.

### Material and color

- Use the semantic material ladder `canvas` → `surface` → `surface-raised`.
  Elevation represents a bounded action, state, or current material—not
  decoration.
- Use the monochrome ink scale for hierarchy, selection, and primary action.
  Status color is reserved for danger, warning, success, and information with a
  stable semantic meaning.
- Light and dark themes carry the same roles and reading hierarchy. A feature
  consumes semantic roles and never chooses a raw color for one theme.
- Calendar, Tasks, Mail, and Finances are first-class workspaces with clear,
  high-chroma identity palettes. Their color is confined to the shared framed workspace
  icon and related identity marks; it does not recolor a page, replace status,
  or compete with content hierarchy. Other features do not invent accents.

### Workspace identity

- Treat Calendar, Tasks, Mail, and Finances as sub-apps inside ilo. Each has one
  established glyph, label, route, and light/dark palette in the shared
  workspace identity registry.
- Use the framed `WorkspaceIcon` whenever the whole workspace is represented:
  the workspace switcher, primary navigation, onboarding workspace choice, and
  Agent Access product setup. Use ordinary unframed icons for actions, views,
  records, providers, and destinations inside a workspace.
- Calendar is blue, Tasks violet, Mail rose, and Finances green. The visible
  label remains required wherever space permits; color is supplemental and
  never communicates readiness, selection, warning, or completion. Each accent
  must remain immediately distinguishable at peripheral glance in both themes;
  muddy, gray-shifted variants are not a calmer substitute for workspace identity.
- Today is ilo's neutral personal pseudo-workspace: it owns Today, Goals,
  Motives, and Activity while summarizing the other workspaces. Reminders
  belong within Tasks and do not receive a separate workspace palette.
- The only workspace identities are Today, Calendar, Tasks, Mail, and Finances.
  Account utilities (profile, setup, connections, security, agents, and
  automations) are full-page utilities, never a sixth workspace.

### Typography

- Plus Jakarta Sans is the interface voice. Its approachable geometry should
  remain readable and quiet at application density.
- DM Mono is functional notation for compact time, date, count, identifier, or
  source metadata. It is not a decorative display face.
- Hierarchy comes from role, size, weight, line height, and space together. Do
  not compensate for weak information structure with oversized headings.
- Use tabular numerals when values must compare vertically or update in place.

### Space, shape, and density

- Use 4 px as the intended base rhythm. Repeated spacing relationships should
  gain a semantic role in the shared layer instead of spreading page-specific
  values. Existing off-scale CSS is legacy evidence to audit, not precedent to
  copy; a deliberate optical correction stays local to its shared component and
  records why the base scale is insufficient.
- Group by relationship before adding a container. Cards are bounded objects,
  not margins with a background.
- Keep geometry stable across default, hover, focus, selected, pending, error,
  and disabled states. State changes may change tone but must not move content.
- Prefer dense, legible rows for comparable material and open page rhythm for a
  sequence. Preserve priority on narrow screens instead of shrinking the
  desktop composition until it fits.

### Motion

- Motion explains spatial continuity, hierarchy, or completion. It does not
  decorate waiting or delay access to current data.
- Use the shared durations and easing, animate `transform` and `opacity`, keep
  interactions interruptible, and preserve every state under reduced motion.

### Product mark and name

- Write the product name as lower-case **ilo** in product prose and the wordmark.
- The current application mark is a library volleyball glyph inside a rounded
  square. Treat it as a provisional implementation asset, not an approved brand
  system. Do not derive illustrations, campaign graphics, or new marks from it
  until the mark, clear space, minimum size, and accessible variants are
  deliberately approved.
- No illustration or photography language is established yet. Add one only
  from a real communication need and document its relationship to the quiet,
  material product character.

## Brand integrity check

Before approving a visible change, ask:

1. Does this make the person's reality clearer or merely make the screen more
   styled?
2. Is attention proportional to consequence?
3. Can the person predict and control what happens next?
4. Are source, freshness, authority, and uncertainty honest where they matter?
5. Does the change use the shared grammar, or is it creating a dialect for one
   page?
6. Does it retain meaning and operation across input methods, themes, zoom,
   motion preferences, and narrow layouts?

## Research basis and limits

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) is the minimum accessibility
  conformance target for the web experience. Conformance is a floor, not proof
  of usability.
- The [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/about/introduction/)
  informs keyboard and semantic behavior for composite widgets. Prefer native
  HTML and shared primitives; APG examples are informative, not a production UI
  library.
- GOV.UK's guidance to [start with user needs](https://www.gov.uk/service-manual/user-research/start-by-learning-user-needs)
  requires us to label stakeholder opinions and untested design claims as
  assumptions until research supports them.
- The [Design Tokens Format Module](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/)
  supports platform-agnostic, named design decisions and aliases. ilo currently
  implements semantic CSS variables; adopting a token interchange file is a
  future tooling decision, not a prerequisite for sound token ownership.
