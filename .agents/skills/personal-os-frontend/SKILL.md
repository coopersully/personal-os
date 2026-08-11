---
name: personal-os-frontend
description: Build and refine accessible, domain-owned ilo React PWA experiences. Use when changing `apps/web`, critiquing or refining a screen, translating UX feedback into shared rules, adding a feature page or view state, composing shadcn primitives, changing API queries, or refactoring the application shell.
---

# ilo frontend

Follow `docs/design/foundations.md`, `docs/design/governance.md`,
`docs/design/system.md`, the relevant page specification in
`docs/design/pages`, `apps/web/src/features/README.md`, and
`docs/engineering/feature-ownership.md`. Apply the installed `shadcn` skill for
component lifecycle and the available React best-practices guidance for
performance work.

## Diagnose refinement before editing

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
  active workspace sidebar: Today owns Goals, Motives, and Activity; Tasks owns
  Reminders. Account configuration belongs to the account utility, a tenant of
  the shell: it uses the shared frame, sidebar column, and app bar, but must not
  become a workspace, take a workspace identity, or enter the switcher. Only a
  standalone flow such as setup may replace the shell.
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

## Make user state honest

Represent loading, empty, error, stale, reconnect, and capability states.
For provider-backed material, expose freshness and failure instead of silently
presenting a projection as current. Make destructive actions deliberate and
surface API policy or permission failures clearly.

For agent-driven setup, render the authenticated server plan as the source of
truth for current, blocked, and complete state. Ask the person only for the
connection, preference decisions, or approvals Ilo cannot perform. Keep hosted
skills and procedural prompts as optional compatibility references; never make
the person copy setup instructions between Ilo and an agent after the agent can
call Ilo.

## Verify interaction behavior

Add focused Testing Library coverage for feature behavior. Use Playwright when
the change crosses routing, responsive layout, or a user-visible flow. Keep
the generated shadcn sources as vendor primitives; test product composition.

Target WCAG 2.2 AA across the complete flow. Prefer native HTML and established
shared primitives; follow WAI-ARIA APG keyboard conventions for composite
widgets. Automated checks do not replace keyboard, focus, zoom, reduced-motion,
responsive, realistic-state, and assistive-technology inspection appropriate
to the change.
