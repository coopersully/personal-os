---
name: personal-os-frontend
description: Build accessible, domain-owned ilo React PWA features. Use when changing `apps/web`, adding a feature page or view state, composing shadcn primitives, changing API queries, or refactoring the application shell.
---

# ilo frontend

Follow `apps/web/src/features/README.md`, `docs/design/system.md`, the relevant
page specification in `docs/design/pages`, and
`docs/engineering/feature-ownership.md`. Apply the installed `shadcn` skill
for component lifecycle and the available React best-practices guidance for
performance work.

## Structure feature work

- Place a vertical feature under `apps/web/src/features/<domain>`.
- Keep its page composition, query hooks, local state, and feature-only
  components together.
- Use `@personal-os/api-client` and domain contracts; do not call providers or
  invent page-only representations of provider material.
- Compose `src/components/ui` primitives. Do not create replacement primitives
  or bypass shared theme tokens.
- Let the app shell own routing, global navigation, Today, the generic Add menu,
  and modal composition. Keep new domain behavior out of `app.tsx` unless it is
  necessary composition wiring.

## Apply the design system deterministically

- State the page's immediate user job and classify each visible group using the
  design-system block grammar before adding layout.
- Compose existing shadcn primitives. Do not add feature-specific replacements
  for Card, Item, Alert, Collapsible, Empty, or Sonner.
- Use one raised primary block at most. Do not wrap every page group in a card;
  use an open sequence or a quiet queue for ordered material.
- Apply the interface-copy contract: delete helper text that restates an
  obvious label, and use a preview when the result can be shown more clearly
  than it can be explained.
- Keep semantic foreground tokens intact on interactive controls. Never add a
  global color override that can defeat a component's `text-*` contrast class.
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
  `docs/design/system.md`, assign it to the shared primitive or token layer,
  and add focused coverage or live QA before closing the work. Do not solve a
  recurring observation with a page-only exception.
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

## Verify interaction behavior

Add focused Testing Library coverage for feature behavior. Use Playwright when
the change crosses routing, responsive layout, or a user-visible flow. Keep
the generated shadcn sources as vendor primitives; test product composition.
